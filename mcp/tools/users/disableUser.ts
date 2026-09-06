import { z } from "zod";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

export function createDisableUserTool(): MCPTool {
  return {
    name: "users.disableUser",
    description: "Disable a user for the authenticated company.",
    category: ToolCategory.USERS,
    riskLevel: RiskLevel.HIGH,
    requiresMfaStepUp: true,
    mfaPurpose: "users.disableUser",
    permissions: [Permission.ADMIN],
    inputSchema: z.object({
      userId: z.string().min(1),
    }),
    async execute(input, context) {
      const { userId } = input as { userId: string };

      if (context.role !== Permission.ADMIN && context.role !== "ADMIN") {
        throw new Error("Only an ADMIN may disable a user.");
      }

      if (userId === context.userId) {
        throw new Error("Users cannot disable their own account.");
      }

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
