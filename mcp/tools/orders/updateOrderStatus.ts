import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { updateOrderStatus } from "@/services/order-api.service";

export function createUpdateOrderStatusTool(): MCPTool {
  return {
    name: "orders.updateOrderStatus",
    description: "Update an order status through the selected Order Management client.",
    category: ToolCategory.ORDERS,
    riskLevel: RiskLevel.MEDIUM,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      orderId: z.string().min(1),
      status: z.enum(["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"]),
    }),
    async execute(input) {
      return updateOrderStatus(input as { orderId: string; status: "PENDING" | "PROCESSING" | "SHIPPED" | "DELIVERED" });
    },
  };
}
