import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { verifyTotpCode, createChallengeToken, decryptSecret, GENERIC_STEP_UP_MFA_PURPOSE } from "@/lib/mfa";

// Security: purpose and riskLevel are server-assigned and must NOT be accepted from the
// client. The client supplies only the TOTP code. Accepting a client-supplied purpose
// would allow a client to forge a challenge for any arbitrary security context (e.g.,
// mimicking an approval-specific purpose like "approval:<id>:approve").
const SERVER_MFA_RISK_LEVEL = "HIGH";

export async function POST(req: NextRequest) {
  try {
    const authUser = authenticate(req);

    // Only accept `code` and `challengeToken` from the client.
    // `purpose` and `riskLevel` are intentionally ignored — they are server-controlled.
    const { code, challengeToken } = await req.json();

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

    // Generate a challenge token if the client did not supply one.
    const finalChallengeToken =
      typeof challengeToken === "string" && challengeToken.trim().length > 0
        ? challengeToken.trim()
        : createChallengeToken();

    const challenge = await prisma.mfaChallenge.create({
      data: {
        userId: authUser.id,
        // Server-assigned: purpose and risk level cannot be overridden by the client.
        purpose: GENERIC_STEP_UP_MFA_PURPOSE,
        riskLevel: SERVER_MFA_RISK_LEVEL,
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

