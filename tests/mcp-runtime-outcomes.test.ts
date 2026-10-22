import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import { CommandFlowMCPServer } from "../mcp/server";
import { Permission, RiskLevel, ToolCategory, type MCPContext, type MCPTool } from "../mcp/types";
import { computeApprovalHash } from "../services/approval.service";

function createServer(
  role: Permission,
  options: {
    highRisk?: boolean;
    approved?: boolean;
    rejected?: boolean;
    mfaChallengeToken?: string;
    validMfaChallenge?: boolean;
    executionFailure?: boolean;
  } = {},
) {
  const auditEntries: Array<{ status: string; details?: string }> = [];
  const activityRows: Array<{ action: string; status: string; details: string }> = [];
  const toolName = options.highRisk ? "test.highRisk" : "test.lowRisk";
  const approvalRecord = options.approved || options.rejected ? {
    id: "approval-1",
    companyId: "company-1",
    requesterId: "user-1",
    approverId: "approver-1",
    toolName,
    riskLevel: "HIGH",
    purpose: toolName,
    argumentsHash: computeApprovalHash({
      toolName,
      requesterId: "user-1",
      companyId: "company-1",
      purpose: toolName,
      riskLevel: "HIGH",
      argumentsObject: { value: "safe" },
    }),
    status: options.rejected ? "REJECTED" : "APPROVED",
    expiresAt: new Date(Date.now() + 60_000),
    executedAt: null,
    approvedAt: new Date(),
    rejectedAt: null,
    safeArgumentsSummary: "test operation",
  } : null;
  const challengeRecord = options.validMfaChallenge ? {
    id: "challenge-1",
    userId: "user-1",
    purpose: "approval:approval-1:execute",
    riskLevel: "HIGH",
    challengeToken: options.mfaChallengeToken,
    expiresAt: new Date(Date.now() + 60_000),
    verifiedAt: null as Date | null,
  } : null;
  const prisma = {
    user: {
      findUnique: async () => ({ id: "user-1", companyId: "company-1", role: "ADMIN" }),
    },
    approval: {
      findFirst: async ({ where }: { where: { status?: string | { in?: string[] } } }) => {
        if (!approvalRecord) return null;
        const statusFilter = typeof where.status === "object" ? where.status.in : undefined;
        if (statusFilter && !statusFilter.includes(approvalRecord.status)) return null;
        if (typeof where.status === "string" && where.status !== approvalRecord.status) return null;
        return approvalRecord;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "approval-1",
        ...data,
        expiresAt: new Date(Date.now() + 60_000),
        safeArgumentsSummary: "test operation",
      }),
      updateMany: async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
        if (!approvalRecord || (where.status && where.status !== approvalRecord.status)) return { count: 0 };
        Object.assign(approvalRecord, data);
        return { count: 1 };
      },
      findUnique: async () => approvalRecord,
    },
    mfaChallenge: {
      findUnique: async ({ where }: { where: { challengeToken?: string; id?: string } }) => (
        challengeRecord && (
          where.challengeToken === challengeRecord.challengeToken
          || where.id === challengeRecord.id
        )
          ? challengeRecord
          : null
      ),
      updateMany: async ({ data }: { data: { purpose: string; verifiedAt: Date } }) => {
        if (!challengeRecord || challengeRecord.verifiedAt) return { count: 0 };
        Object.assign(challengeRecord, data);
        return { count: 1 };
      },
    },
    activityLog: {
      create: async ({ data }: { data: { action: string; status: string; details: string } }) => {
        activityRows.push(data);
      },
    },
  } as unknown as PrismaClient;
  const prismaClient = prisma;
  Object.assign(prismaClient, {
    $transaction: async (operation: (transaction: PrismaClient) => Promise<unknown>) => operation(prismaClient),
  });
  const context: MCPContext = {
    userId: "user-1",
    companyId: "company-1",
    role,
    requestId: "request-1",
    timestamp: new Date().toISOString(),
    prisma,
    mfaChallengeToken: options.mfaChallengeToken,
    logger: (entry) => {
      auditEntries.push(entry);
    },
  };
  const server = new CommandFlowMCPServer(context);
  let dispatchCount = 0;
  const inputSchema = z.object({ value: z.string() }).strict();
  const tool: MCPTool = {
    name: toolName,
    description: "Test tool",
    category: ToolCategory.SYSTEM,
    permissions: [Permission.ADMIN],
    ...(options.highRisk ? { riskLevel: RiskLevel.HIGH } : {}),
    inputSchema,
    execute: async (input) => {
      const { value } = inputSchema.parse(input);
      dispatchCount += 1;
      if (options.executionFailure) throw new Error("DATABASE_URL=postgresql://private.example");
      return value;
    },
  };
  server.registerTool(tool);

  return { server, auditEntries, activityRows, getDispatchCount: () => dispatchCount };
}

test("valid low-risk requests reach mocked dispatch", async () => {
  const { server, getDispatchCount } = createServer(Permission.ADMIN);

  const result = await server.executeTool("test.lowRisk", { value: "safe" });

  assert.equal(result.success, true);
  assert.equal(getDispatchCount(), 1);
});

