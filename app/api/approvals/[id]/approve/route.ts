import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { approveApproval } from "@/services/approval.service";
import { verifyTotpCode, decryptSecret, createChallengeToken } from "@/lib/mfa";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = authenticate(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === "string" ? body.code : undefined;

    if (authUser.role !== "ADMIN") {
      throw new ForbiddenError("Only ADMIN users can approve high-risk requests.");
    }

    const approver = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { id: true, mfaEnabled: true, mfaSecret: true, companyId: true, role: true },
    });

    if (!approver || !approver.mfaEnabled || !approver.mfaSecret) {
      return NextResponse.json({ success: false, message: "Approver MFA is required to approve a high-risk request." }, { status: 403 });
    }

    if (!code || typeof code !== "string") {
      return NextResponse.json({ success: false, message: "A valid MFA code is required to approve a request." }, { status: 400 });
    }

    if (!(await verifyTotpCode(decryptSecret(approver.mfaSecret), code))) {
      return NextResponse.json({ success: false, message: "Invalid approver MFA code." }, { status: 401 });
    }

    const challengeToken = createChallengeToken();
    const challenge = await prisma.mfaChallenge.create({
      data: {
        userId: authUser.id,
        purpose: `approval:${id}:approve`,
        riskLevel: "HIGH",
        challengeToken,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    const approval = await approveApproval({
      prisma,
      approvalId: id,
      approverId: authUser.id,
      companyId: authUser.companyId,
      mfaChallengeToken: challenge.challengeToken,
    });

    return NextResponse.json({ success: true, approval });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 403 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Approval failed." }, { status: 400 });
  }
}
