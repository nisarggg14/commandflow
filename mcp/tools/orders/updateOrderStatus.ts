import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createUpdateOrderStatusTool(): MCPTool {
  return {
    name: "orders.updateOrderStatus",
    description: "Unsupported: the Inventory Backend has no order API.",
    category: ToolCategory.ORDERS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      orderId: z.string().min(1),
      status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]),
    }),
    async execute() {
      throw new Error("Order operations are unsupported because the Inventory Backend does not provide an order API.");
    },
  };
}
