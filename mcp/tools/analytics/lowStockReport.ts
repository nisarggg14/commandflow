import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getLowStockReport } from "@/services/inventory-api.service";

export function createLowStockReportTool(): MCPTool {
  return {
    name: "analytics.lowStockReport",
    description: "List products that are running low on stock across the Inventory catalog. Uses the current Inventory REST product data and aggregates variant stock counts without direct database access.",
    category: ToolCategory.ANALYTICS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      threshold: z.number().int().min(0).max(100000).optional(),
      category: z.string().min(1).optional(),
    }),
    async execute(input) {
      const { threshold = 10, category } = input as { threshold?: number; category?: string };
      return getLowStockReport(threshold, category);
    },
  };
}
