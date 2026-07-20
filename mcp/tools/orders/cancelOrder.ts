import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createCancelOrderTool(): MCPTool {
  return {
    name: "orders.cancelOrder",
    description: "Cancel an order for the authenticated company.",
    category: ToolCategory.ORDERS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      orderId: z.string().min(1),
    }),
    async execute(input, context) {
      const { orderId } = input as { orderId: string };

      return context.prisma.$executeRawUnsafe(`UPDATE "Order" SET status = 'CANCELLED' WHERE id = '${orderId}' AND "companyId" = '${context.companyId}'`);
    },
  };
}
