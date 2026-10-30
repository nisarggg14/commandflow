import { prisma } from "@/lib/prisma";
import { MessageRole, UserRole } from "@prisma/client";
import { parseCommand, type ParsedCommand } from "./command-parser.service";
import { createCommandServer } from "./tool.service";
import { Permission } from "@/mcp/types";
import { resolveProductReference } from "./product-resolver.service";
import { getConnectedClientToolNames, validateConnectedClientSelection } from "./mcp-connector.service";
import { runWithExternalRequestTrace } from "./external-request-trace";
import { EXECUTION_STAGE_DEFINITIONS, type ExecutionStage, type ExecutionStageId, type ExternalRequestTraceHooks } from "@/types/execution-trace";
import type { ToolExecutionTraceHooks } from "@/mcp/types";
import { getExecutionStatus } from "@/lib/execution-status";
import { logServerError } from "@/lib/server-error-logging";
import { InventoryApiError } from "@/services/inventory-api.service";
import { toolRequiresConnectedClient } from "@/mcp/client-tool-policy";

interface ChatRequest {
  conversationId: string;
  message: string;
  userId: string;
  companyId: string;
  mfaChallengeToken?: string;
  approvalId?: string;
  connectedClientId: string | null;
  requestId?: string;
}

function toPermission(role: UserRole | string): Permission | string {
  switch (role) {
    case UserRole.ADMIN:
      return Permission.ADMIN;
    case UserRole.MANAGER:
      return Permission.MANAGER;
    default:
      return Permission.VIEWER;
  }
}

function buildExecutionPayload(
  result: {
    success: boolean;
    tool: string | null;
    outcome?: "APPROVAL_REQUIRED";
    approvalId?: string;
    message?: string;
    data?: unknown;
    error?: { name: string; message: string };
  },
  startedAt: number,
  metrics: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    pendingApprovals: number;
    averageExecutionTime: number;
  },
  stages: ExecutionStage[],
  connectedClientId?: string | null,
) {
  const executionTimeMs = Date.now() - startedAt;
  const rowsAffected =
    typeof result.data === "number"
      ? result.data
      : typeof result.data === "object" && result.data !== null && "count" in result.data
        ? Number((result.data as { count?: number }).count ?? 0)
        : undefined;

  return {
    type: "execution" as const,
    status: getExecutionStatus(result),
    toolName: result.tool,
    connectedClientId: connectedClientId ?? null,
    approvalId: result.outcome === "APPROVAL_REQUIRED" && typeof result.approvalId === "string"
      ? result.approvalId
      : undefined,
    rowsAffected,
    executionTimeMs,
    errors: result.success ? [] : [result.error?.message ?? result.message ?? "Execution failed"],
    data: result.success ? result.data : undefined,
    message: result.message,
    stages,
    metrics: {
      totalExecutions: metrics.totalExecutions,
      successfulExecutions: metrics.successfulExecutions,
      failedExecutions: metrics.failedExecutions,
      pendingApprovals: metrics.pendingApprovals,
      averageExecutionTime: metrics.averageExecutionTime,
    },
  };
}