test("invalid schema arguments are rejected before dispatch", async () => {
  const { server, getDispatchCount } = createServer(Permission.ADMIN);

  const result = await server.executeTool("test.lowRisk", { value: 4 });

  assert.equal(result.success, false);
  assert.equal(getDispatchCount(), 0);
});

test("unknown tools are rejected before dispatch", async () => {
  const { server, getDispatchCount } = createServer(Permission.ADMIN);

  const result = await server.executeTool("test.missing", {});

  assert.equal(result.success, false);
  assert.equal(getDispatchCount(), 0);
});

test("role authorization is enforced before dispatch", async () => {
  const { server, getDispatchCount } = createServer(Permission.VIEWER);

  const result = await server.executeTool("test.lowRisk", { value: "safe" });

  assert.equal(result.success, false);
  assert.match(result.message ?? "", /does not have permission/i);
  assert.equal(getDispatchCount(), 0);
});

test("high-risk requests remain pending approval and are not counted as failures", async () => {
  const { server, auditEntries, activityRows, getDispatchCount } = createServer(Permission.ADMIN, { highRisk: true });
  const stages: string[] = [];

  const result = await server.executeTool("test.highRisk", { value: "safe" }, {
    onStageStart: (stage) => stages.push(`start:${stage}`),
    onStageComplete: (stage) => stages.push(`complete:${stage}`),
    onStageFailed: (stage) => stages.push(`failed:${stage}`),
  });

  assert.equal(result.success, false);
  assert.equal(result.outcome, "APPROVAL_REQUIRED");
  assert.equal(getDispatchCount(), 0);
  assert.equal(auditEntries.at(-1)?.status, "PENDING");
  assert.equal(activityRows.at(-1)?.status, "PENDING");
  assert.equal(activityRows.at(-1)?.details.includes("Awaiting administrator approval"), true);
  const metrics = server.metrics();
  assert.equal(metrics.totalExecutions, 1);
  assert.equal(metrics.successfulExecutions, 0);
  assert.equal(metrics.failedExecutions, 0);
  assert.equal(metrics.pendingApprovals, 1);
  assert.ok(stages.includes("complete:tool-selection-validation"));
  assert.ok(!stages.includes("failed:tool-selection-validation"));
});

test("a rejected prior approval never dispatches a high-risk operation", async () => {
  const { server, getDispatchCount } = createServer(Permission.ADMIN, { highRisk: true, rejected: true });
  const result = await server.executeTool("test.highRisk", { value: "safe" });

  assert.equal(result.outcome, "APPROVAL_REQUIRED");
  assert.equal(getDispatchCount(), 0);
});

test("approved high-risk operations without a valid MFA challenge never dispatch", async () => {
  const { server, getDispatchCount } = createServer(Permission.ADMIN, {
    highRisk: true,
    approved: true,
    mfaChallengeToken: "invalid-challenge",
  });

  const result = await server.executeTool("test.highRisk", { value: "safe" });

  assert.equal(result.success, false);
  assert.equal(result.outcome, undefined);
  assert.equal(getDispatchCount(), 0);
});

test("valid mocked approval and MFA authorization allow only the mocked dispatch", async () => {
  const { server, auditEntries, activityRows, getDispatchCount } = createServer(Permission.ADMIN, {
    highRisk: true,
    approved: true,
    mfaChallengeToken: "challenge-1",
    validMfaChallenge: true,
  });

  const result = await server.executeTool("test.highRisk", { value: "safe" });

  assert.equal(result.success, true);
  assert.equal(getDispatchCount(), 1);
  assert.equal(auditEntries.at(-1)?.status, "SUCCESS");
  assert.ok(activityRows.some((row) => row.action === "HIGH_RISK_EXECUTION" && row.status === "SUCCESS"));
});

test("mocked external operation errors remain failed and do not expose infrastructure details", async () => {
  const { server, auditEntries, getDispatchCount } = createServer(Permission.ADMIN, { executionFailure: true });

  const result = await server.executeTool("test.lowRisk", { value: "safe" });

  assert.equal(result.success, false);
  assert.equal(result.message, "Tool execution failed. Please try again.");
  assert.equal(result.message?.includes("private.example"), false);
  assert.equal(auditEntries.at(-1)?.status, "FAILED");
  assert.equal(getDispatchCount(), 1);
});

test("tool execution diagnostics include correlated error stack and redact connection strings", async () => {
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    const { server } = createServer(Permission.ADMIN, { executionFailure: true });
    const result = await server.executeTool("test.lowRisk", { value: "sensitive argument" });

    assert.equal(result.success, false);
    const output = JSON.stringify(logs);
    assert.match(output, /request-1/);
    assert.match(output, /test\.lowRisk/);
    assert.match(output, /errorName/);
    assert.match(output, /errorStack/);
    assert.match(output, /DATABASE_URL=\s*\[redacted\]/);
    assert.equal(output.includes("private.example"), false);
    assert.equal(output.includes("sensitive argument"), false);
  } finally {
    console.error = originalConsoleError;
  }
});
