import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createGetOrdersTool(): MCPTool {
  return {
    name: "orders.getOrders",
    description: "Unsupported: the Inventory Backend has no order API.",
    category: ToolCategory.ORDERS,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    async execute() {
      throw new Error("Order operations are unsupported because the Inventory Backend does not provide an order API.");
    },
  };
}
