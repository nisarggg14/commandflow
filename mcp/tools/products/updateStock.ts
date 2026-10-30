import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProduct, getProducts, updateStock } from "@/services/inventory-api.service";
import { resolveSingleVariant } from "@/services/product-resolver.service";

export function createUpdateStockTool(): MCPTool {
  return {
    name: "products.updateStock",
    description: "Set or adjust a product stock level through the Inventory REST API.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.MEDIUM,
    requiresMfaStepUp: false,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1).optional(),
      productQuery: z.string().min(1).optional(),
      stock: z.number().int().min(0).optional(),
      delta: z.number().int().optional(),
      sku: z.string().min(1).optional(),
      variantId: z.string().min(1).optional(),
    }).superRefine((value, ctx) => {
      const hasProductId = typeof value.productId === "string" && value.productId.trim().length > 0;
      const hasSku = typeof value.sku === "string" && value.sku.trim().length > 0;
      if (!hasProductId && !hasSku) {
        ctx.addIssue({
          code: "custom",
          path: ["productId"],
          message: "At least one of productId or sku is required.",
        });
      }

      if (typeof value.stock !== "number" && typeof value.delta !== "number") {
        ctx.addIssue({
          code: "custom",
          path: ["stock"],
          message: "A target stock value or delta is required.",
        });
      }
    }),
    async execute(input) {
      const { productId, productQuery: _productQuery, ...payload } = input as {
        productId?: string;
        productQuery?: string;
        stock?: number;
        delta?: number;
        sku?: string;
        variantId?: string;
      };

      let resolvedProductId = productId?.trim() || "";
      let resolvedSku = payload.sku?.trim();
      let targetVariant: { sku: string; stock: number } | undefined;

      if (resolvedSku) {
        const products = await getProducts();
        const matched = products.find((product) =>
          product.variants.some((variant) => variant.sku.toLowerCase() === resolvedSku!.toLowerCase())
        );

        if (!matched) {
          throw new Error(`Variant not found for SKU: ${resolvedSku}.`);
        }

        const skuVariant = matched.variants.find((variant) => variant.sku.toLowerCase() === resolvedSku!.toLowerCase());
        if (!skuVariant) {
          throw new Error(`Variant not found for SKU: ${resolvedSku}.`);
        }

        if (resolvedProductId && matched.productId.toLowerCase() !== resolvedProductId.toLowerCase()) {
          throw new Error(`SKU ${resolvedSku} does not belong to product ${resolvedProductId}.`);
        }

        resolvedProductId = matched.productId;
        resolvedSku = skuVariant.sku;
        targetVariant = skuVariant;
      } else {
        if (!resolvedProductId) {
          throw new Error("Either productId or sku is required.");
        }

        const product = await getProduct(resolvedProductId);
        const variant = resolveSingleVariant(product, payload);
        resolvedSku = variant.sku;
        targetVariant = variant;
      }

      const targetStock = typeof payload.stock === "number"
        ? payload.stock
        : typeof payload.delta === "number" && targetVariant
          ? targetVariant.stock + payload.delta
          : undefined;

      if (typeof targetStock !== "number") {
        throw new Error("A target stock value or delta is required.");
      }

      const updated = await updateStock(resolvedProductId, {
        stock: targetStock,
        sku: resolvedSku,
        variantId: payload.variantId,
      });

      const verifiedProduct = await getProduct(resolvedProductId);
      const verifiedVariant = resolveSingleVariant(verifiedProduct, { sku: resolvedSku, variantId: payload.variantId });

      if (Number(verifiedVariant.stock) !== targetStock) {
        throw new Error("Stock update could not be verified after the Inventory API mutation.");
      }

      return updated;
    },
  };
}
