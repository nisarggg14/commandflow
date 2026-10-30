import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { decryptSecret } from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const limit = await enforceRateLimit(
      `mfa-setup-key:${authUser.id}:${requestAddress(req)}`,
      5,
      5 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many setup-key requests." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
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

    if (!user) throw new UnauthorizedError("User not found.");
    if (
      user.mfaEnabled ||
      !user.pendingMfaSecret ||
      !user.pendingMfaExpiresAt ||
      user.pendingMfaExpiresAt <= new Date()
    ) {
      return NextResponse.json(
        { success: false, message: "There is no active MFA enrollment." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      manualSetupKey: decryptSecret(user.pendingMfaSecret),
      warning: "Keep this key private. Anyone with it can generate your MFA codes.",
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }
    console.error("[auth.mfa.setup-key] operation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { success: false, message: "MFA setup key is unavailable." },
      { status: 500 },
    );
  }
}
