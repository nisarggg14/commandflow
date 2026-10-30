import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { getProduct } from "@/services/inventory-api.service";

export function createGetProductTool(): MCPTool {
  return {
    name: "products.getProduct",
    description: "Fetch a single product from the Inventory Backend.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
    }),
    async execute(input) {
      const { productId } = input as { productId: string };
      return getProduct(productId);
    },
  };
}
