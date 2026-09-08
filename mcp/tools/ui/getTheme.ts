import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

export function createGetThemeTool(): MCPTool {
  return {
    name: "ui.getTheme",
    description: "Read the current CommandFlow theme.",
    category: ToolCategory.UI,
    riskLevel: RiskLevel.LOW,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({}),
    execute() {
      return { type: "ui-control", action: "getTheme" };
    },
  };
}
