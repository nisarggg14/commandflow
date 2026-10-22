import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { comparePassword } from "@/lib/bcrypt";
import {
  consumeRecoveryCode,
  decryptSecret,
  verifyTotpCodeWithTimeStep,
} from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";

const disableSchema = z.object({
  password: z.string().min(1).max(200),
  code: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(12).max(64).optional(),
}).refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
  message: "Provide either a TOTP code or a recovery code.",
});

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const limit = await enforceRateLimit(
      `mfa-disable:${authUser.id}:${requestAddress(req)}`,
      5,
      5 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many MFA attempts." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    const input = disableSchema.parse(await req.json().catch(() => null));
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { password: true, mfaEnabled: true, mfaSecret: true },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      return NextResponse.json(
        { success: false, message: "MFA is not enabled for this account." },
        { status: 409 },
      );
    }
    if (!(await comparePassword(input.password, user.password))) {
      return NextResponse.json({ success: false, message: "Invalid password or MFA code." }, { status: 401 });
    }

    const timeStep = input.code
      ? await verifyTotpCodeWithTimeStep(decryptSecret(user.mfaSecret), input.code)
      : null;
    if (input.code && timeStep === null) {
      return NextResponse.json({ success: false, message: "Invalid password or MFA code." }, { status: 401 });
    }
    const now = new Date();
    const invalidProof = new Error("Invalid MFA disable proof.");
    let disabled = false;
    try {
      disabled = await prisma.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: {
            id: authUser.id,
            mfaEnabled: true,
            ...(timeStep === null
              ? {}
              : {
                  OR: [
                    { lastMfaTotpStep: null },
                    { lastMfaTotpStep: { lt: BigInt(timeStep) } },
                  ],
                }),
          },
          data: {
            mfaEnabled: false,
            mfaSecret: null,
            pendingMfaSecret: null,
            pendingMfaExpiresAt: null,
            lastMfaTotpStep: null,
          },
        });
        if (changed.count !== 1) return false;
        if (
          input.recoveryCode &&
          !(await consumeRecoveryCode(tx, authUser.id, input.recoveryCode))
        ) {
          throw invalidProof;
        }
        await tx.session.deleteMany({ where: { userId: authUser.id } });
        await tx.mfaChallenge.deleteMany({ where: { userId: authUser.id } });
        await tx.mfaLoginChallenge.deleteMany({ where: { userId: authUser.id } });
        await tx.mfaRecoveryCode.deleteMany({ where: { userId: authUser.id } });
        return true;
      });
    } catch (error) {
      if (error !== invalidProof) throw error;
    }

    if (!disabled) {
      return NextResponse.json(
        { success: false, message: "Invalid password or MFA code. The code may already have been used." },
        { status: 401 },
      );
    }

    const response = NextResponse.json({
      success: true,
      message: "MFA disabled. Sign in again to continue.",
    });
    response.cookies.set("token", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Provide a password and either a current MFA code or a recovery code." },
        { status: 400 },
      );
    }
    console.error("[auth.mfa.disable] operation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { success: false, message: "MFA could not be disabled. Please try again later." },
      { status: 500 },
    );
  }
}
