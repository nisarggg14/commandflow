import { NextRequest, NextResponse } from "next/server";
import { processChat } from "@/services/chat.service";
import { authenticate } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const body = await req.json();

    const result = await processChat({
      conversationId: body.conversationId,
      message: body.message,
      userId: authUser.id,
      companyId: authUser.companyId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API Error:", error);

    if (
      error instanceof Error &&
      error.message === "Conversation not found."
    ) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}