import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createRenameConversationTool(): MCPTool {
  return {
    name: "conversations.renameConversation",
    description: "Rename an existing conversation for the authenticated user.",
    category: ToolCategory.CONVERSATIONS,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      conversationId: z.string().min(1),
      title: z.string().min(1).max(200),
    }),
    async execute(input, context) {
      const { conversationId, title } = input as { conversationId: string; title: string };

      return context.prisma.conversation.updateMany({
        where: {
          id: conversationId,
          userId: context.userId,
          companyId: context.companyId,
        },
        data: { title },
      });
    },
  };
}
