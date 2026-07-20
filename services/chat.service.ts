import { prisma } from "@/lib/prisma";
import { MessageRole, UserRole } from "@prisma/client";
import { parseCommand } from "./command-parser.service";
import { createCommandServer } from "./tool.service";
import { Permission } from "@/mcp/types";

interface ChatRequest {
  conversationId: string;
  message: string;
  userId: string;
  companyId: string;
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
  const { conversationId, message, userId, companyId } = data;

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

  const server = createCommandServer(userId, companyId, toPermission(user.role));
  const parsedCommand = await parseCommand(message, server);

  const startedAt = Date.now();
  let responsePayload: unknown = {
    type: "execution",
    status: "UNKNOWN",
    toolName: null,
    message: "Unknown command",
  };

  if (parsedCommand.tool) {
    const executionResult = await server.executeTool(parsedCommand.tool, parsedCommand.arguments ?? {});
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
    response: JSON.stringify(responsePayload),
  };
}