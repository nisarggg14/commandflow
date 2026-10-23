import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { connectedClientErrorResponse } from "@/lib/connected-client-api-error";
import { createConnectedClient, listConnectedClients } from "@/services/connected-client.service";

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const statusParam = req.nextUrl.searchParams.get("status");
    const status = statusParam === "ACTIVE" || statusParam === "INACTIVE" ? statusParam : undefined;
    return NextResponse.json({ success: true, connectedClients: await listConnectedClients(authUser.companyId, { status }) });
  } catch (error) { return connectedClientErrorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    requireRole(authUser, [UserRole.ADMIN]);
    return NextResponse.json({ success: true, connectedClient: await createConnectedClient(await req.json(), { id: authUser.id, companyId: authUser.companyId }) }, { status: 201 });
  } catch (error) { return connectedClientErrorResponse(error); }
}
