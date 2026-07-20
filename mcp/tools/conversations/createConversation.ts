import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createCreateConversationTool(): MCPTool {
  return {
    name: "conversations.createConversation",
    description: "Create a conversation record for the authenticated user and company.",
    category: ToolCategory.CONVERSATIONS,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      title: z.string().min(1).max(200),
    }),
    async execute(input, context) {
      const { title } = input as { title: string };

      return context.prisma.conversation.create({
        data: {
          title,
          userId: context.userId,
          companyId: context.companyId,
        },
      });
    },
  };
}
