import { prisma } from "@/lib/prisma";
import { MessageRole, UserRole } from "@prisma/client";
import { parseCommand } from "./command-parser.service";
import { createCommandServer } from "./tool.service";
import { Permission } from "@/mcp/types";
import { resolveProductReference } from "./product-resolver.service";
import { getConnectedClientToolNames, validateConnectedClientSelection } from "./mcp-connector.service";
import { runWithExternalRequestTrace } from "./external-request-trace";
import { GeminiQuotaError } from "./llm.service";
import { EXECUTION_STAGE_DEFINITIONS, type ExecutionStage, type ExecutionStageId, type ExternalRequestTraceHooks } from "@/types/execution-trace";
import type { ToolExecutionTraceHooks } from "@/mcp/types";
import { getExecutionStatus } from "@/lib/execution-status";

interface ChatRequest {
  conversationId: string;
  message: string;
  userId: string;
  companyId: string;
  mfaChallengeToken?: string;
  connectedClientId?: string | null;
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
  stages: ExecutionStage[]
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
  const { conversationId, message, userId, companyId, mfaChallengeToken } = data;

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
  const selectedConnectedClientId = requestedConnectedClientId !== undefined
    ? await validateConnectedClientSelection(requestedConnectedClientId, companyId, prisma)
    : await validateConnectedClientSelection(conversation.connectedClientId, companyId, prisma);

  if (requestedConnectedClientId !== undefined && selectedConnectedClientId !== (conversation.connectedClientId ?? undefined)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { connectedClientId: selectedConnectedClientId ?? null },
    });
  }

  const enabledToolNames = await getConnectedClientToolNames(selectedConnectedClientId, companyId, prisma);
  const server = createCommandServer(userId, companyId, toPermission(user.role), mfaChallengeToken, selectedConnectedClientId, enabledToolNames);
  const startedAt = Date.now();
  const trace = new ExecutionTrace();
  let responsePayload: unknown = {
    type: "execution",
    status: "UNKNOWN",
    toolName: null,
    message: "Unknown command",
    stages: trace.snapshot(),
  };

  let parsedCommand;
  try {
    parsedCommand = await parseCommand(message, server, {
      onStageStart: (stage) => trace.start(stage),
      onStageComplete: (stage) => trace.complete(stage),
      onStageFailed: (stage, error) => trace.fail(stage, error),
    });
  } catch (error) {
    if (error instanceof GeminiQuotaError) throw error;
    const errorMessage = "Command could not be analyzed. Please try again.";
    if (!trace.snapshot().some((stage) => stage.status === "failed")) trace.fail("intent-analysis", errorMessage);
    responsePayload = buildExecutionPayload({
      success: false,
      tool: null,
      message: errorMessage,
      error: { name: error instanceof Error ? error.name : "CommandError", message: errorMessage },
    }, startedAt, server.metrics(), trace.snapshot());
  }

  if (parsedCommand?.tool) {
    let executionResult;
    const traceHooks: ToolExecutionTraceHooks = {
      onStageStart: (stage) => trace.start(stage),
      onStageComplete: (stage) => trace.complete(stage),
      onStageFailed: (stage, error) => trace.fail(stage, error),
    };
    const externalRequestTrace: ExternalRequestTraceHooks = {
      onRequestStart: () => trace.externalRequestStart(),
      onRequestComplete: () => trace.externalRequestComplete(),
      onRequestFailed: (error) => trace.externalRequestFailed(error),
    };

    try {
      const resolvedArguments = await server.withConnectedClient(() => resolveProductReference(
          parsedCommand.tool!,
          parsedCommand.arguments ?? {},
          message
        ));
      executionResult = await runWithExternalRequestTrace(externalRequestTrace, () => {
        return server.executeTool(parsedCommand.tool, resolvedArguments, traceHooks);
      });
    } catch (error) {
      const errorMessage = "Command could not be completed. Please try again.";
      executionResult = {
        success: false,
        tool: parsedCommand.tool,
        message: errorMessage,
        error: {
          name: error instanceof Error ? error.name : "ExecutionError",
          message: errorMessage,
        },
      };
    }

    if (executionResult.success) trace.start("result-processing");
    responsePayload = buildExecutionPayload(executionResult, startedAt, server.metrics(), trace.snapshot());
    if (executionResult.success) {
      trace.complete("result-processing");
      responsePayload = buildExecutionPayload(executionResult, startedAt, server.metrics(), trace.snapshot());
    }
  } else if (parsedCommand && parsedCommand.action === "unknown") {
    responsePayload = {
      type: "execution" as const,
      status: "UNKNOWN" as const,
      toolName: null,
      executionTimeMs: Date.now() - startedAt,
      message: "Unknown command",
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
    success: true,
    conversationId,
    connectedClientId: selectedConnectedClientId ?? null,
    response: JSON.stringify(responsePayload),
  };
}

class ExecutionTrace {
  private readonly stages: ExecutionStage[] = EXECUTION_STAGE_DEFINITIONS.map((stage) => ({ ...stage, status: "pending" }));
  private readonly startedAt = new Map<ExecutionStageId, number>();
  private readonly externalRequestStartedAt: number[] = [];
  private externalRequestDuration = 0;

  start(id: ExecutionStageId) { const stage = this.stages.find((item) => item.id === id); if (!stage || stage.status === "completed" || stage.status === "failed") return; stage.status = "running"; this.startedAt.set(id, Date.now()); }
  complete(id: ExecutionStageId) { const stage = this.stages.find((item) => item.id === id); if (!stage || stage.status === "completed" || stage.status === "failed") return; stage.status = "completed"; stage.durationMs = this.duration(id); }
  fail(id: ExecutionStageId, error: string) { const stage = this.stages.find((item) => item.id === id); if (!stage || stage.status === "completed" || stage.status === "failed") return; stage.status = "failed"; stage.durationMs = this.duration(id); stage.error = error; }
  externalRequestStart() { const stage = this.stages.find((item) => item.id === "client-api-request"); if (!stage || stage.status === "failed") return; stage.status = "running"; this.externalRequestStartedAt.push(Date.now()); }
  externalRequestComplete() { const startedAt = this.externalRequestStartedAt.pop(); if (startedAt !== undefined) this.externalRequestDuration += Date.now() - startedAt; const stage = this.stages.find((item) => item.id === "client-api-request"); if (stage && this.externalRequestStartedAt.length === 0) { stage.status = "completed"; stage.durationMs = this.externalRequestDuration; } }
  externalRequestFailed(_error: string) { const startedAt = this.externalRequestStartedAt.pop(); if (startedAt !== undefined) this.externalRequestDuration += Date.now() - startedAt; const stage = this.stages.find((item) => item.id === "client-api-request"); if (stage) { stage.status = "failed"; stage.durationMs = this.externalRequestDuration; stage.error = "Connected client request failed."; } }
  snapshot() { return this.stages.map((stage) => ({ ...stage })); }
  private duration(id: ExecutionStageId) { const startedAt = this.startedAt.get(id); return startedAt === undefined ? undefined : Date.now() - startedAt; }
}
