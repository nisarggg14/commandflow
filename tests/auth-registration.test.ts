import assert from "node:assert/strict";
import test from "node:test";
import { UserRole, type PrismaClient, type User } from "@prisma/client";
import { createHash } from "node:crypto";

import { getRegistrationErrorResponse } from "../app/api/auth/register/route";
import {
  EXISTING_COMPANY_MESSAGE,
  INVALID_INVITATION_CODE_MESSAGE,
  registerUser,
  resolvePublicRegistrationRole,
  normalizeCompanyName,
} from "../services/auth.service";

process.env.MFA_ENCRYPTION_KEY ??= "test-registration-encryption-key-32-bytes";
process.env.JWT_SECRET ??= "test-registration-jwt-secret-at-least-32-characters";

function uniqueViolation(target: string) {
  return Object.assign(new Error("Unique constraint failed."), {
    code: "P2002",
    meta: { target: [target] },
  });
}

function registrationDatabase(existingCompany?: { id: string; name: string; slug: string; normalizedName?: string; invitationCodeHash?: string }) {
  const users: User[] = [];
  const sessions: Array<{ token: string; userId: string }> = [];
  const companies = new Map<string, { id: string; name: string; slug: string; normalizedName?: string; invitationCodeHash?: string }>();
  if (existingCompany) companies.set(existingCompany.id, existingCompany);
  let nextId = 0;

  const tx = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => (
        users.find((user) => user.email === where.email) ?? null
      ),
      create: async ({ data }: { data: Omit<User, "createdAt" | "updatedAt" | "active" | "mfaEnabled" | "mfaSecret" | "pendingMfaSecret" | "pendingMfaExpiresAt" | "lastMfaTotpStep"> }) => {
        const user = {
          ...data,
          id: `user-${++nextId}`,
          active: true,
          mfaEnabled: false,
          mfaSecret: null,
          pendingMfaSecret: null,
          pendingMfaExpiresAt: null,
          lastMfaTotpStep: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as User;
        users.push(user);
        return user;
      },
    },
    company: {
      findUnique: async ({ where }: { where: { invitationCodeHash: string } }) => {
        const company = [...companies.values()].find((item) => item.invitationCodeHash === where.invitationCodeHash);
        return company ? { id: company.id, name: company.name, slug: company.slug } : null;
      },
      create: async ({ data }: { data: { name: string; normalizedName: string; slug: string } }) => {
        if ([...companies.values()].some((company) => company.normalizedName === data.normalizedName)) {
          throw uniqueViolation("normalizedName");
        }
        if ([...companies.values()].some((company) => company.slug === data.slug)) {
          throw uniqueViolation("slug");
        }
        await Promise.resolve();
        if ([...companies.values()].some((company) => company.normalizedName === data.normalizedName)) {
          throw uniqueViolation("normalizedName");
        }
        if ([...companies.values()].some((company) => company.slug === data.slug)) {
          throw uniqueViolation("slug");
        }
        const company = { id: `company-${++nextId}`, ...data };
        companies.set(company.id, company);
        return company;
      },
    },
    session: {
      create: async ({ data }: { data: { token: string; userId: string } }) => {
        sessions.push(data);
        return data;
      },
    },
  };
  const db = {
    $transaction: async <T>(operation: (transaction: typeof tx) => Promise<T>) => operation(tx),
  } as unknown as PrismaClient;

  return { db, users, sessions, companies };
}

function registrationInput(overrides: Record<string, unknown> = {}) {
  return {
    companyName: "Northwind",
    name: "First Member",
    email: "first@example.test",
    password: "correct-horse-battery",
    confirmPassword: "correct-horse-battery",
    ...overrides,
  };
}

test("public registration never accepts a caller-selected role", () => {
  assert.equal(resolvePublicRegistrationRole(true), UserRole.ADMIN);
  assert.equal(resolvePublicRegistrationRole(false), UserRole.VIEWER);
});

test("first signup creates company, initial admin, and session in one transaction", async () => {
  const state = registrationDatabase();
  const response = await registerUser(registrationInput({ companyName: "  NORTHWIND  ", role: "ADMIN" }), state.db);

  assert.equal(response.user.role, UserRole.ADMIN);
  assert.equal(response.company.slug, "northwind");
  assert.equal(response.company.name, "NORTHWIND");
  assert.equal(normalizeCompanyName("  NoRtHwInD  "), "northwind");
  assert.equal(state.users.length, 1);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0]?.userId, state.users[0]?.id);
  assert.equal(state.companies.size, 1);
});

test("company name duplicates are rejected after case and whitespace normalization", async () => {
  const state = registrationDatabase();
  await registerUser(registrationInput({ companyName: "Northwind" }), state.db);
  await assert.rejects(
    () => registerUser(registrationInput({
      companyName: "  NORTHWIND ",
      email: "second@example.test",
    }), state.db),
    new RegExp(EXISTING_COMPANY_MESSAGE),
  );
  assert.equal(state.companies.size, 1);
  assert.equal(state.users.length, 1);
});

test("normalized company-name uniqueness conflicts return a clear 409 response", async () => {
  const state = registrationDatabase({
    id: "company-existing",
    name: "Northwind",
    normalizedName: "northwind",
    slug: "northwind",
  });
  const result = await Promise.allSettled([
    registerUser(registrationInput({ email: "second@example.test", companyName: " NORTHWIND " }), state.db),
  ]);

  assert.deepEqual(
    getRegistrationErrorResponse((result[0] as PromiseRejectedResult).reason),
    { status: 409, message: EXISTING_COMPANY_MESSAGE },
  );
});

test("invitation-code signup joins the matched company as regular User", async () => {
  const invitationCode = "company-join-code-that-is-not-a-secret";
  const company = {
    id: "company-existing",
    name: "Northwind",
    slug: "northwind",
    invitationCodeHash: createHash("sha256").update(invitationCode).digest("hex"),
  };
  const state = registrationDatabase(company);
  const response = await registerUser(registrationInput({
    companyName: "",
    invitationCode,
    role: "ADMIN",
    email: "member@example.test",
  }), state.db);

  assert.equal(response.user.role, UserRole.VIEWER);
  assert.equal(response.company.id, company.id);
  assert.equal(response.message, "Account created and joined the company.");
  assert.equal("invitationCodeHash" in response.company, false);
});

test("invalid invitation codes are rejected without creating a user", async () => {
  const state = registrationDatabase();
  await assert.rejects(
    () => registerUser(registrationInput({ companyName: "", invitationCode: "incorrect-code" }), state.db),
    new RegExp(INVALID_INVITATION_CODE_MESSAGE),
  );
  assert.equal(state.users.length, 0);
});

test("concurrent initial signups cannot both claim the company Admin role", async () => {
  const state = registrationDatabase();
  const outcomes = await Promise.allSettled([
    registerUser(registrationInput({ email: "first@example.test" }), state.db),
    registerUser(registrationInput({ email: "second@example.test" }), state.db),
  ]);
  const created = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

  assert.equal(created.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(state.users.filter((user) => user.role === UserRole.ADMIN).length, 1);
  assert.deepEqual(
    getRegistrationErrorResponse((rejected[0] as PromiseRejectedResult).reason),
    { status: 409, message: EXISTING_COMPANY_MESSAGE },
  );
});
