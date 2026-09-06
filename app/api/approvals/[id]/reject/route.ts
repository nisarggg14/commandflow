import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { rejectApproval } from "@/services/approval.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = authenticate(req);
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
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 403 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Rejection failed." }, { status: 400 });
  }
}
