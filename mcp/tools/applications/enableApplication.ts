import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createEnableApplicationTool(): MCPTool {
  return {
    name: "applications.enableApplication",
    description: "Enable an application for the authenticated company.",
    category: ToolCategory.SYSTEM,
    permissions: [Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      applicationId: z.string().min(1),
    }),
    async execute(input, context) {
      const { applicationId } = input as { applicationId: string };

      return context.prisma.application.updateMany({
        where: {
          id: applicationId,
          companyId: context.companyId,
        },
        data: {
          status: "CONNECTED",
        },
      });
    },
  };
}
