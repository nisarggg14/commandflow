import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createUpdateStockTool(): MCPTool {
  return {
    name: "products.updateStock",
    description: "Unsupported: the Inventory Backend does not provide a stock-only endpoint.",
    category: ToolCategory.PRODUCTS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
      stock: z.number().int().min(0),
    }),
    async execute() {
      throw new Error("This operation is unsupported by the Inventory Backend contract. Use updateProduct to change supported product fields instead.");
    },
  };
}
