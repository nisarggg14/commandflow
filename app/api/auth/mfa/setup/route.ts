import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { createTotpSetupResult, encryptSecret, MFA_ENROLLMENT_TTL_MS } from "@/lib/mfa";

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
        { success: false, message: "Too many MFA setup attempts." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { email: true, mfaEnabled: true },
    });

    if (!user) {
      throw new UnauthorizedError("User not found.");
    }

    if (user.mfaEnabled) {
      return NextResponse.json({ success: false, message: "MFA is already enabled." }, { status: 409 });
    }

    const setup = await createTotpSetupResult(user.email);
    const expiresAt = new Date(Date.now() + MFA_ENROLLMENT_TTL_MS);

    await prisma.user.update({
      where: { id: authUser.id },
      data: {
        pendingMfaSecret: encryptSecret(setup.secret),
        pendingMfaExpiresAt: expiresAt,
      },
    });

    return NextResponse.json({
      success: true,
      setup: {
        qrCodeDataUrl: setup.qrCodeDataUrl,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    console.error("[auth.mfa.setup] operation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ success: false, message: "MFA setup failed. Please try again later." }, { status: 500 });
  }
}
