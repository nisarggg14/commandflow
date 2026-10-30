import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";

import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { safeApiErrorResponse } from "@/lib/api-error-response";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticate(req);
    requireRole(actor, [UserRole.ADMIN]);

    const invitationCode = randomBytes(32).toString("base64url");
    const invitationCodeHash = createHash("sha256").update(invitationCode).digest("hex");
    await prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: actor.companyId },
        data: { invitationCodeHash },
        select: { id: true },
      });
      await tx.activityLog.create({
        data: {
          action: "COMPANY_INVITATION_CODE_ROTATED",
          status: "SUCCESS",
          details: JSON.stringify({ invitationCodeRotated: true }),
          userId: actor.id,
          companyId: actor.companyId,
        },
      });
    });

    return NextResponse.json({ success: true, invitationCode });
  } catch (error) {
    return safeApiErrorResponse(error, "api.admin.invitation-code", "Unable to generate an invitation code.");
  }
}
