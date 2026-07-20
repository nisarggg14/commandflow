import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createUpdateOrderStatusTool(): MCPTool {
  return {
    name: "orders.updateOrderStatus",
    description: "Update the status of an order for the authenticated company.",
    category: ToolCategory.ORDERS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      orderId: z.string().min(1),
      status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]),
    }),
    async execute(input, context) {
      const { orderId, status } = input as { orderId: string; status: string };

      return context.prisma.$executeRawUnsafe(`UPDATE "Order" SET status = '${status}' WHERE id = '${orderId}' AND "companyId" = '${context.companyId}'`);
    },
  };
}
