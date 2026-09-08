import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

const inputSchema = z.object({
  accent: z.enum(["mint", "sky", "amber"]),
});

export function createSetAccentColorTool(): MCPTool {
  return {
    name: "ui.setAccentColor",
    description: "Set a predefined CommandFlow accent color.",
    category: ToolCategory.UI,
    riskLevel: RiskLevel.LOW,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema,
    execute(input) {
      const { accent } = input as z.infer<typeof inputSchema>;
      return { type: "ui-control", action: "setAccentColor", accent };
    },
  };
}
