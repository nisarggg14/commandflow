import type { PrismaClient, User } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, comparePassword } from "@/lib/bcrypt";
import { generateToken, hashSessionToken, verifyToken } from "@/lib/jwt";
import { registerSchema, loginSchema } from "@/validators/auth.validator";
import { UserRole } from "@prisma/client";
import { AuthenticationServiceError, UnauthorizedError } from "@/lib/errors";
import {
  consumeRecoveryCode,
  consumeTotpStep,
  createChallengeToken,
  decryptSecret,
  verifyTotpCodeWithTimeStep,
} from "@/lib/mfa";

const LOGIN_MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTHENTICATED_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LoginResult =
  | { success: true; mfaRequired: true; challengeToken: string; expiresAt: string }
  | { success: true; mfaRequired: false; message: string; token: string; user: Record<string, unknown> };

export const DUPLICATE_ACCOUNT_MESSAGE = "An account with this email already exists.";
export const EXISTING_COMPANY_MESSAGE = "A company with this name already exists. Use an invitation code to join.";
export const INVALID_INVITATION_CODE_MESSAGE = "Invitation code is invalid.";

export function resolvePublicRegistrationRole(isInitialCompanyUser: boolean): UserRole {
  return isInitialCompanyUser ? UserRole.ADMIN : UserRole.VIEWER;
}

export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase();
}

function sanitizeUser(user: { [key: string]: unknown }) {
  const {
    password,
    mfaSecret,
    pendingMfaSecret,
    pendingMfaExpiresAt,
    lastMfaTotpStep,
    ...rest
  } = user;
  return rest;
}

function registrationConflict(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "P2002") {
    return undefined;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = Array.isArray(target)
    ? target.filter((field): field is string => typeof field === "string")
    : typeof target === "string"
      ? [target]
      : [];

  if (fields.some((field) => field.toLowerCase().includes("slug") || field.toLowerCase().includes("normalizedname"))) {
    return EXISTING_COMPANY_MESSAGE;
  }
  if (fields.some((field) => field.toLowerCase().includes("email"))) {
    return DUPLICATE_ACCOUNT_MESSAGE;
  }
  return undefined;
}

export async function registerUser(data: unknown, db: PrismaClient = prisma) {
  const validatedData = registerSchema.parse(data);

  if (process.env.NODE_ENV === "production" && (validatedData.password.length < 12 || ["admin123", "password", "password123", "commandflow"].includes(validatedData.password.toLowerCase()))) throw new Error("A strong production password is required.");

  const hashedPassword = await hashPassword(validatedData.password);
  const invitationCode = validatedData.invitationCode?.trim();
  const companyName = validatedData.companyName?.trim();
  if (!invitationCode && (!companyName || companyName.length < 2)) {
    throw new Error("Enter a company name or an invitation code.");
  }
  const newCompanyName = companyName ?? "";
  const normalizedName = normalizeCompanyName(newCompanyName);

  let registration: {
    company: { id: string; name: string; slug: string };
    user: User;
    token: string;
    joinedExistingCompany: boolean;
  };
  try {
    registration = await db.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: validatedData.email },
        select: { id: true },
      });
      if (existingUser) throw new Error(DUPLICATE_ACCOUNT_MESSAGE);

      const company = invitationCode
        ? await tx.company.findUnique({
            where: {
              invitationCodeHash: createHash("sha256").update(invitationCode).digest("hex"),
            },
            select: { id: true, name: true, slug: true },
          })
        : await tx.company.create({
            data: {
              name: newCompanyName,
              normalizedName,
              slug: newCompanyName.toLowerCase().replace(/\s+/g, "-"),
            },
            select: { id: true, name: true, slug: true },
          });

      if (!company) throw new Error(INVALID_INVITATION_CODE_MESSAGE);

      const user = await tx.user.create({
        data: {
          name: validatedData.name,
          email: validatedData.email,
          password: hashedPassword,
          role: resolvePublicRegistrationRole(!invitationCode),
          companyId: company.id,
        },
      });
      const token = generateToken({
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
      });
      await tx.session.create({
        data: {
          token: hashSessionToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + AUTHENTICATED_SESSION_TTL_MS),
        },
      });

      return { company, user, token, joinedExistingCompany: Boolean(invitationCode) };
    });
  } catch (error) {
    const conflict = registrationConflict(error);
    if (conflict) throw new Error(conflict);
    throw error;
  }

  return {
    success: true,
    message: registration.joinedExistingCompany
      ? "Account created and joined the company."
      : "Company and admin user created successfully",
    token: registration.token,
    user: sanitizeUser(registration.user),
    company: registration.company,
  };
}

