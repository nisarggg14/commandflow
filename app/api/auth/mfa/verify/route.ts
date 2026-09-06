import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { verifyTotpCode, createChallengeToken, decryptSecret } from "@/lib/mfa";

export async function POST(req: NextRequest) {
  try {
    const authUser = authenticate(req);
    const { code, challengeToken, purpose, riskLevel } = await req.json();

    if (!code || typeof code !== "string") {
      return NextResponse.json({ success: false, message: "A 6-digit MFA code is required." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { mfaEnabled: true, mfaSecret: true },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      return NextResponse.json({ success: false, message: "MFA is not enabled for this account." }, { status: 403 });
    }

    if (!(await verifyTotpCode(decryptSecret(user.mfaSecret), code))) {
      return NextResponse.json({ success: false, message: "Invalid MFA code." }, { status: 401 });
    }

    const finalPurpose = typeof purpose === "string" && purpose.trim().length > 0 ? purpose.trim() : "step-up-mfa";
    const finalRiskLevel = typeof riskLevel === "string" && riskLevel.trim().length > 0 ? riskLevel.trim().toUpperCase() : "HIGH";

    if (!["LOW", "MEDIUM", "HIGH"].includes(finalRiskLevel)) {
      return NextResponse.json({ success: false, message: "Invalid step-up MFA risk level." }, { status: 400 });
    }

    let finalChallengeToken = challengeToken;
    if (!finalChallengeToken || typeof finalChallengeToken !== "string") {
      finalChallengeToken = createChallengeToken();
    }

    const challenge = await prisma.mfaChallenge.create({
      data: {
        userId: authUser.id,
        purpose: finalPurpose,
        riskLevel: finalRiskLevel,
        challengeToken: finalChallengeToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        verifiedAt: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "MFA verification succeeded.",
      challenge: {
        challengeToken: challenge.challengeToken,
        expiresAt: challenge.expiresAt,
        purpose: challenge.purpose,
        riskLevel: challenge.riskLevel,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Verification failed." }, { status: 500 });
  }
}
