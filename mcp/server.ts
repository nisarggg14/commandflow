import { z } from "zod";
import { ApprovalStatus } from "@prisma/client";
import { validateAndConsumeMfaChallenge } from "@/lib/mfa";
import {
  createApprovalRequest,
  validateApprovalForExecution,
  markApprovalExecuted,
} from "@/services/approval.service";
import type { MCPContext, MCPTool, ToolExecutionResult, ToolRegistry, ToolMetadata } from "./types";
import {
  Permission,
  PermissionDeniedError,
  ToolNotFoundError,
  ValidationError,
  type AuditLogEntry,
} from "./types";
import { InMemoryToolRegistry } from "./registry";
import { redactAuditText } from "@/lib/audit-redaction";

interface RuntimeMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  lastExecution: string | null;
}

export class CommandFlowMCPServer {
  private readonly metricsState: RuntimeMetrics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
    lastExecution: null,
  };

  constructor(
    private readonly context: MCPContext,
    private readonly registry: ToolRegistry = new InMemoryToolRegistry()
  ) {}

  registerTool(tool: MCPTool): MCPTool {
    this.registry.register(tool);
    return tool;
  }

  registerTools(tools: MCPTool[]): MCPTool[] {
    tools.forEach((tool) => this.registerTool(tool));
    return tools;
  }

  async executeTool(name: string, input: unknown): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    let riskLevel = "LOW";
    let mfaRequired = false;
    let mfaResult: "SUCCESS" | "FAILED" | "NOT_REQUIRED" = "NOT_REQUIRED";

    try {
      const tool = this.registry.get(name);

      if (!tool) {
        throw new ToolNotFoundError(`No tool registered with the name ${name}.`);
      }

      riskLevel = tool.riskLevel ?? "LOW";
      mfaRequired = tool.requiresMfaStepUp === true || riskLevel === "HIGH";

      const parsedInput = this.validate(tool, input);
      this.authorize(tool);
      this.evaluateRisk(tool);

      let approvalId: string | null = null;
      let approvalPurpose = tool.mfaPurpose ?? tool.name;

      if (riskLevel === "HIGH") {
        const existingApproval = await this.context.prisma.approval.findFirst({
          where: {
            companyId: this.context.companyId,
            requesterId: this.context.userId,
            toolName: tool.name,
            purpose: approvalPurpose,
            riskLevel,
            status: { in: [ApprovalStatus.APPROVED, ApprovalStatus.PENDING] },
          },
          orderBy: { createdAt: "desc" },
        });

        if (!existingApproval || existingApproval.status !== ApprovalStatus.APPROVED) {
          const createdApproval = await createApprovalRequest({
            prisma: this.context.prisma,
            requesterId: this.context.userId,
            companyId: this.context.companyId,
            toolName: tool.name,
            argumentsObject: parsedInput,
            purpose: approvalPurpose,
            riskLevel,
          });

          approvalId = createdApproval.id;
          throw new PermissionDeniedError(`High-risk tool ${tool.name} requires a separate administrator approval before execution. Approval ${createdApproval.id} is pending.`);
        }

        approvalId = existingApproval.id;
        await validateApprovalForExecution({
          approval: {
            id: existingApproval.id,
            companyId: existingApproval.companyId,
            requesterId: existingApproval.requesterId,
            approverId: existingApproval.approverId,
            toolName: existingApproval.toolName,
            riskLevel: existingApproval.riskLevel,
            purpose: existingApproval.purpose,
            argumentsHash: existingApproval.argumentsHash,
            status: existingApproval.status,
            expiresAt: existingApproval.expiresAt,
            executedAt: existingApproval.executedAt,
            approvedAt: existingApproval.approvedAt,
            rejectedAt: existingApproval.rejectedAt,
          },
          toolName: tool.name,
          requesterId: this.context.userId,
          companyId: this.context.companyId,
          purpose: approvalPurpose,
          riskLevel,
          argumentsObject: parsedInput,
        });
      }

      if (mfaRequired) {
        const challengeToken = this.context.mfaChallengeToken;
        if (!challengeToken) {
          throw new PermissionDeniedError(`High-risk tool ${tool.name} requires a valid step-up MFA challenge.`);
        }

        const purpose = approvalId ? `approval:${approvalId}:execute` : (tool.mfaPurpose ?? tool.name);
        await validateAndConsumeMfaChallenge(this.context.prisma, {
          userId: this.context.userId,
          challengeToken,
          purpose,
          riskLevel,
        });
        this.context.mfaVerified = true;
        mfaResult = "SUCCESS";
      }

      const data = await tool.execute(parsedInput, this.context);
      const duration = Date.now() - startedAt;

      if (approvalId) {
        await markApprovalExecuted(this.context.prisma, approvalId, this.context.companyId);
      }

      await this.log({
        tool: tool.name,
        user: this.context.userId,
        company: this.context.companyId,
        timestamp: new Date().toISOString(),
        duration,
        status: "SUCCESS",
        riskLevel,
        mfaRequired,
        mfaResult,
        details: "Executed successfully",
      });

      this.recordMetric(duration, true);

      return {
        success: true,
        tool: tool.name,
        data,
        message: "Tool executed successfully.",
      };
    } catch (error) {
      const duration = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown error";

      if (mfaRequired) {
        mfaResult = "FAILED";
      }

      await this.log({
        tool: name,
        user: this.context.userId,
        company: this.context.companyId,
        timestamp: new Date().toISOString(),
        duration,
        status: "FAILED",
        riskLevel,
        mfaRequired,
        mfaResult,
        details: redactAuditText(message),
        errorMessage: redactAuditText(message),
      });

      this.recordMetric(duration, false);

      return {
        success: false,
        tool: name,
        message,
        error: {
          name: error instanceof Error ? error.name : "ExecutionError",
          message,
        },
      };
    }
  }

  listTools(): ToolMetadata[] {
    return this.registry.list().filter((tool) => this.canAccess(tool)).map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      permissions: tool.permissions,
      inputSchema: this.describeSchema(tool.inputSchema),
    }));
  }

  health(): {
    ok: boolean;
    registeredToolCount: number;
    context: Pick<MCPContext, "userId" | "companyId" | "role">;
  } {
    return {
      ok: true,
      registeredToolCount: this.registry.list().length,
      context: {
        userId: this.context.userId,
        companyId: this.context.companyId,
        role: this.context.role,
      },
    };
  }

  metrics(): RuntimeMetrics {
    return { ...this.metricsState };
  }

  validate(tool: MCPTool, input: unknown): unknown {
    const parsed = tool.inputSchema.safeParse(input);

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
        .join(", ");

      throw new ValidationError(`Validation failed: ${issues}`);
    }

    return parsed.data;
  }

  authorize(tool: MCPTool): void {
    if (!this.canAccess(tool)) {
      const currentRole = this.context.role as string;
      throw new PermissionDeniedError(`Role ${currentRole} does not have permission to run ${tool.name}.`);
    }
  }

  private canAccess(tool: MCPTool): boolean {
    if (tool.permissions.length === 0) {
      return true;
    }

    const currentRank = this.roleRank(this.context.role as string);
    return tool.permissions.some((permission) => this.roleRank(permission) <= currentRank);
  }

  evaluateRisk(tool: MCPTool): void {
    // Note: HIGH-risk MFA token presence is NOT checked here intentionally.
    // Checking mfaChallengeToken at this point would short-circuit the approval
    // creation logic below (lines ~75-101), which must run first so the user is
    // informed that an approval request has been created and is awaiting admin review.
    // The MFA token is enforced after approval validation (line ~131 in executeTool).
    const riskLevel = tool.riskLevel ?? "LOW";

    if (riskLevel === "HIGH" && this.context.role === "VIEWER") {
      throw new PermissionDeniedError(`Viewers cannot execute high-risk operations.`);
    }
  }


  async log(entry: AuditLogEntry): Promise<void> {
    try {
      if (this.context.prisma?.activityLog) {
        await this.context.prisma.activityLog.create({
          data: {
            action: entry.tool,
            status: entry.status === "SUCCESS" ? "SUCCESS" : "FAILED",
            details: JSON.stringify({
              tool: entry.tool,
              user: entry.user,
              company: entry.company,
              duration: entry.duration,
              errorMessage: entry.errorMessage ? redactAuditText(entry.errorMessage) : undefined,
            }),
            userId: this.context.userId,
            companyId: this.context.companyId,
          },
        });
      }
    } catch {
      // Fallback to the provided logger when persistence is unavailable.
    }

    await this.context.logger(entry);
  }

  private describeSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => {
        const description = this.describeSchema(value as z.ZodTypeAny);
        return [key, description];
      }));

      return {
        type: "object",
        properties,
        required: Object.entries(properties)
          .filter(([, value]) => !(value as { optional?: boolean }).optional)
          .map(([key]) => key),
      };
    }

    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return {
        ...this.describeSchema((schema as z.ZodOptional<z.ZodTypeAny> | z.ZodNullable<z.ZodTypeAny>).unwrap()),
        optional: true,
      };
    }

    if (schema instanceof z.ZodDefault) {
      return {
        ...this.describeSchema((schema as z.ZodDefault<z.ZodTypeAny>).removeDefault()),
        optional: true,
      };
    }

    if (schema instanceof z.ZodArray) {
      return {
        type: "array",
        items: this.describeSchema(schema.element as z.ZodTypeAny),
      };
    }

    if (schema instanceof z.ZodString) {
      return { type: "string" };
    }

    if (schema instanceof z.ZodNumber) {
      return { type: "number" };
    }

    if (schema instanceof z.ZodBoolean) {
      return { type: "boolean" };
    }

    if (schema instanceof z.ZodEnum) {
      return { type: "enum", values: schema.options };
    }

    if (schema instanceof z.ZodLiteral) {
      return { type: "literal", value: schema.value };
    }

    return { type: "unknown" };
  }

  private recordMetric(duration: number, success: boolean): void {
    this.metricsState.totalExecutions += 1;

    if (success) {
      this.metricsState.successfulExecutions += 1;
    } else {
      this.metricsState.failedExecutions += 1;
    }

    const total = this.metricsState.totalExecutions;
    const previousTotal = total - 1;
    const previousAverage = this.metricsState.averageExecutionTime * previousTotal;
    this.metricsState.averageExecutionTime = (previousAverage + duration) / total;
    this.metricsState.lastExecution = new Date().toISOString();
  }

  private roleRank(role: string): number {
    switch (role) {
      case Permission.ADMIN:
        return 4;
      case Permission.MANAGER:
        return 3;
      case Permission.VIEWER:
      default:
        return 1;
    }
  }
}
