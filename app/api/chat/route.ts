import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit } from "@/lib/rate-limit";
import { processChat } from "@/services/chat.service";
import { authenticate } from "@/lib/auth";
import { GeminiQuotaError } from "@/services/llm.service";
import { NotFoundError } from "@/lib/errors";

import { chatRequestSchema } from "@/validators/chat.validator";

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticate(req);
    const limit = await enforceRateLimit(`chat:${authUser.id}`, 60, 60 * 1000);

    if (!limit.allowed) return NextResponse.json({ success: false, message: "Chat rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const contentLength = Number(req.headers.get("content-length") ?? 0);

    if (contentLength > 64 * 1024) return NextResponse.json({ success: false, message: "Request body is too large." }, { status: 413 });

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > 64 * 1024) return NextResponse.json({ success: false, message: "Request body is too large." }, { status: 413 });
    const body = chatRequestSchema.parse(JSON.parse(rawBody));

    const result = await processChat({
      conversationId: body.conversationId,
      message: body.message,
      userId: authUser.id,
      companyId: authUser.companyId,
      mfaChallengeToken: typeof body.mfaChallengeToken === "string" ? body.mfaChallengeToken : undefined,
      connectedClientId: body.connectedClientId === null
        ? null
        : typeof body.connectedClientId === "string"
          ? body.connectedClientId
          : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API Error:", error);

    if (error instanceof Error && error.message === "Conversation not found.") {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 404 }
      );
    }

    if (error instanceof SyntaxError || (error && typeof error === "object" && (error as { name?: string }).name === "ZodError")) return NextResponse.json({ success: false, message: "Invalid chat request." }, { status: 400 });



    if (error instanceof NotFoundError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 404 });
    }

    if (error instanceof GeminiQuotaError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 429 }
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
