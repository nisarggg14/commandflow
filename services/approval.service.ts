import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { ApprovalStatus } from "@prisma/client";
import { validateAndConsumeMfaChallenge } from "@/lib/mfa";
import { redactAuditValue } from "@/lib/audit-redaction";

export interface CreateApprovalRequestInput {
  prisma: PrismaClient;
  requesterId: string;
  companyId: string;
  toolName: string;
  argumentsObject: unknown;
  purpose?: string;
  riskLevel?: string;
  approverId?: string;
  status?: string;
  expiresInMs?: number;
}

export interface NormalizedApprovalData {
  toolName: string;
  requesterId: string;
  companyId: string;
  purpose: string;
  riskLevel: string;
  argumentsObject: unknown;
}

export interface ApprovalExecutionCheckInput extends NormalizedApprovalData {
  approval: {
    id: string;
    companyId: string;
    requesterId: string;
    approverId: string | null;
    toolName: string;
    riskLevel: string;
    purpose: string;
    argumentsHash: string;
    status: string;
    expiresAt: Date;
    executedAt: Date | null;
    approvedAt: Date | null;
    rejectedAt: Date | null;
  };
  actualHash?: string;
}

const BLOCKED_SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "jwt",
  "authorization",
  "cookie",
  "secret",
  "mfaSecret",
  "totp",
  "otp",
  "code",
  "header",
  "headers",
]);

function normalizePropertyKey(value: string): string {
  return value.trim();
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !BLOCKED_SENSITIVE_KEYS.has(key.toLowerCase()))
      .sort(([left], [right]) => normalizePropertyKey(left).localeCompare(normalizePropertyKey(right)))
      .map(([key, item]) => [key, sortObjectKeys(item)] as const);

    return Object.fromEntries(entries);
  }

  return value;
}

function sanitizeForHash(value: unknown): unknown {
  if (value === undefined) {
    return "__undefined__";
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForHash(item));
  }

  if (typeof value === "object") {
    return sortObjectKeys(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeForHash(item)])
      )
    );
  }

  return String(value);
}

