import { NextRequest, NextResponse } from "next/server";
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from "@/lib/errors";

import { enforceRateLimit } from "@/lib/rate-limit";
import { authenticate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rejectApproval } from "@/services/approval.service";
import { safeApiErrorResponse } from "@/lib/api-error-response";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await authenticate(req);

    const limit = await enforceRateLimit(`approval:${authUser.id}`, 30, 60 * 1000);

    if (!limit.allowed) return NextResponse.json({ success: false, message: "Approval rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : undefined;

    if (authUser.role !== "ADMIN") {
      throw new ForbiddenError("Only ADMIN users can reject approval requests.");
    }

    const approval = await rejectApproval({
      prisma,
      approvalId: id,
      approverId: authUser.id,
      companyId: authUser.companyId,
      reason,
    });

    return NextResponse.json({ success: true, approval });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof ForbiddenError ||
      error instanceof NotFoundError ||
      error instanceof ValidationFailedError
    ) {
      console.warn("[api.approvals.reject] request rejected", {
        errorName: error.name,
        errorMessage: error.message,
      });
    }
    return safeApiErrorResponse(error, "api.approvals.reject", "Rejection could not be processed.", 400);
  }
}
