import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/errors";
import { authenticate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listPendingApprovals } from "@/services/approval.service";
import { safeApiErrorResponse } from "@/lib/api-error-response";

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticate(req);

    if (authUser.role !== "ADMIN") {
      throw new ForbiddenError("Only ADMIN users can view pending approvals.");
    }

    const approvals = await listPendingApprovals(prisma, authUser.companyId);

    return NextResponse.json({ success: true, approvals });
  } catch (error) {
    return safeApiErrorResponse(error, "api.approvals.list", "Unable to load approvals.");
  }
}
