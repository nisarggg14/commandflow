import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/errors";
import { authenticate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getApprovalById } from "@/services/approval.service";
import { safeApiErrorResponse } from "@/lib/api-error-response";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await authenticate(req);
    const { id } = await params;

    const approval = await getApprovalById(prisma, id, authUser.companyId);

    if (!approval) {
      return NextResponse.json({ success: false, message: "Approval not found." }, { status: 404 });
    }

    if (authUser.role !== "ADMIN" && approval.requesterId !== authUser.id) {
      throw new ForbiddenError("You are not authorized to view this approval.");
    }

    return NextResponse.json({ success: true, approval });
  } catch (error) {
    return safeApiErrorResponse(error, "api.approvals.get", "Unable to load approval.");
  }
}