export function computeApprovalHash({
  toolName,
  requesterId,
  companyId,
  purpose,
  riskLevel,
  argumentsObject,
}: NormalizedApprovalData): string {
  const canonical = JSON.stringify({
    toolName: String(toolName || "").trim(),
    requesterId: String(requesterId || "").trim(),
    companyId: String(companyId || "").trim(),
    purpose: String(purpose || "").trim(),
    riskLevel: String(riskLevel || "").trim().toUpperCase(),
    argumentsObject: sanitizeForHash(argumentsObject ?? {}),
  });

  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function summarizeApprovalArguments(toolName: string, argumentsObject: unknown): string {
  const data = (argumentsObject ?? {}) as Record<string, unknown>;

  if (toolName === "products.deleteProduct") {
    const productId = typeof data.productId === "string" ? data.productId : "unknown product";
    return `Delete inventory product ${productId}`;
  }

  if (toolName === "users.changeRole") {
    const userId = typeof data.userId === "string" ? data.userId : "unknown user";
    const role = typeof data.role === "string" ? data.role : "unknown role";
    return `Change user ${userId} role to ${role}`;
  }

  if (toolName === "users.disableUser") {
    const userId = typeof data.userId === "string" ? data.userId : "unknown user";
    return `Disable user ${userId}`;
  }

  const entries = Object.entries(data).slice(0, 3);
  if (entries.length === 0) {
    return "Execute high-risk operation";
  }

  return entries
    .map(([key, value]) => `${key}=${String(redactAuditValue(key, value))}`)
    .join(", ");
}

export async function createApprovalRequest({
  prisma,
  requesterId,
  companyId,
  toolName,
  argumentsObject,
  purpose,
  riskLevel,
  approverId,
  status,
  expiresInMs = 10 * 60 * 1000,
}: CreateApprovalRequestInput) {
  if (!requesterId || !requesterId.trim()) {
    throw new Error("Requester identity is required to create an approval.");
  }

  if (!companyId || !companyId.trim()) {
    throw new Error("Company context is required to create an approval.");
  }

  if (typeof toolName !== "string" || toolName.trim().length === 0) {
    throw new Error("A tool name is required to create an approval.");
  }

  if (typeof approverId === "string" && approverId.trim().length > 0) {
    throw new Error("Approver identity is server-controlled and cannot be supplied by the client.");
  }

  if (typeof status === "string" && status.trim().length > 0) {
    throw new Error("Approval status is server-controlled and cannot be supplied by the client.");
  }

  const requesterRecord = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { id: true, companyId: true, role: true },
  });

  if (!requesterRecord || requesterRecord.companyId !== companyId) {
    throw new Error("Requester identity and company context are server-controlled and cannot be supplied by the client.");
  }

  const normalizedPurpose = String(purpose || toolName).trim();
  const normalizedRiskLevel = String(riskLevel || "HIGH").trim().toUpperCase();
  const argumentsPayload = argumentsObject ?? {};

  const approvalHash = computeApprovalHash({
    toolName,
    requesterId,
    companyId,
    purpose: normalizedPurpose,
    riskLevel: normalizedRiskLevel,
    argumentsObject: argumentsPayload,
  });

  const approval = await prisma.approval.create({
    data: {
      companyId,
      requesterId,
      toolName,
      riskLevel: normalizedRiskLevel,
      purpose: normalizedPurpose,
      argumentsHash: approvalHash,
      safeArgumentsSummary: summarizeApprovalArguments(toolName, argumentsPayload),
      status: ApprovalStatus.PENDING,
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });

  await prisma.activityLog.create({
    data: {
      action: "APPROVAL_CREATED",
      status: "PENDING",
      details: JSON.stringify({
        approvalId: approval.id,
        toolName,
        requesterId,
        companyId,
        riskLevel: normalizedRiskLevel,
        safeOperationSummary: approval.safeArgumentsSummary,
      }),
      userId: requesterId,
      companyId,
    },
  });

  return approval;
}

export async function getApprovalById(prisma: PrismaClient, id: string, companyId?: string) {
  return prisma.approval.findFirst({
    where: {
      id,
      ...(companyId ? { companyId } : {}),
    },
    include: {
      requester: {
        select: { id: true, email: true, role: true },
      },
      approver: {
        select: { id: true, email: true, role: true },
      },
    },
  });
}

