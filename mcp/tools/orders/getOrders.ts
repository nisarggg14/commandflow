import { z } from "zod";
import { Permission, ToolCategory, type MCPContext, type MCPTool } from "../../types";

export function createGetOrdersTool(): MCPTool {
  return {
    name: "getOrders",
    description: "Retrieve orders for the authenticated company.",
    category: ToolCategory.ORDERS,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    async execute(input, context) {
      const { limit = 50, offset = 0 } = input as { limit?: number; offset?: number };

      return context.prisma.order.findMany({
        where: { companyId: context.companyId },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      });
    },
  };
}
