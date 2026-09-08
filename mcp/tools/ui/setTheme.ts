import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

const inputSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
});

export function createSetThemeTool(): MCPTool {
  return {
    name: "ui.setTheme",
    description: "Set the CommandFlow theme to light, dark, or system.",
    category: ToolCategory.UI,
    riskLevel: RiskLevel.LOW,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema,
    execute(input) {
      const { theme } = input as z.infer<typeof inputSchema>;
      return { type: "ui-control", action: "setTheme", theme };
    },
  };
}
