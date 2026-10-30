import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "@/lib/auth";
import { requireRole } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { CLIENT_TOOL_NAMES } from "@/mcp/client-tool-policy";

import { createCommandServer } from "@/services/tool.service";

import { getConnectedClientToolNames } from "@/services/mcp-connector.service";

import { Permission } from "@/mcp/types";
import { safeApiErrorResponse } from "@/lib/api-error-response";

const schema = z.object({ name: z.string().trim().min(1).max(80), toolName: z.enum(CLIENT_TOOL_NAMES), arguments: z.record(z.string(), z.unknown()).default({}), schedule: z.string().trim().min(1).max(100).regex(/^[0-9*/?, -]+$/), connectedClientId: z.string().min(1) });
function fail(e: unknown) { return safeApiErrorResponse(e, "api.automations", "Automation request failed.", 400); }
export async function GET(req: NextRequest) { try { const actor = await authenticate(req); requireRole(actor, [UserRole.ADMIN, UserRole.MANAGER]); const rows = await prisma.automation.findMany({ where: { companyId: actor.companyId }, select: { id: true, name: true, toolName: true, argumentsJson: true, schedule: true, enabled: true, lastRunAt: true, ownerId: true, connectedClientId: true, createdAt: true }, orderBy: { createdAt: "desc" } }); return NextResponse.json({ success: true, automations: rows.map(r => ({ ...r, arguments: JSON.parse(r.argumentsJson), argumentsJson: undefined })) }); } catch (e) { return fail(e); } }
export async function POST(req: NextRequest) { try { const actor = await authenticate(req); requireRole(actor, [UserRole.ADMIN, UserRole.MANAGER]); const input = schema.parse(await req.json()); const client = await prisma.connectedClient.findFirst({ where: { id: input.connectedClientId, companyId: actor.companyId, status: "ACTIVE" }, select: { id: true } }); if (!client) throw new Error("Selected connected client is unavailable."); const enabled = await getConnectedClientToolNames(input.connectedClientId, actor.companyId, prisma); const server = createCommandServer(actor.id, actor.companyId, actor.role as Permission, undefined, input.connectedClientId, enabled); const validatedArguments = server.validateToolInput(input.toolName, input.arguments); const automation = await prisma.automation.create({ data: { name: input.name, toolName: input.toolName, argumentsJson: JSON.stringify(validatedArguments), schedule: input.schedule, companyId: actor.companyId, ownerId: actor.id, connectedClientId: client.id } }); await prisma.activityLog.create({ data: { action: "AUTOMATION_CREATED", status: "SUCCESS", details: JSON.stringify({ automationId: automation.id, toolName: input.toolName, schedule: input.schedule, connectedClientId: client.id }), userId: actor.id, companyId: actor.companyId, connectedClientId: client.id } }); return NextResponse.json({ success: true, automation: { ...automation, arguments: validatedArguments, argumentsJson: undefined } }, { status: 201 }); } catch (e) { return fail(e); } }
