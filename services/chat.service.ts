import { prisma } from "@/lib/prisma";
import { MessageRole, UserRole } from "@prisma/client";
import { parseCommand } from "./command-parser.service";
import { createCommandServer } from "./tool.service";
import { Permission } from "@/mcp/types";
import { resolveProductReference } from "./product-resolver.service";
import { getConnectedClientToolNames, validateConnectedClientSelection } from "./mcp-connector.service";

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
    tool: string;
    message?: string;
    data?: unknown;
    error?: { name: string; message: string };
  },
  startedAt: number,
  metrics: {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
  }
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
    status: result.success ? "SUCCESS" : "FAILED",
    toolName: result.tool,
    rowsAffected,
    executionTimeMs,
    errors: result.success ? [] : [result.error?.message ?? result.message ?? "Execution failed"],
    data: result.success ? result.data : undefined,
    message: result.message,
    metrics: {
      totalExecutions: metrics.totalExecutions,
      successfulExecutions: metrics.successfulExecutions,
      failedExecutions: metrics.failedExecutions,
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
  const parsedCommand = await parseCommand(message, server);

  const startedAt = Date.now();
  let responsePayload: unknown = {
    type: "execution",
    status: "UNKNOWN",
    toolName: null,
    message: "Unknown command",
  };

  if (parsedCommand.tool) {
    let executionResult;

    try {
      const resolvedArguments = await server.withConnectedClient(() => resolveProductReference(
          parsedCommand.tool!,
          parsedCommand.arguments ?? {},
          message
        ));
      executionResult = await server.executeTool(parsedCommand.tool, resolvedArguments);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Command could not be completed.";
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

    responsePayload = buildExecutionPayload(executionResult, startedAt, server.metrics());
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
