import type { PrismaClient } from "@prisma/client";
import { ApprovalStatus, MessageRole } from "@prisma/client";

import { NotFoundError, ConflictError, ForbiddenError, ValidationFailedError } from "@/lib/errors";
import { getConnectedClientToolNames, validateConnectedClientSelection } from "@/services/mcp-connector.service";
import { createCommandServer } from "@/services/tool.service";
import { Permission } from "@/mcp/types";

interface DurableApproval {
  id: string;
  conversationId: string | null;
  requesterId: string;
  toolName: string;
  riskLevel: string;
  purpose: string;
  argumentsHash: string;
  argumentsJson: string | null;
  originalCommand: string | null;
  connectedClientId: string | null;
  status: ApprovalStatus;
  expiresAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  executedAt: Date | null;
  approverId: string | null;
}

function safeParseArguments(argumentsJson: string | null): Record<string, unknown> {
  if (!argumentsJson) throw new ValidationFailedError("This approval does not contain a recoverable execution context.");
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationFailedError("The approved execution arguments are invalid or unavailable.");
  }
}

export async function continueApprovedApproval({
  prisma,
  approvalId,
  userId,
  companyId,
  mfaChallengeToken,
  requestId,
}: {
  prisma: PrismaClient;
  approvalId: string;
  userId: string;
  companyId: string;
  mfaChallengeToken: string;
  requestId?: string;
}) {
  const approval = await (prisma.approval as any).findFirst({
    where: { id: approvalId, companyId },
    select: {
      id: true,
      conversationId: true,
      requesterId: true,
      toolName: true,
      riskLevel: true,
      purpose: true,
      argumentsHash: true,
      argumentsJson: true,
      originalCommand: true,
      connectedClientId: true,
      status: true,
      expiresAt: true,
      approvedAt: true,
      rejectedAt: true,
      executedAt: true,
      approverId: true,
    },
  }) as DurableApproval | null;

  if (!approval) throw new NotFoundError("Approval not found.");
  if (approval.requesterId !== userId) throw new ForbiddenError("Only the original requester can continue this approval.");
  if (approval.status !== ApprovalStatus.APPROVED) {
    throw new ConflictError(`Approval cannot be continued from status ${approval.status}.`);
  }
  if (approval.expiresAt <= new Date()) throw new ConflictError("Approval has expired and cannot be executed.");
  if (!approval.conversationId) throw new ValidationFailedError("This approval is not linked to a conversation.");

  const requester = await prisma.user.findFirst({
    where: { id: userId, companyId, active: true },
    select: { role: true },
  });
  if (!requester) throw new ForbiddenError("The requester is not authorized in this company.");

  const connectedClientId = approval.connectedClientId ?? undefined;
  const selectedClientId = await validateConnectedClientSelection(connectedClientId, companyId, prisma);
  const enabledToolNames = await getConnectedClientToolNames(selectedClientId, companyId, prisma);
  const argumentsObject = safeParseArguments(approval.argumentsJson);
  const server = createCommandServer(
    userId,
    companyId,
    requester.role as Permission,
    mfaChallengeToken,
    selectedClientId,
    enabledToolNames,
    requestId,
    approval.id,
    approval.conversationId,
    approval.originalCommand ?? undefined,
  );

  const result = await server.executeTool(approval.toolName, argumentsObject);
  const payload = {
    type: "execution" as const,
    status: result.success ? "EXECUTED" : "FAILED",
    toolName: result.tool,
    connectedClientId: selectedClientId ?? null,
    approvalId: approval.id,
    data: result.success ? result.data : undefined,
    errors: result.success ? [] : [result.error?.message ?? result.message ?? "Execution failed"],
    message: result.message,
  };

  await prisma.message.create({
    data: {
      conversationId: approval.conversationId,
      role: MessageRole.ASSISTANT,
      content: JSON.stringify(payload),
    },
  });

  return { approval, result, payload };
}
