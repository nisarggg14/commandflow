import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { UnauthorizedError, ForbiddenError, NotFoundError, ConflictError } from "@/lib/errors";
import { getConnectedClientById, updateConnectedClient, deleteConnectedClient } from "@/services/connected-client.service";

function errorResponse(error: unknown) {
  console.error("Connected client request failed:", error instanceof Error ? error.message : "unknown error");
  if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, message: error.message }, { status: 401 });
  if (error instanceof ForbiddenError) return NextResponse.json({ success: false, message: error.message }, { status: 403 });
  if (error instanceof NotFoundError) return NextResponse.json({ success: false, message: error.message }, { status: 404 });
  if (error instanceof ConflictError) return NextResponse.json({ success: false, message: error.message }, { status: 409 });
  if (error && typeof error === "object" && (error as { name?: string }).name === "ZodError") return NextResponse.json({ success: false, message: "Invalid connected client data.", issues: (error as { issues?: unknown }).issues }, { status: 400 });
  return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
}

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try { const authUser = await authenticate(req); const { id } = await params; return NextResponse.json({ success: true, connectedClient: await getConnectedClientById(id, authUser.companyId) }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try { const authUser = await authenticate(req); requireRole(authUser, [UserRole.ADMIN, UserRole.MANAGER]); const { id } = await params; return NextResponse.json({ success: true, connectedClient: await updateConnectedClient(id, await req.json(), { id: authUser.id, companyId: authUser.companyId }) }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try { const authUser = await authenticate(req); requireRole(authUser, [UserRole.ADMIN]); const { id } = await params; const result = await deleteConnectedClient(id, { id: authUser.id, companyId: authUser.companyId }); return NextResponse.json(result); }
  catch (error) { return errorResponse(error); }
}
