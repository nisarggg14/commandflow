import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";
import { cancelOrder } from "@/services/order-api.service";

export function createCancelOrderTool(): MCPTool {
  return {
    name: "orders.cancelOrder",
    description: "Cancel an order through the selected Order Management client.",
    category: ToolCategory.ORDERS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      orderId: z.string().min(1),
    }),
    async execute(input) {
      return cancelOrder((input as { orderId: string }).orderId);
    },
  };
}
