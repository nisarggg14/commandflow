import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { BACKGROUND_VALUES } from "../ui/background-values";

const inputSchema = z.object({ background: z.enum(BACKGROUND_VALUES) }).strict();

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
