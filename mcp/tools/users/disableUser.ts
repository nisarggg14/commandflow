import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createDisableUserTool(): MCPTool {
  return {
    name: "users.disableUser",
    description: "Disable a user for the authenticated company.",
    category: ToolCategory.USERS,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      userId: z.string().min(1),
    }),
    async execute(input, context) {
      const { userId } = input as { userId: string };

      return context.prisma.user.updateMany({
        where: {
          id: userId,
          companyId: context.companyId,
        },
        data: {
          role: "VIEWER" as const,
        },
      });
    },
  };
}
