import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import {
  createRecoveryCodes,
  decryptSecret,
  hashRecoveryCode,
  verifyTotpCodeWithTimeStep,
} from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const limit = await enforceRateLimit(
      `mfa-setup:${authUser.id}:${requestAddress(req)}`,
      5,
      5 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many MFA attempts." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    const code =
      body && typeof body === "object" && "code" in body && typeof body.code === "string"
        ? body.code
        : "";
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { success: false, message: "A valid 6-digit MFA code is required." },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        mfaEnabled: true,
        pendingMfaSecret: true,
        pendingMfaExpiresAt: true,
      },
    });
    if (
      !user ||
      user.mfaEnabled ||
      !user.pendingMfaSecret ||
      !user.pendingMfaExpiresAt ||
      user.pendingMfaExpiresAt <= new Date()
    ) {
      return NextResponse.json(
        { success: false, message: "MFA enrollment is missing or has expired. Start enrollment again." },
        { status: 400 },
      );
    }

    const timeStep = await verifyTotpCodeWithTimeStep(
      decryptSecret(user.pendingMfaSecret),
      code,
    );
    if (timeStep === null) {
      return NextResponse.json({ success: false, message: "Invalid MFA code." }, { status: 401 });
    }

    const recoveryCodes = createRecoveryCodes();
    const now = new Date();
    const enabled = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id: authUser.id,
          mfaEnabled: false,
          pendingMfaSecret: user.pendingMfaSecret,
          pendingMfaExpiresAt: { gt: now },
          OR: [
            { lastMfaTotpStep: null },
            { lastMfaTotpStep: { lt: BigInt(timeStep) } },
          ],
        },
        data: {
          mfaEnabled: true,
          mfaSecret: user.pendingMfaSecret,
          pendingMfaSecret: null,
          pendingMfaExpiresAt: null,
          lastMfaTotpStep: BigInt(timeStep),
        },
      });
      if (result.count !== 1) return false;

      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          userId: authUser.id,
          codeHash: hashRecoveryCode(recoveryCode),
        })),
      });
      return true;
    });

    if (!enabled) {
      return NextResponse.json(
        { success: false, message: "MFA enrollment expired or the code was already used. Start enrollment again." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "MFA enabled.",
      recoveryCodes,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }
    console.error("[auth.mfa.verify-setup] operation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { success: false, message: "MFA verification failed. Please try again later." },
      { status: 500 },
    );
  }
}
