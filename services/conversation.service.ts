import { prisma } from "@/lib/prisma";
import { createConversationSchema } from "@/validators/conversation.validator";

export async function createConversation(
  data: unknown,
  companyId: string
) {
  const validatedData = createConversationSchema.parse(data);

  return prisma.conversation.create({
    data: {
      title: validatedData.title ?? "New Conversation",
      companyId,
    },
  });
}

export async function getConversations(companyId: string) {
  return prisma.conversation.findMany({
    where: {
      companyId,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function getConversationById(
  id: string,
  companyId: string
) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      companyId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

export async function deleteConversation(
  id: string,
  companyId: string
) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      companyId,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  await prisma.conversation.delete({
    where: {
      id,
    },
  });

  return {
    message: "Conversation deleted successfully",
  };
}