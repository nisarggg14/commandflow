import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { UnauthorizedError, ForbiddenError, ConflictError } from "@/lib/errors";
import { createConnectedClient, listConnectedClients } from "@/services/connected-client.service";

function errorResponse(error: unknown) {
  console.error("Connected client request failed:", error instanceof Error ? error.message : "unknown error");
  if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, message: error.message }, { status: 401 });
  if (error instanceof ForbiddenError) return NextResponse.json({ success: false, message: error.message }, { status: 403 });
  if (error instanceof ConflictError) return NextResponse.json({ success: false, message: error.message }, { status: 409 });
  if (error && typeof error === "object" && (error as { name?: string }).name === "ZodError") return NextResponse.json({ success: false, message: "Invalid connected client data.", issues: (error as { issues?: unknown }).issues }, { status: 400 });
  return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const statusParam = req.nextUrl.searchParams.get("status");
    const status = statusParam === "ACTIVE" || statusParam === "INACTIVE" ? statusParam : undefined;
    return NextResponse.json({ success: true, connectedClients: await listConnectedClients(authUser.companyId, { status }) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    requireRole(authUser, [UserRole.ADMIN, UserRole.MANAGER]);
    return NextResponse.json({ success: true, connectedClient: await createConnectedClient(await req.json(), { id: authUser.id, companyId: authUser.companyId }) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