export async function listPendingApprovals(prisma: PrismaClient, companyId: string) {
  return prisma.approval.findMany({
    where: {
      companyId,
      status: ApprovalStatus.PENDING,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function approveApproval({
  prisma,
  approvalId,
  approverId,
  companyId,
  mfaChallengeToken,
}: {
  prisma: PrismaClient;
  approvalId: string;
  approverId: string;
  companyId: string;
  mfaChallengeToken?: string;
}) {
  if (!approvalId || !approvalId.trim()) {
    throw new Error("A valid approval id is required.");
  }

  if (!approverId || !approverId.trim()) {
    throw new Error("A valid approver is required.");
  }

  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findFirst({
      where: {
        id: approvalId,
        companyId,
      },
    });

    if (!approval) {
      throw new Error("Approval not found.");
    }

    const approverRecord = await tx.user.findUnique({
      where: { id: approverId },
      select: { id: true, role: true, companyId: true, mfaEnabled: true, mfaSecret: true },
    });

    if (!approverRecord) {
      throw new Error("Approver not found.");
    }

    if (approverRecord.role !== "ADMIN") {
      throw new Error("Only ADMIN users can approve high-risk requests.");
    }

    if (approverRecord.companyId !== approval.companyId || approverRecord.companyId !== companyId) {
      throw new Error("Approval company does not match the approver's company context.");
    }

    if (approval.requesterId === approverId) {
      throw new Error("Requesters cannot approve their own destructive action.");
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      throw new Error(`Approval cannot be approved from status ${approval.status}.`);
    }

    if (approval.expiresAt <= new Date()) {
      await tx.approval.update({
        where: { id: approval.id },
        data: { status: ApprovalStatus.EXPIRED },
      });
      throw new Error("Approval has expired and cannot be approved.");
    }

    if (!approverRecord.mfaEnabled || !approverRecord.mfaSecret) {
      throw new Error("Approver MFA is required to approve a high-risk request.");
    }

    if (!mfaChallengeToken || !mfaChallengeToken.trim()) {
      throw new Error("A valid MFA challenge is required to approve a high-risk request.");
    }

    await validateAndConsumeMfaChallenge(tx as unknown as PrismaClient, {
      userId: approverId,
      challengeToken: mfaChallengeToken,
      purpose: `approval:${approval.id}:approve`,
      riskLevel: "HIGH",
    });

    const updated = await tx.approval.updateMany({
      where: {
        id: approval.id,
        status: ApprovalStatus.PENDING,
      },
      data: {
        status: ApprovalStatus.APPROVED,
        approverId,
        approvedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      throw new Error("Approval was already approved or changed state.");
    }

    const approvedApproval = await tx.approval.findUnique({
      where: { id: approval.id },
    });

    if (!approvedApproval) {
      throw new Error("Approval could not be reloaded after approval.");
    }

    await tx.activityLog.create({
      data: {
        action: "APPROVAL_APPROVED",
        status: "SUCCESS",
        details: JSON.stringify({
          approvalId: approvedApproval.id,
          toolName: approvedApproval.toolName,
          requesterId: approvedApproval.requesterId,
          approverId,
          riskLevel: approvedApproval.riskLevel,
          safeOperationSummary: approvedApproval.safeArgumentsSummary,
        }),
        userId: approverId,
        companyId,
      },
    });

    return approvedApproval;
  });
}

export async function rejectApproval({
  prisma,
  approvalId,
  approverId,
  companyId,
  reason,
}: {
  prisma: PrismaClient;
  approvalId: string;
  approverId: string;
  companyId: string;
  reason?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findFirst({
      where: {
        id: approvalId,
        companyId,
      },
    });

    if (!approval) {
      throw new Error("Approval not found.");
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      throw new Error(`Approval cannot be rejected from status ${approval.status}.`);
    }

    const updated = await tx.approval.updateMany({
      where: {
        id: approval.id,
        status: ApprovalStatus.PENDING,
      },
      data: {
        status: ApprovalStatus.REJECTED,
        approverId,
        rejectedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      throw new Error("Approval was already updated and cannot be rejected.");
    }

    const finalApproval = await tx.approval.findUnique({
      where: { id: approval.id },
    });

    await tx.activityLog.create({
      data: {
        action: "APPROVAL_REJECTED",
        status: "FAILED",
        details: JSON.stringify({
          approvalId: approval.id,
          toolName: approval.toolName,
          requesterId: approval.requesterId,
          approverId,
          reason: reason ?? "Rejected by admin",
          riskLevel: approval.riskLevel,
        }),
        userId: approverId,
        companyId,
      },
    });

    return finalApproval;
  });
}

export async function cancelApproval({
  prisma,
  approvalId,
  requesterId,
  companyId,
}: {
  prisma: PrismaClient;
  approvalId: string;
  requesterId: string;
  companyId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findFirst({
      where: {
        id: approvalId,
        companyId,
        requesterId,
      },
    });

    if (!approval) {
      throw new Error("Approval not found for this requester.");
    }

    if (approval.status !== ApprovalStatus.PENDING) {
      throw new Error(`Approval cannot be cancelled from status ${approval.status}.`);
    }

    const updated = await tx.approval.updateMany({
      where: {
        id: approval.id,
        status: ApprovalStatus.PENDING,
      },
      data: {
        status: ApprovalStatus.CANCELLED,
      },
    });

    if (updated.count !== 1) {
      throw new Error("Approval was already changed and cannot be cancelled.");
    }

    await tx.activityLog.create({
      data: {
        action: "APPROVAL_CANCELLED",
        status: "FAILED",
        details: JSON.stringify({
          approvalId: approval.id,
          toolName: approval.toolName,
          requesterId: approval.requesterId,
          riskLevel: approval.riskLevel,
        }),
        userId: requesterId,
        companyId,
      },
    });

    return tx.approval.findUnique({
      where: { id: approval.id },
    });
  });
}

export async function validateApprovalForExecution({
  approval,
  toolName,
  requesterId,
  companyId,
  purpose,
  riskLevel,
  argumentsObject,
  actualHash,
}: ApprovalExecutionCheckInput) {
  if (approval.status !== ApprovalStatus.APPROVED) {
    throw new Error(`Approval is not in APPROVED status (current: ${approval.status}).`);
  }

  if (approval.expiresAt <= new Date()) {
    throw new Error("Approval expired and cannot be executed.");
  }

  if (approval.requesterId !== requesterId) {
    throw new Error("Approval requester does not match the current execution context.");
  }

  if (approval.companyId !== companyId) {
    throw new Error("Approval company does not match the current execution context.");
  }

  if (approval.toolName !== toolName) {
    throw new Error("Approval tool name does not match the requested tool.");
  }

  if (approval.purpose !== purpose) {
    throw new Error("Approval purpose does not match the requested operation.");
  }

  if (approval.riskLevel !== riskLevel.toUpperCase()) {
    throw new Error("Approval risk level does not match the requested operation.");
  }

  const expectedHash = computeApprovalHash({
    toolName,
    requesterId,
    companyId,
    purpose,
    riskLevel,
    argumentsObject,
  });

  const suppliedHash = actualHash ?? approval.argumentsHash;

  if (suppliedHash !== expectedHash) {
    throw new Error("Approval hash mismatch. The operation has changed since approval was granted.");
  }

  return approval;
}

export async function markApprovalExecuted(prisma: PrismaClient, approvalId: string, companyId: string) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findFirst({
      where: {
        id: approvalId,
        companyId,
      },
    });

    if (!approval) {
      throw new Error("Approval not found.");
    }

    if (approval.status !== ("EXECUTING" as any)) {
      throw new Error(`Approval cannot be marked executed from status ${approval.status}.`);
    }

    if (approval.expiresAt <= new Date()) {
      await tx.approval.update({
        where: { id: approval.id },
        data: { status: ApprovalStatus.EXPIRED },
      });
      throw new Error("Approval expired before execution.");
    }

    const updated = await tx.approval.updateMany({
      where: {
        id: approval.id,
        status: "EXECUTING" as any
      },
      data: {
        status: ApprovalStatus.EXECUTED,
        executedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      throw new Error("Approval was already executed or updated by another request.");
    }

    await tx.activityLog.create({
      data: {
        action: "HIGH_RISK_EXECUTION",
        status: "SUCCESS",
        details: JSON.stringify({
          approvalId: approval.id,
          toolName: approval.toolName,
          requesterId: approval.requesterId,
          riskLevel: approval.riskLevel,
          safeOperationSummary: approval.safeArgumentsSummary,
        }),
        userId: approval.requesterId,
        companyId,
      },
    });

    return tx.approval.findUnique({
      where: { id: approval.id },
    });
  });
}

export async function claimApprovalForExecution(prisma: PrismaClient, approvalId: string, companyId: string) {
  const claimed = await prisma.approval.updateMany({ where: { id: approvalId, companyId, status: ApprovalStatus.APPROVED, expiresAt: { gt: new Date() } }, data: { status: "EXECUTING" as any } });
  if (claimed.count !== 1) throw new Error("Approval was already claimed or is no longer executable.");
}

export async function markApprovalFailed(prisma: PrismaClient, approvalId: string, companyId: string) {
  await prisma.approval.updateMany({ where: { id: approvalId, companyId, status: "EXECUTING" as any }, data: { status: "FAILED" as any } });
}
