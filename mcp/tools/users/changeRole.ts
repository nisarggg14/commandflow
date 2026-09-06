import { z } from "zod";
import { UserRole } from "@prisma/client";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";

export function createChangeRoleTool(): MCPTool {
  return {
    name: "users.changeRole",
    description: "Update a user role within the authenticated company.",
    category: ToolCategory.USERS,
    riskLevel: RiskLevel.HIGH,
    requiresMfaStepUp: true,
    mfaPurpose: "users.changeRole",
    permissions: [Permission.ADMIN],
    inputSchema: z.object({
      userId: z.string().min(1),
      role: z.enum(["ADMIN", "MANAGER", "VIEWER"]),
    }),
    async execute(input, context) {
      const { userId, role } = input as { userId: string; role: keyof typeof UserRole };

      if (context.role !== Permission.ADMIN && context.role !== "ADMIN") {
        throw new Error("Only an ADMIN may change roles.");
      }

      if (userId === context.userId) {
        throw new Error("Users cannot change their own role.");
      }

      const nextRole = UserRole[role];
      if (!nextRole || nextRole === UserRole.ADMIN) {
        throw new Error("Role changes must be server-authorized and cannot promote a user to ADMIN without the approval workflow.");
      }

      return context.prisma.user.updateMany({
        where: {
          id: userId,
          companyId: context.companyId,
        },
        data: {
          role: nextRole,
        },
      });
    },
  };
}
