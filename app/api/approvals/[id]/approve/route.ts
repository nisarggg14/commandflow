import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/errors";

import { enforceRateLimit } from "@/lib/rate-limit";
import { authenticate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { approveApproval } from "@/services/approval.service";
import { verifyTotpCode, decryptSecret, createChallengeToken } from "@/lib/mfa";
import { safeApiErrorResponse } from "@/lib/api-error-response";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await authenticate(req);

    const limit = await enforceRateLimit(`approval:${authUser.id}`, 30, 60 * 1000);

    if (!limit.allowed) return NextResponse.json({ success: false, message: "Approval rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
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
    return safeApiErrorResponse(error, "api.approvals.approve", "Approval could not be processed.", 400);
  }
}
