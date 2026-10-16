import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import {
  createConversation,
  getConversations,
} from "@/services/conversation.service";
import { safeApiErrorResponse } from "@/lib/api-error-response";

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);

    const body = await req.json();

    const conversation = await createConversation(
      body,
      authUser.id,
      authUser.companyId
    );

    return NextResponse.json(conversation, {
      status: 201,
    });
  } catch (error) {
    return safeApiErrorResponse(error, "api.conversations.create", "Unable to create conversation.");
  }
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticate(req);

    const conversations = await getConversations(authUser.companyId, authUser.id);

    return NextResponse.json({
      success: true,
      conversations,
    });
  } catch (error) {
    return safeApiErrorResponse(error, "api.conversations.list", "Unable to load conversations.");
  }
}
