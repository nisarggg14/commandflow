import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { authenticate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeApiErrorResponse } from "@/lib/api-error-response";
import { ValidationFailedError } from "@/lib/errors";
import { continueApprovedApproval } from "@/services/approval-continuation.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await authenticate(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const challengeToken = typeof body?.challengeToken === "string" ? body.challengeToken.trim() : "";
    if (!challengeToken) throw new ValidationFailedError("A valid requester MFA challenge is required.");

    const result = await continueApprovedApproval({
      prisma,
      approvalId: id,
      userId: authUser.id,
      companyId: authUser.companyId,
      mfaChallengeToken: challengeToken,
      requestId: req.headers.get("x-request-id") ?? randomUUID(),
    });

    return NextResponse.json({ success: result.result.success, approval: result.approval, response: result.payload });
  } catch (error) {
    return safeApiErrorResponse(error, "api.approvals.continue", "Approved operation could not be continued.", 400);
  }
}
