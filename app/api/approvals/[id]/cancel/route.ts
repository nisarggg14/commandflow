import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit } from "@/lib/rate-limit";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { cancelApproval } from "@/services/approval.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await authenticate(req);

    const limit = await enforceRateLimit(`approval:${authUser.id}`, 30, 60 * 1000);

    if (!limit.allowed) return NextResponse.json({ success: false, message: "Approval rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const { id } = await params;

    const approval = await cancelApproval({
      prisma,
      approvalId: id,
      requesterId: authUser.id,
      companyId: authUser.companyId,
    });

    return NextResponse.json({ success: true, approval });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 403 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Cancellation failed." }, { status: 400 });
  }
}
