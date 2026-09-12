import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { createCommandServer } from "@/services/tool.service";
import { getConnectedClientToolNames } from "@/services/mcp-connector.service";
import { Permission } from "@/mcp/types";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { const actor = await authenticate(req); requireRole(actor, [UserRole.ADMIN, UserRole.MANAGER]); const { id } = await params; const row = await prisma.automation.findFirst({ where: { id, companyId: actor.companyId, ownerId: actor.id, enabled: true } }); if (!row) return NextResponse.json({ success: false, message: "Automation not found or not owned by this user." }, { status: 404 }); const requestedKey = req.headers.get("idempotency-key") || new Date().toISOString().slice(0, 16); const claimed = await prisma.automation.updateMany({ where: { id: row.id, companyId: actor.companyId, OR: [{ lastExecutionKey: null }, { lastExecutionKey: { not: requestedKey } }] }, data: { lastExecutionKey: requestedKey, lastRunAt: new Date() } }); if (claimed.count !== 1) return NextResponse.json({ success: false, message: "This automation execution has already been accepted." }, { status: 409 }); const args = JSON.parse(row.argumentsJson); const enabled = await getConnectedClientToolNames(row.connectedClientId, actor.companyId, prisma); const server = createCommandServer(actor.id, actor.companyId, actor.role as Permission, undefined, row.connectedClientId, enabled); const result = await server.executeTool(row.toolName, args); return NextResponse.json({ success: result.success, result }); } catch (e) { return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Automation run failed." }, { status: 400 }); } }
