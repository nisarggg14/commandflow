import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createDeleteProductTool(): MCPTool {
  return {
    name: "products.deleteProduct",
    description: "Delete a product for the authenticated company.",
    category: ToolCategory.PRODUCTS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      productId: z.string().min(1),
    }),
    async execute(input, context) {
      const { productId } = input as { productId: string };

      return context.prisma.$executeRawUnsafe(`DELETE FROM "Product" WHERE id = '${productId}' AND "companyId" = '${context.companyId}'`);
    },
  };
}
