import { z } from "zod";
import { InventoryApiError } from "@/services/inventory-api.service";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { BACKGROUND_VALUES } from "./background-values";

const inputSchema = z.object({
  background: z.enum(BACKGROUND_VALUES),
});

export function createSetBackgroundTool(): MCPTool {
  return {
    name: "ui.setBackground",
    description: "Set a background on the selected connected demo frontend when that client exposes the capability.",
    category: ToolCategory.UI,
    riskLevel: RiskLevel.LOW,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema,
    async execute(input) {
      inputSchema.parse(input);
      throw new InventoryApiError(
        "validation",
        "The selected connected client does not expose a supported frontend background capability.",
        undefined,
        undefined,
        "frontend_capability",
      );
    },
  };
}
