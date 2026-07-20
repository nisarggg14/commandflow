import { z } from "zod";
import type { MCPContext, MCPTool, ToolExecutionResult, ToolRegistry, ToolMetadata } from "./types";
import {
  Permission,
  PermissionDeniedError,
  ToolNotFoundError,
  ValidationError,
  type AuditLogEntry,
} from "./types";
import { InMemoryToolRegistry } from "./registry";

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

    try {
      const tool = this.registry.get(name);

      if (!tool) {
        throw new ToolNotFoundError(`No tool registered with the name ${name}.`);
      }

      const parsedInput = this.validate(tool, input);
      this.authorize(tool);

      const data = await tool.execute(parsedInput, this.context);
      const duration = Date.now() - startedAt;

      await this.log({
        tool: tool.name,
        user: this.context.userId,
        company: this.context.companyId,
        timestamp: new Date().toISOString(),
        duration,
        status: "SUCCESS",
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

      await this.log({
        tool: name,
        user: this.context.userId,
        company: this.context.companyId,
        timestamp: new Date().toISOString(),
        duration,
        status: "FAILED",
        details: message,
        errorMessage: message,
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
    return this.registry.list().map((tool) => ({
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
    const requiredPermissions = tool.permissions;

    if (requiredPermissions.length === 0) {
      return;
    }

    const currentRole = this.context.role as string;
    const currentRank = this.roleRank(currentRole);

    const hasAccess = requiredPermissions.every((permission) => this.roleRank(permission) <= currentRank);

    if (!hasAccess) {
      throw new PermissionDeniedError(`Role ${currentRole} does not have permission to run ${tool.name}.`);
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
              errorMessage: entry.errorMessage,
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
      const properties = Object.fromEntries(
        Object.entries(shape).map(([key, value]) => [key, this.describeSchema(value as z.ZodTypeAny)])
      );

      return {
        type: "object",
        properties,
        required: Object.keys(shape),
      };
    }

    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return this.describeSchema((schema as z.ZodOptional<z.ZodTypeAny> | z.ZodNullable<z.ZodTypeAny>).unwrap());
    }

    if (schema instanceof z.ZodDefault) {
      return this.describeSchema((schema as z.ZodDefault<z.ZodTypeAny>).removeDefault());
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
      case Permission.EMPLOYEE:
        return 2;
      case Permission.VIEWER:
      default:
        return 1;
    }
  }
}