export async function loginUser(
  data: unknown,
  db: PrismaClient = prisma,
): Promise<LoginResult> {
  const validatedData = loginSchema.parse(data);

  let user;
  try {
    user = await db.user.findUnique({
      where: {
        email: validatedData.email,
      },
      include: { company: { select: { id: true, name: true, slug: true } } },
    });
  } catch (error) {
    throw new AuthenticationServiceError("Authentication data store unavailable.", error);
  }

  if (!user) {
    throw new UnauthorizedError("Invalid email or password.");
  }

  if (!user.active) throw new UnauthorizedError("This account is disabled.");
  if (!user.company || user.company.id !== user.companyId) throw new UnauthorizedError("This account has no valid company association.");

  const isPasswordValid = await comparePassword(validatedData.password, user.password);

  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid email or password.");
  }

  if (user.mfaEnabled) {
    if (!user.mfaSecret) {
      throw new AuthenticationServiceError("MFA configuration is incomplete.");
    }
    const challengeToken = createChallengeToken();
    const expiresAt = new Date(Date.now() + LOGIN_MFA_CHALLENGE_TTL_MS);
    try {
      await db.mfaLoginChallenge.create({
        data: {
          userId: user.id,
          challengeHash: hashSessionToken(challengeToken),
          expiresAt,
        },
      });
    } catch (error) {
      throw new AuthenticationServiceError("MFA login challenge unavailable.", error);
    }
    return {
      success: true,
      mfaRequired: true,
      challengeToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  return createAuthenticatedLogin(user, db);
}

async function createAuthenticatedLogin(
  user: User,
  db: PrismaClient = prisma,
): Promise<LoginResult & { mfaRequired: false }> {
  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

  try {
    await db.session.create({ data: { token: hashSessionToken(token), userId: user.id, expiresAt: new Date(Date.now() + AUTHENTICATED_SESSION_TTL_MS) } });
  } catch (error) {
    throw new AuthenticationServiceError("Authentication session store unavailable.", error);
  }
  return {
    success: true,
    mfaRequired: false,
    message: "Login successful",
    token,
    user: sanitizeUser(user),
  };
}

export async function verifyMfaLogin(
  input: { challengeToken: string; code?: string; recoveryCode?: string },
  db: PrismaClient = prisma,
): Promise<Extract<LoginResult, { mfaRequired: false }>> {
  const challengeHash = hashSessionToken(input.challengeToken);
  let challenge;
  try {
    challenge = await db.mfaLoginChallenge.findUnique({
      where: { challengeHash },
      include: { user: { include: { company: true } } },
    });
  } catch (error) {
    throw new AuthenticationServiceError("MFA login service unavailable.", error);
  }
  const now = new Date();
  const user = challenge?.user;
  if (
    !challenge ||
    challenge.consumedAt ||
    challenge.expiresAt <= now ||
    !user ||
    !user.active ||
    !user.mfaEnabled ||
    !user.mfaSecret ||
    !user.company ||
    user.company.id !== user.companyId
  ) {
    throw new UnauthorizedError("Invalid or expired MFA login challenge.");
  }

  let acceptedTimeStep: number | null = null;
  const useRecoveryCode = Boolean(input.recoveryCode);
  if (!useRecoveryCode && input.code) {
    acceptedTimeStep = await verifyTotpCodeWithTimeStep(
      decryptSecret(user.mfaSecret),
      input.code,
    );
    if (acceptedTimeStep === null) {
      throw new UnauthorizedError("Invalid MFA verification code.");
    }
  } else if (!useRecoveryCode) {
    throw new UnauthorizedError("A valid MFA code is required.");
  }

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    companyId: user.company.id,
  });
  try {
    await db.$transaction(async (tx) => {
      const consumedChallenge = await tx.mfaLoginChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumedChallenge.count !== 1) {
        throw new UnauthorizedError("Invalid or expired MFA login challenge.");
      }
      if (acceptedTimeStep !== null && !(await consumeTotpStep(tx, user.id, acceptedTimeStep))) {
        throw new UnauthorizedError("MFA verification code has already been used.");
      }
      if (useRecoveryCode && !(await consumeRecoveryCode(tx, user.id, input.recoveryCode!))) {
        throw new UnauthorizedError("Invalid MFA verification code.");
      }
      await tx.session.create({
        data: {
          token: hashSessionToken(token),
          userId: user.id,
          expiresAt: new Date(now.getTime() + AUTHENTICATED_SESSION_TTL_MS),
        },
      });
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new AuthenticationServiceError("MFA login session unavailable.", error);
  }

  return {
    success: true,
    mfaRequired: false,
    message: "Login successful",
    token,
    user: sanitizeUser(user),
  };
}

export async function getCurrentUser(userId: string) {
  let user;
  try {
    user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: { id: true, name: true, email: true, role: true, active: true, mfaEnabled: true, companyId: true, company: { select: { id: true, name: true, slug: true } } },
    });
  } catch (error) {
    throw new AuthenticationServiceError("Authentication service unavailable. Please try again later.", error);
  }

  if (!user || !user.active || !user.company || user.company.id !== user.companyId) throw new UnauthorizedError("User account or company association is unavailable.");

  return user;
}
