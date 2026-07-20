import { z } from "zod";
import { Permission, ToolCategory, type MCPTool } from "../../types";

export function createDeleteConversationTool(): MCPTool {
  return {
    name: "conversations.deleteConversation",
    description: "Delete a conversation owned by the authenticated user.",
    category: ToolCategory.CONVERSATIONS,
    permissions: [Permission.VIEWER, Permission.EMPLOYEE, Permission.MANAGER, Permission.ADMIN],
    inputSchema: z.object({
      conversationId: z.string().min(1),
    }),
    async execute(input, context) {
      const { conversationId } = input as { conversationId: string };

      return context.prisma.conversation.deleteMany({
        where: {
          id: conversationId,
          userId: context.userId,
          companyId: context.companyId,
        },
      });
    },
  };
}
