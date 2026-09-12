import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

function responseError(error: unknown) { const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 400; return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Request failed." }, { status }); }
export async function GET(req: NextRequest) { try { const actor = await authenticate(req); requireRole(actor, [UserRole.ADMIN]); const users = await prisma.user.findMany({ where: { companyId: actor.companyId }, select: { id: true, name: true, email: true, role: true, active: true, mfaEnabled: true, createdAt: true }, orderBy: { createdAt: "asc" } }); return NextResponse.json({ success: true, users }); } catch (e) { return responseError(e); } }
export async function PATCH(req: NextRequest) {
  try {
    const actor = await authenticate(req); requireRole(actor, [UserRole.ADMIN]);
    const body = await req.json(); const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId) throw new Error("User ID is required.");
    const target = await prisma.user.findFirst({ where: { id: userId, companyId: actor.companyId } });
    if (!target) throw new Error("User not found.");
    const data: { role?: UserRole; active?: boolean } = {};
    if (body.role !== undefined) { if (!["ADMIN", "MANAGER", "VIEWER"].includes(body.role)) throw new Error("Invalid role."); data.role = body.role as UserRole; }
    if (body.active !== undefined) { if (typeof body.active !== "boolean") throw new Error("Active must be boolean."); data.active = body.active; }
    if (actor.id === target.id && (data.active === false || data.role && data.role !== UserRole.ADMIN)) throw new Error("You cannot remove your own required administrator access.");
    if (target.role === UserRole.ADMIN && (data.active === false || data.role && data.role !== UserRole.ADMIN)) {
      const admins = await prisma.user.count({ where: { companyId: actor.companyId, role: UserRole.ADMIN, active: true } });
      if (admins <= 1) throw new Error("The company must retain an active administrator.");
    }
    const updated = await prisma.$transaction(async (tx) => { const result = await tx.user.update({ where: { id: target.id }, data, select: { id: true, name: true, email: true, role: true, active: true, mfaEnabled: true } }); await tx.activityLog.create({ data: { action: "ADMIN_USER_UPDATED", status: "SUCCESS", details: JSON.stringify({ targetUserId: target.id, changedFields: Object.keys(data), role: data.role, active: data.active }), userId: actor.id, companyId: actor.companyId } }); return result; });
    return NextResponse.json({ success: true, user: updated });
  } catch (e) { return responseError(e); }
}
