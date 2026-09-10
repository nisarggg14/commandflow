import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createGetUsersTool(): MCPTool {
  return {
    name: "users.getUsers",
    description: "Retrieve users for the authenticated company.",
    category: ToolCategory.USERS,
    permissions: [Permission.VIEWER, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    async execute(input, context) {
      const { limit = 50, offset = 0 } = input as { limit?: number; offset?: number };

      const users = await context.prisma.user.findMany({
        where: { companyId: context.companyId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          mfaEnabled: true,
          companyId: true,
          createdAt: true,
          updatedAt: true,
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      });

      return users.map((u: any) => {
        const { password: _p, mfaSecret: _m, ...safeUser } = u;
        return safeUser;
      });
    },
  };
}
