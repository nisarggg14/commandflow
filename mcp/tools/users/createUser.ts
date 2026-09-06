import { z } from "zod";
import { UserRole } from "@prisma/client";
import { Permission, RiskLevel, ToolCategory, type MCPTool } from "../../types";
import { hashPassword } from "@/lib/bcrypt";

export function createCreateUserTool(): MCPTool {
  return {
    name: "users.createUser",
    description: "Create a user for the authenticated company.",
    category: ToolCategory.USERS,
    riskLevel: RiskLevel.MEDIUM,
    requiresMfaStepUp: false,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      role: z.nativeEnum(UserRole),
    }),
    async execute(input, context) {
      const { name, email, password, role } = input as {
        name: string;
        email: string;
        password: string;
        role: string;
      };

      const hashedPassword = await hashPassword(password);

      return context.prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: role as UserRole,
          companyId: context.companyId,
        },
      });
    },
  };
}
