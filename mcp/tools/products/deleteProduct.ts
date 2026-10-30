import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { deleteProduct } from "@/services/inventory-api.service";

export function createDeleteProductTool(): MCPTool {
  return {
    name: "products.deleteProduct",
    description: "Delete a product from the Inventory backend after a server-validated HIGH-risk approval and MFA step-up.",
    category: ToolCategory.PRODUCTS,
    riskLevel: RiskLevel.HIGH,
    requiresMfaStepUp: true,
    mfaPurpose: "products.deleteProduct",
    permissions: [Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1).max(128),
    }),

    async execute(input) {
      const { productId } = input as { productId: string };
      return deleteProduct(productId);
    },
  };
}
