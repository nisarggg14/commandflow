import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import {
  consumeRecoveryCode,
  consumeTotpStep,
  createRecoveryCodes,
  createTotpSecret,
  createTotpSetupResult,
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  isMfaEnrollmentActive,
  verifyTotpCode,
  verifyTotpCodeWithTimeStep,
} from "../lib/mfa";
import { hashSessionToken } from "../lib/jwt";
import { createLoginMfaRequiredResponse } from "../app/api/auth/login/route";
import { hashPassword } from "../lib/bcrypt";
import { loginUser, verifyMfaLogin } from "../services/auth.service";

process.env.MFA_ENCRYPTION_KEY ??= "test-mfa-flow-encryption-key-32-bytes";
process.env.JWT_SECRET ??= "test-mfa-flow-jwt-secret-32-characters";

const totp = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

async function codeFor(secret: string, epoch = Math.floor(Date.now() / 1000)) {
  return totp.generate({ secret, epoch });
}

test("TOTP setup creates a unique secret and a local QR with the correct issuer and label", async () => {
  const first = await createTotpSetupResult("person@example.test");
  const second = await createTotpSetupResult("person@example.test");
  const uri = new URL(first.otpauthUrl);

  assert.notEqual(first.secret, second.secret);
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.searchParams.get("issuer"), "CommandFlow");
  assert.match(decodeURIComponent(uri.pathname), /person@example\.test$/);
  assert.match(first.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.equal(decryptSecret(encryptSecret(first.secret)), first.secret);
});

test("TOTP accepts current and small clock-drift codes but rejects invalid codes", async () => {
  const secret = createTotpSecret();
  const now = Math.floor(Date.now() / 1000);
  const currentCode = await codeFor(secret, now);
  const previousStepCode = await codeFor(secret, now - 30);

  assert.equal(await verifyTotpCode(secret, currentCode), true);
  assert.equal(await verifyTotpCodeWithTimeStep(secret, previousStepCode, now), Math.floor((now - 30) / 30));
  assert.equal(await verifyTotpCode(secret, "not-code"), false);
  assert.equal(await verifyTotpCode(secret, "000000"), false);
});

test("pending enrollment expires and a fresh pending enrollment is active", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  assert.equal(isMfaEnrollmentActive("encrypted", new Date(now.getTime() + 1000), now), true);
  assert.equal(isMfaEnrollmentActive("encrypted", new Date(now.getTime() - 1), now), false);
  assert.equal(isMfaEnrollmentActive(null, new Date(now.getTime() + 1000), now), false);
});

test("TOTP replay is rejected atomically under concurrent verification", async () => {
  let lastStep: bigint | null = null;
  const db = {
    user: {
      updateMany: async ({ data }: { data: { lastMfaTotpStep: bigint } }) => {
        if (lastStep !== null && lastStep >= data.lastMfaTotpStep) return { count: 0 };
        lastStep = data.lastMfaTotpStep;
        return { count: 1 };
      },
    },
  };

  const outcomes = await Promise.all([
    consumeTotpStep(db as never, "user-1", 123456),
    consumeTotpStep(db as never, "user-1", 123456),
  ]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal(lastStep, 123456n);
});

test("recovery codes are random, stored as hashes, and consumed once", async () => {
  const [code] = createRecoveryCodes(1);
  const storedHash = hashRecoveryCode(code);
  let consumedAt: Date | null = null;
  const db = {
    mfaRecoveryCode: {
      updateMany: async ({ where, data }: {
        where: { userId: string; codeHash: string; consumedAt: null };
        data: { consumedAt: Date };
      }) => {
        if (where.userId !== "user-1" || where.codeHash !== storedHash || consumedAt) {
          return { count: 0 };
        }
        consumedAt = data.consumedAt;
        return { count: 1 };
      },
    },
  };

  assert.equal(code.startsWith("CF-"), true);
  assert.notEqual(storedHash, code);
  assert.equal(await consumeRecoveryCode(db as never, "user-1", code.toLowerCase()), true);
  assert.equal(await consumeRecoveryCode(db as never, "user-1", code), false);
  assert.equal(Object.prototype.toString.call(consumedAt), "[object Date]");
});

function createLoginDatabase(user: Record<string, any>, recoveryCode?: string) {
  let loginChallenge: Record<string, any> | null = null;
  let challengeConsumed = false;
  let lastStep: bigint | null = null;
  let storedRecoveryHash = recoveryCode ? hashRecoveryCode(recoveryCode) : null;
  let recoveryConsumed = false;
  let sessionCount = 0;
  const tx = {
    mfaLoginChallenge: {
      updateMany: async () => {
        if (!loginChallenge || challengeConsumed) return { count: 0 };
        challengeConsumed = true;
        return { count: 1 };
      },
    },
    user: {
      updateMany: async ({ data }: { data: { lastMfaTotpStep: bigint } }) => {
        if (lastStep !== null && lastStep >= data.lastMfaTotpStep) return { count: 0 };
        lastStep = data.lastMfaTotpStep;
        return { count: 1 };
      },
    },
    mfaRecoveryCode: {
      updateMany: async ({ where }: { where: { codeHash: string } }) => {
        if (recoveryConsumed || where.codeHash !== storedRecoveryHash) return { count: 0 };
        recoveryConsumed = true;
        return { count: 1 };
      },
    },
    session: { create: async () => { sessionCount += 1; return {}; } },
  };
  const db = {
    user: {
      findUnique: async () => user,
    },
    mfaLoginChallenge: {
      create: async ({ data }: { data: Record<string, any> }) => {
        loginChallenge = {
          id: "challenge-1",
          ...data,
          consumedAt: null,
          user,
        };
        return loginChallenge;
      },
      findUnique: async ({ where }: { where: { challengeHash: string } }) =>
        loginChallenge?.challengeHash === where.challengeHash ? loginChallenge : null,
    },
    session: { create: async () => { sessionCount += 1; return {}; } },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    state: () => ({
      loginChallenge,
      challengeConsumed,
      lastStep,
      recoveryConsumed,
      sessionCount,
      storedRecoveryHash,
    }),
  };
  return db;
}

async function createMfaUser() {
  const secret = createTotpSecret();
  return {
    secret,
    user: {
      id: "user-1",
      name: "MFA User",
      email: "mfa@example.test",
      password: await hashPassword("correct horse battery"),
      role: UserRole.ADMIN,
      active: true,
      mfaEnabled: true,
      mfaSecret: encryptSecret(secret),
      companyId: "company-1",
      company: { id: "company-1", name: "Company", slug: "company" },
    },
  };
}

test("password login for MFA users returns only a short-lived challenge and no session", async () => {
  const { user } = await createMfaUser();
  const db = createLoginDatabase(user);
  const result = await loginUser(
    { email: user.email, password: "correct horse battery" },
    db as never,
  );

  assert.equal(result.mfaRequired, true);
  if (!result.mfaRequired) return;
  assert.equal("token" in result, false);
  assert.equal(db.state().sessionCount, 0);
  assert.equal(db.state().loginChallenge?.challengeHash, hashSessionToken(result.challengeToken));
  assert.ok(new Date(result.expiresAt).getTime() > Date.now());

  const response = createLoginMfaRequiredResponse(result);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await response.json()).token, undefined);
});

