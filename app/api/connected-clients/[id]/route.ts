import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { connectedClientErrorResponse } from "@/lib/connected-client-api-error";
import { getConnectedClientById, updateConnectedClient, deleteConnectedClient } from "@/services/connected-client.service";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try { const authUser = await authenticate(req); const { id } = await params; return NextResponse.json({ success: true, connectedClient: await getConnectedClientById(id, authUser.companyId) }); }
  catch (error) { return connectedClientErrorResponse(error); }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try { const authUser = await authenticate(req); requireRole(authUser, [UserRole.ADMIN, UserRole.MANAGER]); const { id } = await params; return NextResponse.json({ success: true, connectedClient: await updateConnectedClient(id, await req.json(), { id: authUser.id, companyId: authUser.companyId }) }); }
  catch (error) { return connectedClientErrorResponse(error); }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try { const authUser = await authenticate(req); requireRole(authUser, [UserRole.ADMIN]); const { id } = await params; const result = await deleteConnectedClient(id, { id: authUser.id, companyId: authUser.companyId }); return NextResponse.json(result); }
  catch (error) { return connectedClientErrorResponse(error); }
}
