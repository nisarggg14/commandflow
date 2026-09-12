import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

const inputSchema = z.object({ background: z.enum(["obsidian", "paper", "mist"]) }).strict();

export function createUpdateBackgroundTool(): MCPTool {
  return {
    name: "frontend.updateBackground",
    description: "Update the frontend background using a predefined theme value.",
    category: ToolCategory.UI,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    riskLevel: RiskLevel.LOW,
    inputSchema,
    execute(input) {
      return { type: "frontend-control", action: "updateBackground", ...inputSchema.parse(input) };
    },
  };
}
