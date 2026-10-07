import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { createCommandServer } from "@/services/tool.service";
import { getConnectedClientToolNames } from "@/services/mcp-connector.service";
import { Permission } from "@/mcp/types";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let claimedExecution = false;
  let automationId: string | undefined;
  try {
    const actor = await authenticate(req);
    requireRole(actor, [UserRole.ADMIN, UserRole.MANAGER]);
    const { id } = await params;
    const row = await prisma.automation.findFirst({ where: { id, companyId: actor.companyId, ownerId: actor.id, enabled: true } });
    if (!row) return NextResponse.json({ success: false, message: "Automation not found or not owned by this user." }, { status: 404 });
    automationId = row.id;
    const requestedKey = req.headers.get("idempotency-key")?.trim();
    if (!requestedKey || requestedKey.length > 200) return NextResponse.json({ success: false, message: "An Idempotency-Key is required." }, { status: 400 });
    const claimedCount = await prisma.$executeRaw`UPDATE "Automation" SET "lastExecutionKey" = ${requestedKey}, "lastExecutionStatus" = ${"RUNNING"}, "lastRunAt" = ${new Date()} WHERE "id" = ${row.id} AND "companyId" = ${actor.companyId} AND ("lastExecutionKey" IS NULL OR "lastExecutionKey" <> ${requestedKey} OR ("lastExecutionKey" = ${requestedKey} AND "lastExecutionStatus" = ${"FAILED"}))`;

    if (claimedCount !== 1) return NextResponse.json({ success: false, message: "This automation execution has already been accepted." }, { status: 409 });
    claimedExecution = true;
    const args = JSON.parse(row.argumentsJson);
    const enabled = await getConnectedClientToolNames(row.connectedClientId, actor.companyId, prisma);
    const server = createCommandServer(actor.id, actor.companyId, actor.role as Permission, undefined, row.connectedClientId, enabled);
    const result = await server.executeTool(row.toolName, args);
    await prisma.$executeRaw`UPDATE "Automation" SET "lastExecutionStatus" = ${result.success ? "SUCCEEDED" : "FAILED"} WHERE "id" = ${row.id} AND "lastExecutionKey" = ${requestedKey} AND "lastExecutionStatus" = ${"RUNNING"}`;
    return NextResponse.json({ success: result.success, result });
  } catch (e) {
    if (claimedExecution && automationId) await prisma.$executeRaw`UPDATE "Automation" SET "lastExecutionStatus" = ${"FAILED"} WHERE "id" = ${automationId} AND "lastExecutionStatus" = ${"RUNNING"}`;
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Automation run failed." }, { status: 400 });
  }
}