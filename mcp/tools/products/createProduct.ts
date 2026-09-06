import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { createProduct } from "@/services/inventory-api.service";

const productVariantSchema = z.object({
  sku: z.string().min(1),
  color: z.string().min(1),
  size: z.string().min(1),
  price: z.number().min(0),
  stock: z.number().int().min(0),
  image: z.string().nullable().optional(),
});

export function createCreateProductTool(): MCPTool {
  return {
    name: "products.createProduct",
    description: "Create a product in the Inventory Backend.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.MEDIUM,
    requiresMfaStepUp: false,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
      name: z.string().min(1),
      brand: z.string().min(1),
      category: z.string().min(1),
      description: z.string().min(1),
      status: z.string().min(1),
      variants: z.array(productVariantSchema).min(1),
    }),
    async execute(input) {
      const payload = input as {
        productId: string;
        name: string;
        brand: string;
        category: string;
        description: string;
        status: string;
        variants: Array<{
          sku: string;
          color: string;
          size: string;
          price: number;
          stock: number;
          image?: string | null;
        }>;
      };

      return createProduct({
        ...payload,
        variants: payload.variants.map((variant) => ({
          ...variant,
          image: variant.image ?? null,
        })),
      });
    },
  };
}
