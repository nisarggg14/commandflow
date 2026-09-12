import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getApprovalById } from "@/services/approval.service";

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
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 403 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to load approval." }, { status: 500 });
  }
}
