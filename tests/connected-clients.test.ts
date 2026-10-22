import test from "node:test";
import assert from "node:assert/strict";
import { UserRole } from "@prisma/client";
import { requireRole } from "../lib/authorization";
import {
  connectedClientBaseUrlSchema,
  connectedClientSlugSchema,
  createConnectedClientSchema,
  updateConnectedClientSchema,
} from "../validators/connected-client.validator";
import {
  listConnectedClients,
  toSafeConnectedClient,
  updateConnectedClient,
} from "../services/connected-client.service";
import { validateConnectedClientSelection } from "../services/mcp-connector.service";
import { connectedClientErrorResponse } from "../lib/connected-client-api-error";
import { AuthenticationServiceError } from "../lib/errors";
import { validateAndConsumeMfaChallenge } from "../lib/mfa";

process.env.MFA_ENCRYPTION_KEY ??= "test-connected-client-encryption-key-32-bytes";

const valid = {
  name: "Inventory API",
  baseUrl: "https://inventory.example.com/api",
  authType: "BEARER" as const,
  authConfig: { token: "secret-token" },
};

test("connected-client validator accepts HTTPS and rejects embedded credentials", () => {
  assert.equal(connectedClientBaseUrlSchema.safeParse(valid.baseUrl).success, true);
  assert.equal(connectedClientBaseUrlSchema.safeParse("ftp://inventory.example.com").success, false);
  assert.equal(connectedClientBaseUrlSchema.safeParse("https://user:pass@example.com").success, false);
});

test("authenticated connected clients must use HTTPS", () => {
  assert.equal(createConnectedClientSchema.safeParse({
    ...valid,
    baseUrl: "http://inventory.example.com/api",
  }).success, false);
  assert.equal(createConnectedClientSchema.safeParse({
    name: "Public API",
    baseUrl: "http://inventory.example.com/api",
    authType: "NONE",
  }).success, true);
});

test("connected-client validator enforces slug and authConfig rules", () => {
  assert.equal(connectedClientSlugSchema.safeParse("inventory-api").success, true);
  assert.equal(connectedClientSlugSchema.safeParse("Not A Slug").success, false);
  assert.equal(createConnectedClientSchema.safeParse({ ...valid, authConfig: undefined }).success, false);
  assert.equal(createConnectedClientSchema.safeParse({ name: "Public API", baseUrl: valid.baseUrl, authType: "NONE" }).success, true);
  assert.equal(updateConnectedClientSchema.safeParse({ authType: "BEARER" }).success, false);
});

test("connected-client registration roles remain restricted to admins and managers", () => {
  const actor = {
    id: "user-1",
    email: "admin@example.test",
    companyId: "company-1",
    role: UserRole.VIEWER,
  };

  assert.throws(
    () => requireRole(actor, [UserRole.ADMIN, UserRole.MANAGER]),
    /forbidden/i,
  );
  assert.doesNotThrow(() => requireRole(
    { ...actor, role: UserRole.MANAGER },
    [UserRole.ADMIN, UserRole.MANAGER],
  ));
});

