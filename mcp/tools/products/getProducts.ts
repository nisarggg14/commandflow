import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProducts } from "@/services/inventory-api.service";

export function createGetProductsTool(): MCPTool {
  return {
    name: "products.getProducts",
    description: "Retrieve products from the Inventory Backend.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    async execute(input) {
      const { limit = 50, offset = 0 } = input as { limit?: number; offset?: number };
      const products = await getProducts();
      const start = offset;
      const end = start + limit;
      return products.slice(start, end);
    },
  };
}
