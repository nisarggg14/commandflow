import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProduct, updateProduct } from "@/services/inventory-api.service";

export function createUpdateProductTool(): MCPTool {
  return {
    name: "products.updateProduct",
    description: "Update supported top-level product fields in the Inventory Backend. Only the fields actually supported by the Inventory API are accepted: name, brand, category, description, and status.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.MEDIUM,
    requiresMfaStepUp: false,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
      productQuery: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      brand: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      status: z.string().min(1).optional(),
    }),
    async execute(input) {
      const { productId, productQuery: _productQuery, ...rest } = input as {
        productId: string;
        productQuery?: string;
        name?: string;
        brand?: string;
        category?: string;
        description?: string;
        status?: string;
      };

      const updated = await updateProduct(productId, rest);
      const verified = await getProduct(productId);

      for (const [field, expectedValue] of Object.entries(rest)) {
        if (verified[field as keyof typeof verified] !== expectedValue) {
          throw new Error(`Product update could not be verified for ${field}.`);
        }
      }

      return updated;
    },
  };
}
