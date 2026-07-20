import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createCreateProductTool(): MCPTool {
  return {
    name: "products.createProduct",
    description: "Create a new product for the authenticated company.",
    category: ToolCategory.PRODUCTS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      name: z.string().min(1),
      price: z.number().positive(),
      stock: z.number().int().min(0),
      description: z.string().optional(),
    }),
    async execute(input, context) {
      const { name, price, stock, description } = input as {
        name: string;
        price: number;
        stock: number;
        description?: string;
      };

      return context.prisma.$executeRawUnsafe(
        `INSERT INTO "Product" (id, name, price, stock, description, "companyId", "createdAt", "updatedAt") VALUES ('${crypto.randomUUID()}', '${name.replace(/'/g, "''")}', ${price}, ${stock}, '${(description ?? "").replace(/'/g, "''")}', '${context.companyId}', NOW(), NOW())`
      );
    },
  };
}
