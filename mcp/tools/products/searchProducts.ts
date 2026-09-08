import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProducts } from "@/services/inventory-api.service";

export function createSearchProductsTool(): MCPTool {
  return {
    name: "products.searchProducts",
    description: "Search/filter products from the Inventory Backend after fetching the current product list. This tool performs controlled filtering in CommandFlow; it does not call a dedicated Inventory search endpoint because the backend does not provide one.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      brand: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
      status: z.string().min(1).optional(),
      minimumStock: z.number().int().min(0).max(100000).optional(),
      maximumStock: z.number().int().min(0).max(100000).optional(),
    }),
    async execute(input) {
      const { productId, name, brand, category, status, minimumStock, maximumStock } = input as {
        productId?: string;
        name?: string;
        brand?: string;
        category?: string;
        status?: string;
        minimumStock?: number;
        maximumStock?: number;
      };

      const products = await getProducts();

      return products.filter((product) => {
        if (productId && !product.productId.toLowerCase().includes(productId.toLowerCase())) {
          return false;
        }

        if (name && !product.name.toLowerCase().includes(name.toLowerCase())) {
          return false;
        }

        if (brand && !product.brand.toLowerCase().includes(brand.toLowerCase())) {
          return false;
        }

        if (category && !product.category.toLowerCase().includes(category.toLowerCase())) {
          return false;
        }

        if (status && !product.status.toLowerCase().includes(status.toLowerCase())) {
          return false;
        }

        const stockTotal = product.variants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0);

        if (typeof minimumStock === "number" && stockTotal < minimumStock) {
          return false;
        }

        if (typeof maximumStock === "number" && stockTotal > maximumStock) {
          return false;
        }

        return true;
      });
    },
  };
}
