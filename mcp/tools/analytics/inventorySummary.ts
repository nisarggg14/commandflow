import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getInventorySummary } from "@/services/inventory-api.service";

export function createInventorySummaryTool(): MCPTool {
  return {
    name: "analytics.inventorySummary",
    description: "Summarize the current Inventory catalog by product count, total stock, category mix, and status distribution. This report is derived from the Inventory REST catalog and does not touch the Inventory database directly.",
    category: ToolCategory.ANALYTICS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      category: z.string().min(1).optional(),
    }),
    async execute(input) {
      const { category } = input as { category?: string };
      return getInventorySummary(category);
    },
  };
}
