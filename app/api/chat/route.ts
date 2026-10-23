import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit } from "@/lib/rate-limit";
import { processChat } from "@/services/chat.service";
import { authenticate } from "@/lib/auth";
import { AuthenticationServiceError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { chatServiceErrorResponse } from "@/lib/chat-service-error-response";
import { logServerError } from "@/lib/server-error-logging";

import { chatRequestSchema } from "@/validators/chat.validator";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = Date.now();
  const addRequestMetadata = (response: NextResponse) => {
    const durationMs = Date.now() - requestStartedAt;
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("X-Request-Duration-Ms", String(durationMs));
    console.info("[api.chat] request completed", {
      requestId,
      durationMs,
      status: response.status,
    });
    return response;
  };
  const respond = (body: unknown, init?: ResponseInit) => {
    return addRequestMetadata(NextResponse.json(body, init));
  };
  console.info("[api.chat] request received", { requestId });
  const sensitiveRequestValues = [
    req.headers.get("authorization") ?? "",
    req.headers.get("cookie") ?? "",
  ];

  try {
    const authUser = await authenticate(req);
    const limit = await enforceRateLimit(`chat:${authUser.id}`, 60, 60 * 1000);

    if (!limit.allowed) return respond({ success: false, message: "Chat rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const contentLength = Number(req.headers.get("content-length") ?? 0);

    if (contentLength > 64 * 1024) return respond({ success: false, message: "Request body is too large." }, { status: 413 });

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > 64 * 1024) return respond({ success: false, message: "Request body is too large." }, { status: 413 });
    const body = chatRequestSchema.parse(JSON.parse(rawBody));
    sensitiveRequestValues.push(
      ...Object.values(body).filter((value): value is string => typeof value === "string"),
    );

    const result = await processChat({
      conversationId: body.conversationId,
      message: body.message,
      userId: authUser.id,
      companyId: authUser.companyId,
      mfaChallengeToken: typeof body.mfaChallengeToken === "string" ? body.mfaChallengeToken : undefined,
      connectedClientId: body.connectedClientId,
      requestId,
    });

    return respond(result);
  } catch (error) {
    logServerError("api.chat", error, sensitiveRequestValues, requestId);

    if (error instanceof UnauthorizedError) {
      return respond({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof AuthenticationServiceError) {
      return respond(
        { success: false, message: "Authentication service unavailable. Please try again later." },
        { status: 503 }
      );
    }

    if (error instanceof Error && error.message === "Conversation not found.") {
      return respond(
        {
          success: false,
          message: error.message,
        },
        { status: 404 }
      );
    }

    if (error instanceof SyntaxError || (error && typeof error === "object" && (error as { name?: string }).name === "ZodError")) return respond({ success: false, message: "Invalid chat request." }, { status: 400 });



    if (error instanceof NotFoundError) {
      return respond({ success: false, message: error.message }, { status: 404 });
    }

    const serviceErrorResponse = chatServiceErrorResponse(error, requestId);
    if (serviceErrorResponse) {
      return addRequestMetadata(serviceErrorResponse);
    }

    return respond(
      {
        success: false,
        message: "Chat request failed. Please try again later.",
      },
      { status: 500 }
    );
  }
}
