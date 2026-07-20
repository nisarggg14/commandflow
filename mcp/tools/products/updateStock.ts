import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createUpdateStockTool(): MCPTool {
  return {
    name: "products.updateStock",
    description: "Update the stock quantity of an existing product.",
    category: ToolCategory.PRODUCTS,
    permissions: [Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
      stock: z.number().int().min(0),
    }),
    async execute(input, context) {
      const { productId, stock } = input as { productId: string; stock: number };

      return context.prisma.conversation.update({
        where: { id: productId },
        data: { title: `Stock updated: ${stock}` },
      });
    },
  };
}
