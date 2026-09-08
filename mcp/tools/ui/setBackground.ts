import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

const inputSchema = z.object({
  background: z.enum(["obsidian", "paper", "mist"]),
});

export function createSetBackgroundTool(): MCPTool {
  return {
    name: "ui.setBackground",
    description: "Set a predefined CommandFlow background.",
    category: ToolCategory.UI,
    riskLevel: RiskLevel.LOW,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema,
    execute(input) {
      const { background } = input as z.infer<typeof inputSchema>;
      return { type: "ui-control", action: "setBackground", background };
    },
  };
}
