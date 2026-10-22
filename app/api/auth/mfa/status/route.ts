import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { isMfaEnrollmentActive } from "@/lib/mfa";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        mfaEnabled: true,
        pendingMfaSecret: true,
        pendingMfaExpiresAt: true,
      },
    });
    if (!user) throw new UnauthorizedError("User not found.");

    const now = new Date();
    const enrollmentPending = isMfaEnrollmentActive(
      user.pendingMfaSecret,
      user.pendingMfaExpiresAt,
      now,
    );
    if (user.pendingMfaExpiresAt && !enrollmentPending) {
      await prisma.user.updateMany({
        where: { id: authUser.id, mfaEnabled: false, pendingMfaExpiresAt: { lte: now } },
        data: { pendingMfaSecret: null, pendingMfaExpiresAt: null },
      });
    }

    return NextResponse.json({
      success: true,
      mfaEnabled: user.mfaEnabled,
      enrollmentPending,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }
    console.error("[auth.mfa.status] operation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { success: false, message: "Unable to load MFA status." },
      { status: 500 },
    );
  }
}
