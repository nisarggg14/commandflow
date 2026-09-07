import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProduct, updateStock } from "@/services/inventory-api.service";
import { resolveSingleVariant } from "@/services/product-resolver.service";

export function createUpdateStockTool(): MCPTool {
  return {
    name: "products.updateStock",
    description: "Set or adjust a product stock level through the Inventory REST API.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.MEDIUM,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
      productQuery: z.string().min(1).optional(),
      stock: z.number().int().min(0).optional(),
      delta: z.number().int().optional(),
      sku: z.string().min(1).optional(),
      variantId: z.string().min(1).optional(),
    }),
    async execute(input) {
      const { productId, productQuery: _productQuery, ...payload } = input as {
        productId: string;
        productQuery?: string;
        stock?: number;
        delta?: number;
        sku?: string;
        variantId?: string;
      };

      const product = await getProduct(productId);
      const variant = resolveSingleVariant(product, payload);
      const updatePayload = {
        ...payload,
        sku: payload.sku ?? variant.sku,
      };
      const updated = await updateStock(productId, updatePayload);
      const verifiedProduct = await getProduct(productId);
      const verifiedVariant = resolveSingleVariant(verifiedProduct, {
        sku: variant.sku,
        variantId: payload.variantId,
      });

      if (typeof updatePayload.stock === "number" && Number(verifiedVariant.stock) !== updatePayload.stock) {
        throw new Error("Stock update could not be verified after the Inventory API mutation.");
      }

      return updated;
    },
  };
}
