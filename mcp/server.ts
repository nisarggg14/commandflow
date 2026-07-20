import type { MCPContext, MCPTool, ToolExecutionResult, ToolRegistry } from "./types";
import {
  Permission,
  PermissionDeniedError,
  ToolNotFoundError,
  ValidationError,
  ExecutionError,
  type AuditLogEntry,
} from "./types";
import { InMemoryToolRegistry } from "./registry";

export class CommandFlowMCPServer {
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

      await this.log({
        tool: tool.name,
        user: this.context.userId,
        company: this.context.companyId,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startedAt,
        status: "SUCCESS",
        details: "Executed successfully",
      });

      return {
        success: true,
        tool: tool.name,
        data,
        message: "Tool executed successfully.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      await this.log({
        tool: name,
        user: this.context.userId,
        company: this.context.companyId,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startedAt,
        status: "FAILED",
        details: message,
      });

      return {
        success: false,
        tool: name,
        message,
      };
    }
  }

  listTools(): Array<{ name: string; description: string; category: string; permissions: Permission[] }> {
    return this.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      permissions: tool.permissions,
    }));
  }

  health(): { ok: boolean; registeredToolCount: number; context: Pick<MCPContext, "userId" | "companyId" | "role"> } {
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
    await this.context.logger(entry);
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
