import test from "node:test";
import assert from "node:assert/strict";
import { UserRole } from "@prisma/client";
import { authenticateToken } from "../lib/auth";
import { generateToken } from "../lib/jwt";

process.env.JWT_SECRET ??= "test-auth-session-jwt-secret-32-characters";

function createStore(options: {
  session?: { userId: string; expiresAt: Date } | null;
  user?: Record<string, unknown> | null;
}) {
  return {
    session: {
      findUnique: async () => options.session ?? null,
    },
    user: {
      findUnique: async () => options.user ?? null,
    },
  } as never;
}

const user = {
  id: "user-1",
  email: "admin@example.test",
  role: UserRole.ADMIN,
  active: true,
  companyId: "company-1",
  company: { id: "company-1" },
};

function tokenFor(id = "user-1") {
  return generateToken({
    id,
    email: user.email,
    role: UserRole.ADMIN,
    companyId: user.companyId,
  });
}

test("a current session authenticates and reads role/company from the current user record", async () => {
  const result = await authenticateToken(
    tokenFor(),
    createStore({
      session: { userId: "user-1", expiresAt: new Date(Date.now() + 60_000) },
      user,
    }),
  );

  assert.deepEqual(result, {
    id: "user-1",
    email: "admin@example.test",
    role: UserRole.ADMIN,
    companyId: "company-1",
  });
});

test("a missing or expired session is rejected before MFA operations can run", async () => {
  await assert.rejects(
    () => authenticateToken(tokenFor(), createStore({ session: null, user })),
    /Session is no longer valid\./,
  );
  await assert.rejects(
    () => authenticateToken(tokenFor(), createStore({
      session: { userId: "user-1", expiresAt: new Date(Date.now() - 1) },
      user,
    })),
    /Session is no longer valid\./,
  );
});

test("a session for another user cannot be used with a signed token", async () => {
  await assert.rejects(
    () => authenticateToken(tokenFor(), createStore({
      session: { userId: "user-2", expiresAt: new Date(Date.now() + 60_000) },
      user,
    })),
    /Session is no longer valid\./,
  );
});

test("an inactive or cross-company user cannot use an otherwise current session", async () => {
  await assert.rejects(
    () => authenticateToken(tokenFor(), createStore({
      session: { userId: "user-1", expiresAt: new Date(Date.now() + 60_000) },
      user: { ...user, active: false },
    })),
    /User account or company association is unavailable\./,
  );
  await assert.rejects(
    () => authenticateToken(tokenFor(), createStore({
      session: { userId: "user-1", expiresAt: new Date(Date.now() + 60_000) },
      user: { ...user, company: { id: "company-2" } },
    })),
    /User account or company association is unavailable\./,
  );
});
