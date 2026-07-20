import { prisma } from "@/lib/prisma";
import { MessageRole } from "@prisma/client";
import { generateResponse } from "./llm.service";

interface ChatRequest {
  conversationId: string;
  message: string;
  userId: string;
  companyId: string;
}

export async function processChat(data: ChatRequest) {
  const { conversationId, message, userId, companyId } = data;

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
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
    throw new Error("Conversation not found.");
  }

  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.USER,
      content: message,
    },
  });

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const history = messages
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n");

  const prompt = `
You are CommandFlow AI.

You help users manage enterprise applications.

Conversation History:
${history}

Assistant:
`;

  const aiResponse = await generateResponse(prompt);

  if (!aiResponse.success) {
    throw new Error("Failed to generate AI response.");
  }

  const aiText = aiResponse.text.trim();

  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.ASSISTANT,
      content: aiText,
    },
  });

  return {
    success: true,
    conversationId,
    response: aiText,
  };
}