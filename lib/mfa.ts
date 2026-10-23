import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import QRCode from "qrcode";
import { MfaChallengeError } from "@/lib/errors";

const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();
const totpFactory = new TOTP({ crypto: cryptoPlugin, base32: base32Plugin });

export interface TotpSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface ConsumeMfaChallengeInput {
  userId: string;
  challengeToken: string;
  purpose: string;
  riskLevel?: string;
}

export const GENERIC_STEP_UP_MFA_PURPOSE = "step-up-mfa";
export const MFA_ENROLLMENT_TTL_MS = 10 * 60 * 1000;

export function isMfaEnrollmentActive(
  encryptedSecret: string | null,
  expiresAt: Date | null,
  now = new Date(),
): boolean {
  return Boolean(encryptedSecret && expiresAt && expiresAt > now);
}

function getEncryptionKey(): string {
  const key = process.env.MFA_ENCRYPTION_KEY;

  if (!key || key.length < 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be configured with at least 32 characters.");
  }

  return key.slice(0, 32);
}

export function encryptSecret(secret: string): string {
  const key = Buffer.from(getEncryptionKey());
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(value: string): string {
  if (!value || typeof value !== "string") throw new Error("Invalid encrypted MFA secret.");
  if (value.startsWith("encrypted:")) return value.replace(/^encrypted:/, "");
  const key = Buffer.from(getEncryptionKey());
  if (value.startsWith("v2:")) {
    const [, ivHex, tagHex, encryptedHex] = value.split(":");
    if (!ivHex || !tagHex || !encryptedHex) throw new Error("Invalid encrypted MFA secret.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
  }
  // Legacy CBC ciphertext remains readable for safe migration. New writes always use v2 GCM.
  const [ivHex, encryptedHex] = value.split(":");
  if (!ivHex || !encryptedHex) throw new Error("Invalid encrypted MFA secret.");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}
export function createTotpSecret(): string {
  return totpFactory.generateSecret();
}

export function createOtpauthUrl(email: string, secret: string): string {
  const totp = new TOTP({
    secret,
    label: email,
    issuer: "CommandFlow",
    crypto: cryptoPlugin,
    base32: base32Plugin,
  });

  return totp.toURI();
}

export async function createTotpSetupResult(email: string): Promise<TotpSetupResult> {
  const secret = createTotpSecret();
  const otpauthUrl = createOtpauthUrl(email, secret);

  return {
    secret,
    otpauthUrl,
    qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
  };
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  return (await verifyTotpCodeWithTimeStep(secret, code)) !== null;
}

export async function verifyTotpCodeWithTimeStep(
  secret: string,
  code: string,
  epoch = Math.floor(Date.now() / 1000),
): Promise<number | null> {
  if (!secret || !/^\d{6}$/.test(code)) return null;
  // epochTolerance: 30 allows one full TOTP period (30 seconds) of clock skew in either
  // direction, which is the standard recommendation for TOTP implementations per RFC 6238.
  // The previous value of 1 second was too tight and would reject valid codes from
  // authenticator apps with minor clock drift.
  const result = await totpFactory.verify(code, {
    secret,
    epochTolerance: 30,
    epoch,
  });

  return result.valid ? result.timeStep : null;
}

export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(16).toString("hex").toUpperCase();
    return `CF-${raw.match(/.{1,4}/g)?.join("-") ?? raw}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return crypto
    .createHash("sha256")
    .update(`commandflow-mfa-recovery:${code.replace(/[\s-]/g, "").toUpperCase()}`)
    .digest("hex");
}

export async function consumeTotpStep(
  db: Pick<PrismaClient, "user">,
  userId: string,
  timeStep: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(timeStep) || timeStep < 0) return false;
  const result = await db.user.updateMany({
    where: {
      id: userId,
      mfaEnabled: true,
      OR: [
        { lastMfaTotpStep: null },
        { lastMfaTotpStep: { lt: BigInt(timeStep) } },
      ],
    },
    data: { lastMfaTotpStep: BigInt(timeStep) },
  });
  return result.count === 1;
}

export async function consumeRecoveryCode(
  db: Pick<PrismaClient, "mfaRecoveryCode">,
  userId: string,
  code: string,
): Promise<boolean> {
  if (!code.trim()) return false;
  const result = await db.mfaRecoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(code), consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return result.count === 1;
}


export async function validateAndConsumeMfaChallenge(
  prisma: PrismaClient,
  { userId, challengeToken, purpose, riskLevel }: ConsumeMfaChallengeInput
): Promise<{ id: string; userId: string; purpose: string; riskLevel: string | null; challengeToken: string; expiresAt: Date; verifiedAt: Date | null }> {
  if (!userId || !challengeToken || !purpose) {
    throw new MfaChallengeError("A valid MFA challenge is required.");
  }

  const execute = async (client: PrismaClient | any) => {
    const challenge = await client.mfaChallenge.findUnique({
      where: { challengeToken },
    });

    if (!challenge) {
      throw new MfaChallengeError("Invalid MFA challenge.");
    }

    if (challenge.userId !== userId) {
      throw new MfaChallengeError("MFA challenge does not belong to this user.");
    }

    // The generic MFA endpoint can only prove possession of the user's TOTP
    // before the server has parsed the requested operation. Bind that proof to
    // the server-derived tool/approval purpose at consumption time. Existing
    // purpose-specific challenges still require an exact match.
    if (challenge.purpose !== purpose && challenge.purpose !== GENERIC_STEP_UP_MFA_PURPOSE) {
      throw new MfaChallengeError("MFA challenge purpose does not match this operation.");
    }

    if (challenge.verifiedAt) {
      throw new MfaChallengeError("MFA challenge has already been consumed.");
    }

    if (challenge.expiresAt <= new Date()) {
      throw new MfaChallengeError("MFA challenge has expired.");
    }

    const normalizedRiskLevel = riskLevel?.toUpperCase();
    if (normalizedRiskLevel && challenge.riskLevel && challenge.riskLevel !== normalizedRiskLevel) {
      throw new MfaChallengeError("MFA challenge risk does not match the requested operation.");
    }

    const consumed = await client.mfaChallenge.updateMany({
      where: {
        id: challenge.id,
        verifiedAt: null,
        purpose: { in: [purpose, GENERIC_STEP_UP_MFA_PURPOSE] },
      },
      data: {
        purpose,
        verifiedAt: new Date(),
      },
    });

    if (consumed.count !== 1) {
      throw new MfaChallengeError("MFA challenge has already been consumed.");
    }

    return client.mfaChallenge.findUnique({ where: { id: challenge.id } });
  };

  if (typeof (prisma as any).$transaction === "function") {
    return (prisma as any).$transaction(async (tx: any) => execute(tx));
  }

  return execute(prisma);
}

export function createChallengeToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
