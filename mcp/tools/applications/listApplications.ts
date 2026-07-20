import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createListApplicationsTool(): MCPTool {
  return {
    name: "applications.listApplications",
    description: "List applications for the authenticated company.",
    category: ToolCategory.SYSTEM,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    async execute(input, context) {
      const { limit = 50, offset = 0 } = input as { limit?: number; offset?: number };

      return context.prisma.application.findMany({
        where: { companyId: context.companyId },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      });
    },
  };
}
