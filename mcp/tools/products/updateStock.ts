import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { updateStock } from "@/services/inventory-api.service";

export function createUpdateStockTool(): MCPTool {
  return {
    name: "products.updateStock",
    description: "Set or adjust a product stock level through the Inventory REST API.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.MEDIUM,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
      stock: z.number().int().min(0).optional(),
      delta: z.number().int().optional(),
      sku: z.string().min(1).optional(),
      variantId: z.string().min(1).optional(),
    }),
    async execute(input) {
      const { productId, ...payload } = input as {
        productId: string;
        stock?: number;
        delta?: number;
        sku?: string;
        variantId?: string;
      };

      return updateStock(productId, payload);
    },
  };
}
