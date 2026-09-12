import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

const inputSchema = z.object({ theme: z.enum(["light", "dark", "system"]) }).strict();

export function createUpdateThemeTool(): MCPTool {
  return {
    name: "frontend.updateTheme",
    description: "Update the frontend theme using a predefined theme value.",
    category: ToolCategory.UI,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    riskLevel: RiskLevel.LOW,
    inputSchema,
    execute(input) {
      return { type: "frontend-control", action: "updateTheme", ...inputSchema.parse(input) };
    },
  };
}