test("valid MFA login consumes its challenge and creates a session; replay is rejected", async () => {
  const { user, secret } = await createMfaUser();
  const db = createLoginDatabase(user);
  const firstStep = await loginUser(
    { email: user.email, password: "correct horse battery" },
    db as never,
  );
  assert.equal(firstStep.mfaRequired, true);
  if (!firstStep.mfaRequired) return;

  const code = await codeFor(secret);
  const completed = await verifyMfaLogin({ challengeToken: firstStep.challengeToken, code }, db as never);
  assert.equal(completed.mfaRequired, false);
  assert.equal(db.state().sessionCount, 1);
  assert.ok(db.state().lastStep !== null);
  await assert.rejects(
    () => verifyMfaLogin({ challengeToken: firstStep.challengeToken, code }, db as never),
    /invalid or expired/i,
  );
});

test("invalid TOTP does not create a session or consume a challenge", async () => {
  const { user } = await createMfaUser();
  const db = createLoginDatabase(user);
  const result = await loginUser(
    { email: user.email, password: "correct horse battery" },
    db as never,
  );
  assert.equal(result.mfaRequired, true);
  if (!result.mfaRequired) return;

  await assert.rejects(
    () => verifyMfaLogin({ challengeToken: result.challengeToken, code: "000000" }, db as never),
    /invalid mfa verification/i,
  );
  assert.equal(db.state().sessionCount, 0);
  assert.equal(db.state().challengeConsumed, false);
});

test("recovery code completes MFA login exactly once", async () => {
  const { user } = await createMfaUser();
  const [recoveryCode] = createRecoveryCodes(1);
  const db = createLoginDatabase(user, recoveryCode);
  const result = await loginUser(
    { email: user.email, password: "correct horse battery" },
    db as never,
  );
  assert.equal(result.mfaRequired, true);
  if (!result.mfaRequired) return;

  await verifyMfaLogin(
    { challengeToken: result.challengeToken, recoveryCode },
    db as never,
  );
  assert.equal(db.state().recoveryConsumed, true);
  assert.equal(db.state().sessionCount, 1);
});

test("ordinary password login for non-MFA users still creates the existing session", async () => {
  const { user } = await createMfaUser();
  const ordinaryUser = { ...user, mfaEnabled: false, mfaSecret: null };
  const db = createLoginDatabase(ordinaryUser);
  const result = await loginUser(
    { email: user.email, password: "correct horse battery" },
    db as never,
  );

  assert.equal(result.mfaRequired, false);
  assert.equal("token" in result, true);
  assert.equal(db.state().sessionCount, 1);
});

test("legacy CBC-encrypted MFA secrets remain decryptable", () => {
  const key = Buffer.from(process.env.MFA_ENCRYPTION_KEY!.slice(0, 32));
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update("existing-totp-secret", "utf8"),
    cipher.final(),
  ]);
  assert.equal(
    decryptSecret(`${iv.toString("hex")}:${encrypted.toString("hex")}`),
    "existing-totp-secret",
  );
});
