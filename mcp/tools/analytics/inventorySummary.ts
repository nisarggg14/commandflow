import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProducts } from "@/services/inventory-api.service";

export function createInventorySummaryTool(): MCPTool {
  return {
    name: "analytics.inventorySummary",
    description: "Summarize the current Inventory catalog by product count, total stock, category mix, and status distribution. This report is derived from the Inventory REST catalog and does not touch the Inventory database directly.",
    category: ToolCategory.ANALYTICS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      category: z.string().min(1).optional(),
    }),
    async execute(input) {
      const { category } = input as { category?: string };
      const products = await getProducts();

      const filtered = category
        ? products.filter((product) => product.category.toLowerCase() === category.toLowerCase())
        : products;

      const totalStock = filtered.reduce((sum, product) => {
        return sum + product.variants.reduce((variantSum, variant) => variantSum + Number(variant.stock ?? 0), 0);
      }, 0);

      const byCategory = filtered.reduce<Record<string, number>>((acc, product) => {
        acc[product.category] = (acc[product.category] ?? 0) + 1;
        return acc;
      }, {});

      const byStatus = filtered.reduce<Record<string, number>>((acc, product) => {
        acc[product.status] = (acc[product.status] ?? 0) + 1;
        return acc;
      }, {});

      return {
        totalProducts: filtered.length,
        totalVariants: filtered.reduce((sum, product) => sum + product.variants.length, 0),
        totalStock,
        byCategory,
        byStatus,
      };
    },
  };
}
