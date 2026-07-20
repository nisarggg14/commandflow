import { z } from "zod";
import { Permission, ToolCategory, type MCPContext, type MCPTool } from "../../types";

export function createUpdateProductPriceTool(): MCPTool {
  return {
    name: "updateProductPrice",
    description: "Update the price of an existing product.",
    category: ToolCategory.PRODUCTS,
    permissions: [Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
      price: z.number().positive(),
    }),
    async execute(input, context) {
      const { productId, price } = input as { productId: string; price: number };

      return context.prisma.product.update({
        where: { id: productId },
        data: { price },
      });
    },
  };
}