export async function processChat(data: ChatRequest) {
  const { conversationId, message, userId, companyId, mfaChallengeToken, approvalId } = data;

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
      companyId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.USER,
      content: message,
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  const requestedConnectedClientId = data.connectedClientId;
  const selectedConnectedClientId = await validateConnectedClientSelection(requestedConnectedClientId, companyId, prisma);

  if (selectedConnectedClientId !== (conversation.connectedClientId ?? undefined)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { connectedClientId: selectedConnectedClientId ?? null },
    });
  }

  const enabledToolNames = await getConnectedClientToolNames(selectedConnectedClientId, companyId, prisma);
  const server = createCommandServer(
    userId,
    companyId,
    toPermission(user.role),
    mfaChallengeToken,
    selectedConnectedClientId,
    enabledToolNames,
    data.requestId,
    approvalId,
    conversationId,
    message,
  );
  const startedAt = Date.now();
  const trace = new ExecutionTrace(data.requestId);
  let responsePayload: unknown = {
    type: "execution",
    status: "UNKNOWN",
    toolName: null,
    message: "Unknown command",
    stages: trace.snapshot(),
  };
  let commandFailed = false;
  let commandFailureMessage: string | undefined;

  let parsedCommand: ParsedCommand;
  try {
    parsedCommand = await parseCommand(message, server, {
      onStageStart: (stage) => trace.start(stage),
      onStageComplete: (stage) => trace.complete(stage),
      onStageFailed: (stage, error) => trace.fail(stage, error),
      onStageFallback: (stage, note) => trace.note(stage, note),
    });
  } catch (error) {
    trace.skipPending("Skipped because intent analysis or plan preparation failed.");
    if (error && typeof error === "object") {
      Object.assign(error, { executionTrace: trace.snapshot() });
    }
    throw error;
  }

  if (parsedCommand?.tool) {
    const toolName = parsedCommand.tool;
    trace.setToolName(toolName);
    let executionResult;
    const traceHooks: ToolExecutionTraceHooks = {
      onStageStart: (stage) => trace.start(stage),
      onStageComplete: (stage) => trace.complete(stage),
      onStageFailed: (stage, error) => trace.fail(stage, error),
    };
    const externalRequestTrace: ExternalRequestTraceHooks = {
      onRequestStart: () => trace.externalRequestStart(),
      onRequestComplete: (httpStatus) => trace.externalRequestComplete(httpStatus),
      onRequestFailed: (error, httpStatus, errorCategory) => trace.externalRequestFailed(error, httpStatus, errorCategory),
    };

    try {
      executionResult = await runWithExternalRequestTrace(externalRequestTrace, async () => {
        if (toolRequiresConnectedClient(toolName) && !selectedConnectedClientId) {
          return server.executeTool(toolName, parsedCommand.arguments ?? {}, traceHooks);
        }
        const resolvedArguments = toolRequiresConnectedClient(toolName)
          ? await server.withConnectedClient(() => resolveProductReference(
              toolName,
              parsedCommand.arguments ?? {},
              message
            ))
          : parsedCommand.arguments ?? {};
        return server.executeTool(toolName, resolvedArguments, traceHooks);
      });
    } catch (error) {
      console.error("[api.chat] tool dispatch failed", {
        requestId: data.requestId,
        toolName,
        connectedClientId: selectedConnectedClientId ?? null,
      });
      logServerError("api.chat.tool-dispatch", error, [message], data.requestId);
      const errorMessage = error instanceof InventoryApiError
        ? error.message
        : "Command could not be completed. Please try again.";
      executionResult = {
        success: false,
        tool: toolName,
        message: errorMessage,
        error: {
          name: error instanceof Error ? error.name : "ExecutionError",
          message: errorMessage,
        },
      };
    }
    commandFailed = !executionResult.success && executionResult.outcome !== "APPROVAL_REQUIRED";
    if (commandFailed) {
      commandFailureMessage = executionResult.message ?? "Command could not be completed. Please try again.";
    }

    if (executionResult.success) {
      trace.skip("client-api-request", "Skipped because this tool did not make a connected API request.");
      trace.start("result-processing");
      trace.complete("result-processing");
    } else {
      trace.skipPending(executionResult.outcome === "APPROVAL_REQUIRED"
        ? "Skipped because the execution is awaiting administrator approval."
        : "Skipped because an earlier execution stage failed.");
    }
    responsePayload = buildExecutionPayload(executionResult, startedAt, server.metrics(), trace.snapshot(), selectedConnectedClientId ?? null);
  } else if (parsedCommand && parsedCommand.action === "unknown") {
    trace.skipPending("Skipped because no supported tool matched the request.");
    responsePayload = {
      type: "execution" as const,
      status: "UNKNOWN" as const,
      toolName: null,
      executionTimeMs: Date.now() - startedAt,
      message: parsedCommand.unsupportedMessage ?? "Unknown command",
      stages: trace.snapshot(),
      metrics: server.metrics(),
    };
  }

  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.ASSISTANT,
      content: JSON.stringify(responsePayload),
    },
  });

  return {
    success: !commandFailed,
    ...(commandFailureMessage ? { message: commandFailureMessage } : {}),
    conversationId,
    connectedClientId: selectedConnectedClientId ?? null,
    response: JSON.stringify(responsePayload),
  };
}

