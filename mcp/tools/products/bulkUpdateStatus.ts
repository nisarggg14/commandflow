import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { bulkUpdateStatus } from "@/services/inventory-api.service";

export function createBulkUpdateStatusTool(): MCPTool {
  return {
    name: "products.bulkUpdateStatus",
    description: "Update the status of multiple products through the Inventory REST API. This is a controlled batch operation and does not use a direct Inventory database connection.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.MEDIUM,
    requiresMfaStepUp: false,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productIds: z.array(z.string().min(1)).min(1).max(50),
      status: z.string().min(1),
    }),
    async execute(input) {
      const { productIds, status } = input as {
        productIds: string[];
        status: string;
      };

      return bulkUpdateStatus(productIds, status);
    },
  };
}
