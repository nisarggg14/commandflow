import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProducts } from "@/services/inventory-api.service";

export function createLowStockReportTool(): MCPTool {
  return {
    name: "analytics.lowStockReport",
    description: "List products that are running low on stock across the Inventory catalog. Uses the current Inventory REST product data and aggregates variant stock counts without direct database access.",
    category: ToolCategory.ANALYTICS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      threshold: z.number().int().min(0).max(100000).optional(),
      category: z.string().min(1).optional(),
    }),
    async execute(input) {
      const { threshold = 10, category } = input as { threshold?: number; category?: string };
      const products = await getProducts();

      const rows = products
        .filter((product) => (category ? product.category.toLowerCase() === category.toLowerCase() : true))
        .map((product) => {
          const totalStock = product.variants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0);

          return {
            productId: product.productId,
            name: product.name,
            category: product.category,
            status: product.status,
            totalStock,
            lowStock: totalStock <= threshold,
            variants: product.variants.map((variant) => ({
              sku: variant.sku,
              color: variant.color,
              size: variant.size,
              stock: variant.stock,
            })),
          };
        })
        .filter((item) => item.lowStock)
        .sort((a, b) => a.totalStock - b.totalStock);

      return {
        threshold,
        count: rows.length,
        products: rows,
      };
    },
  };
}
