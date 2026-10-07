import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProduct, reduceProductPrice } from "@/services/inventory-api.service";
import { resolveSingleVariant } from "@/services/product-resolver.service";

const priceInputSchema = z.object({
  productId: z.string().min(1),
  productQuery: z.string().min(1).optional(),
  operation: z.enum(["increase", "reduce", "set"]),
  percentage: z.number().positive().max(100).optional(),
  price: z.number().min(0).optional(),
  sku: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.operation === "set" && typeof value.price !== "number") {
    context.addIssue({ code: "custom", path: ["price"], message: "A target price is required." });
  }

  if (value.operation !== "set" && typeof value.percentage !== "number") {
    context.addIssue({ code: "custom", path: ["percentage"], message: "A percentage is required." });
  }
});

export function createAdjustPriceTool(): MCPTool {
  return {
    name: "products.adjustPrice",
    description: "Increase, reduce, or set one product variant price. The application calculates the final price deterministically; provide productId, operation, percentage for increase/reduce, or price for set.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.HIGH,
    requiresMfaStepUp: true,
    mfaPurpose: "products.adjustPrice",
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: priceInputSchema,
    async execute(input) {
      const { productQuery: _productQuery, ...data } = input as z.infer<typeof priceInputSchema>;
      const product = await getProduct(data.productId);
      const variant = resolveSingleVariant(product, data);
      const currentPrice = Number(variant.price);
      let targetPrice: number;

      if (data.operation === "set") {
        targetPrice = data.price as number;
      } else {
        const multiplier = data.operation === "increase"
          ? 1 + (data.percentage as number) / 100
          : 1 - (data.percentage as number) / 100;
        targetPrice = Math.round(currentPrice * multiplier * 100) / 100;
      }

      const updated = await reduceProductPrice(data.productId, {
        price: targetPrice,
        sku: variant.sku,
        variantId: data.variantId,
      });
      const verifiedProduct = await getProduct(data.productId);
      const verifiedVariant = resolveSingleVariant(verifiedProduct, {
        sku: variant.sku,
        variantId: data.variantId,
      });

      if (Number(verifiedVariant.price) !== targetPrice) {
        throw new Error("Price update could not be verified after the Inventory API mutation.");
      }

      return { product: updated, verifiedPrice: targetPrice, sku: variant.sku };
    },
  };
}