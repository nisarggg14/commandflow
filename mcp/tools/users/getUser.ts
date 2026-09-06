import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

export function createGetUserTool(): MCPTool {
  return {
    name: "users.getUser",
    description: "Fetch a single user from the authenticated company.",
    category: ToolCategory.USERS,
    riskLevel: RiskLevel.LOW,
    requiresMfaStepUp: false,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      userId: z.string().min(1),
    }),
    async execute(input, context) {
      const { userId } = input as { userId: string };

      return context.prisma.user.findFirst({
        where: {
          id: userId,
          companyId: context.companyId,
        },
      });
    },
  };
}