test("active connected-client listing filters by company and status", async () => {
  const activeClient = {
    id: "client-active",
    name: "Inventory API",
    slug: "inventory-api",
    description: null,
    status: "ACTIVE",
    baseUrl: "https://inventory.example.com/api",
    authType: "BEARER",
    authConfig: "encrypted",
    companyId: "company-1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
  let query: { where: Record<string, string> } | undefined;
  const db = {
    connectedClient: {
      findMany: async ({ where }: { where: Record<string, string> }) => {
        query = { where };
        return [activeClient];
      },
    },
  };

  const clients = await listConnectedClients(
    "company-1",
    { status: "ACTIVE" },
    db as never,
  );

  assert.deepEqual(query?.where, { companyId: "company-1", status: "ACTIVE" });
  assert.deepEqual(clients.map(({ id, status }) => ({ id, status })), [
    { id: "client-active", status: "ACTIVE" },
  ]);
});

test("connected-client listing returns an empty list when the company has no registrations", async () => {
  let query: { where: Record<string, string> } | undefined;
  const db = {
    connectedClient: {
      findMany: async ({ where }: { where: Record<string, string> }) => {
        query = { where };
        return [];
      },
    },
  };

  const clients = await listConnectedClients(
    "company-with-no-clients",
    { status: "ACTIVE" },
    db as never,
  );

  assert.deepEqual(clients, []);
  assert.deepEqual(query?.where, {
    companyId: "company-with-no-clients",
    status: "ACTIVE",
  });
});

test("inactive clients are excluded from the active list and cannot be selected", async () => {
  const inactiveClient = {
    id: "client-inactive",
    status: "INACTIVE",
  };
  let listWhere: Record<string, string> | undefined;
  let selectionWhere: Record<string, string> | undefined;
  const db = {
    connectedClient: {
      findMany: async ({ where }: { where: Record<string, string> }) => {
        listWhere = where;
        return [];
      },
      findFirst: async ({ where }: { where: Record<string, string> }) => {
        selectionWhere = where;
        return where.status === "ACTIVE" ? null : inactiveClient;
      },
    },
  };

  const clients = await listConnectedClients(
    "company-1",
    { status: "ACTIVE" },
    db as never,
  );

  assert.deepEqual(clients, []);
  assert.deepEqual(listWhere, { companyId: "company-1", status: "ACTIVE" });
  await assert.rejects(
    () => validateConnectedClientSelection("client-inactive", "company-1", db as never),
    /unavailable/i,
  );
  assert.deepEqual(selectionWhere, {
    id: "client-inactive",
    companyId: "company-1",
    status: "ACTIVE",
  });
});

test("connected-client database errors become safe service-unavailable responses", async () => {
  const databaseError = new Error("remote database connection details");
  const db = {
    connectedClient: {
      findMany: async () => {
        throw databaseError;
      },
    },
  };

  await assert.rejects(
    () => listConnectedClients("company-1", { status: "ACTIVE" }, db as never),
    (error: unknown) =>
      error instanceof AuthenticationServiceError &&
      error.cause === databaseError,
  );

  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = connectedClientErrorResponse(
      new AuthenticationServiceError("Connected clients unavailable.", databaseError),
    );
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.message.includes("remote database"), false);
  } finally {
    console.error = originalConsoleError;
  }
});

test("safe connected-client responses never expose encrypted authConfig", () => {
  const safe = toSafeConnectedClient({
    id: "client-1", name: "Inventory API", slug: "inventory-api", description: null,
    status: "ACTIVE", baseUrl: valid.baseUrl, authType: "BEARER",
    authConfig: "ciphertext", companyId: "company-1",
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  } as never);
  assert.equal("authConfig" in safe, false);
  assert.equal(safe.hasCredentials, true);
});

test("switching authType to NONE clears existing encrypted credentials", async () => {
  const existing = {
    id: "client-1", name: "Inventory API", slug: "inventory-api", description: null,
    status: "ACTIVE", baseUrl: valid.baseUrl, authType: "BEARER", authConfig: "ciphertext",
    companyId: "company-1", createdAt: new Date(), updatedAt: new Date(),
  };
  let updateData: Record<string, unknown> | undefined;
  const db = {
    connectedClient: {
      findFirst: async () => existing,
      update: async ({ data }: { data: Record<string, unknown> }) => { updateData = data; return { ...existing, ...data, authType: "NONE" }; },
    },
    activityLog: { create: async () => undefined },
  };
  const updated = await updateConnectedClient("client-1", { authType: "NONE" }, { id: "user-1", companyId: "company-1" }, db as never);
  assert.equal(updateData?.authConfig, null);
  assert.equal(updated.hasCredentials, false);
});

test("connected-client update cannot cross company boundaries", async () => {
  const db = { connectedClient: { findFirst: async () => null } };
  await assert.rejects(
    () => updateConnectedClient("client-1", { name: "Hijacked" }, { id: "user-2", companyId: "other-company" }, db as never),
    /not found/i,
  );
});

test("generic MFA proof binds to the server operation purpose and remains single-use", async () => {
  const challenge = {
    id: "challenge-1", userId: "user-1", purpose: "step-up-mfa", riskLevel: "HIGH",
    challengeToken: "token-1", expiresAt: new Date(Date.now() + 60_000), verifiedAt: null,
  };
  let current: {
    id: string; userId: string; purpose: string; riskLevel: string;
    challengeToken: string; expiresAt: Date; verifiedAt: Date | null;
  } = { ...challenge };
  const db = {
    mfaChallenge: {
      findUnique: async () => current,
      updateMany: async ({ data }: { data: { purpose: string; verifiedAt: Date } }) => {
        if (current.verifiedAt || !["step-up-mfa", data.purpose].includes(current.purpose)) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      },
    },
  };
  const consumed = await validateAndConsumeMfaChallenge(db as never, {
    userId: "user-1", challengeToken: "token-1", purpose: "approval:approval-1:execute", riskLevel: "HIGH",
  });
  assert.equal(consumed.purpose, "approval:approval-1:execute");
  await assert.rejects(
    () => validateAndConsumeMfaChallenge(db as never, { userId: "user-1", challengeToken: "token-1", purpose: "approval:approval-1:execute", riskLevel: "HIGH" }),
    /consumed/i,
  );
});
