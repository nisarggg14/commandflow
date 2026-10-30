import type { MCPContext, MCPTool, ToolExecutionResult, ToolRegistry } from "./types";
import { ExecutionError, RiskLevel, ToolNotFoundError } from "./types";

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, MCPTool>();

  register(tool: MCPTool): void {
    if (!tool.name || !Array.isArray(tool.permissions) || tool.permissions.length === 0) {
      throw new ExecutionError("Every MCP tool must declare a name and permissions.");
    }
    if (!tool.riskLevel) tool = { ...tool, riskLevel: RiskLevel.LOW };

    if (this.tools.has(tool.name)) {
      throw new ExecutionError(`Tool ${tool.name} is already registered.`);
    }

    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  list(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, input: unknown, context: MCPContext): Promise<ToolExecutionResult> {
    const tool = this.get(name);

    if (!tool) {
      throw new ToolNotFoundError(`No tool registered with the name ${name}.`);
    }

    const result = await tool.execute(input, context);

    return {
      success: true,
      tool: tool.name,
      data: result,
      message: `Tool ${tool.name} executed successfully.`,
    };
  }
}