class ExecutionTrace {
  private readonly stages: ExecutionStage[];
  private readonly startedAt = new Map<ExecutionStageId, number>();
  private readonly externalRequestStartedAt: number[] = [];
  private externalRequestDuration = 0;

  constructor(requestId?: string) {
    this.stages = EXECUTION_STAGE_DEFINITIONS.map((stage) => ({
      ...stage,
      status: "pending",
      ...(requestId ? { requestId } : {}),
    }));
  }

  setToolName(toolName: string) { for (const stage of this.stages) stage.toolName = toolName; }
  start(id: ExecutionStageId) { const stage = this.stages.find((item) => item.id === id); if (!stage || stage.status !== "pending") return; stage.status = "running"; stage.startedAt = new Date().toISOString(); this.startedAt.set(id, Date.now()); }
  complete(id: ExecutionStageId) { const stage = this.stages.find((item) => item.id === id); if (!stage || stage.status !== "running") return; stage.status = "completed"; stage.endedAt = new Date().toISOString(); stage.durationMs = this.duration(id); }
  fail(id: ExecutionStageId, error: string) { const stage = this.stages.find((item) => item.id === id); if (!stage || stage.status !== "running") return; stage.status = "failed"; stage.endedAt = new Date().toISOString(); stage.durationMs = this.duration(id); stage.error = error; }
  note(id: ExecutionStageId, note: string) { const stage = this.stages.find((item) => item.id === id); if (stage) stage.note = note; }
  skip(id: ExecutionStageId, reason: string) { const stage = this.stages.find((item) => item.id === id); if (stage?.status === "pending") { stage.status = "skipped"; stage.note = reason; } }
  skipPending(reason: string) { for (const stage of this.stages) if (stage.status === "pending") { stage.status = "skipped"; stage.note = reason; } }
  externalRequestStart() { const stage = this.stages.find((item) => item.id === "client-api-request"); if (!stage || stage.status === "failed") return; if (this.externalRequestStartedAt.length === 0) { stage.status = "running"; stage.startedAt = new Date().toISOString(); } this.externalRequestStartedAt.push(Date.now()); }
  externalRequestComplete(httpStatus?: number) { const startedAt = this.externalRequestStartedAt.pop(); if (startedAt !== undefined) this.externalRequestDuration += Date.now() - startedAt; const stage = this.stages.find((item) => item.id === "client-api-request"); if (stage && this.externalRequestStartedAt.length === 0) { stage.status = "completed"; stage.endedAt = new Date().toISOString(); stage.durationMs = this.externalRequestDuration; if (httpStatus !== undefined) stage.httpStatus = httpStatus; } }
  externalRequestFailed(_error: string, httpStatus?: number, errorCategory?: string) { const startedAt = this.externalRequestStartedAt.pop(); if (startedAt !== undefined) this.externalRequestDuration += Date.now() - startedAt; const stage = this.stages.find((item) => item.id === "client-api-request"); if (stage) { stage.status = "failed"; stage.endedAt = new Date().toISOString(); stage.durationMs = this.externalRequestDuration; stage.error = "Connected client request failed."; if (httpStatus !== undefined) stage.httpStatus = httpStatus; if (errorCategory) stage.errorCategory = errorCategory; } }
  snapshot() { return this.stages.map((stage) => ({ ...stage })); }
  private duration(id: ExecutionStageId) { const startedAt = this.startedAt.get(id); return startedAt === undefined ? undefined : Date.now() - startedAt; }
}
