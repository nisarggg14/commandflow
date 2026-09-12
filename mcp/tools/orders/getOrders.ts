import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";
import { getOrders } from "@/services/order-api.service";

export function createGetOrdersTool(): MCPTool {
  return {
    name: "orders.getOrders",
    description: "List orders from the selected Order Management client.",
    category: ToolCategory.ORDERS,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    async execute(input) {
      return getOrders(input as { limit?: number; offset?: number });
    },
  };
}
