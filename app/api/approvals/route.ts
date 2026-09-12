import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { listPendingApprovals } from "@/services/approval.service";

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticate(req);

    if (authUser.role !== "ADMIN") {
      throw new ForbiddenError("Only ADMIN users can view pending approvals.");
    }

    const approvals = await listPendingApprovals(prisma, authUser.companyId);

    return NextResponse.json({ success: true, approvals });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 403 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to load approvals." }, { status: 500 });
  }
}
