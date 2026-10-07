import { z } from "zod";
import { Prisma } from "@prisma/client";
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

      return context.prisma.$transaction(async (tx) => {
        const target = await tx.user.findFirst({ where: { id: userId, companyId: context.companyId }, select: { id: true, role: true, active: true } });
        if (!target) throw new Error("User not found.");
        if (target.role === "ADMIN" && target.active) {
          const admins = await tx.user.count({ where: { companyId: context.companyId, role: "ADMIN", active: true } });
          if (admins <= 1) throw new Error("The company must retain an active administrator.");
        }
        const updated = await tx.user.updateMany({ where: { id: userId, companyId: context.companyId, active: true }, data: { active: false } });
        if (updated.count !== 1) throw new Error("User was already disabled.");
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    },
  };
}
