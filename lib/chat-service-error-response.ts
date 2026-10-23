import { NextResponse } from "next/server";

import {
  GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE,
  GeminiIntentAnalysisError,
  GeminiIntentResponseError,
  GeminiQuotaError,
  GeminiTemporaryUnavailableError,
} from "@/services/llm.service";

function errorResponseBody(error: unknown, message: string, requestId?: string) {
  const executionTrace = error && typeof error === "object"
    ? (error as { executionTrace?: unknown }).executionTrace
    : undefined;
  return {
    success: false,
    message,
    ...(requestId ? { requestId } : {}),
    ...(Array.isArray(executionTrace) ? { execution: { stages: executionTrace } } : {}),
  };
}

export function chatServiceErrorResponse(error: unknown, requestId?: string): NextResponse | undefined {
  if (error instanceof GeminiQuotaError) {
    return NextResponse.json(errorResponseBody(error, error.message, requestId), { status: 429 });
  }

  if (error instanceof GeminiTemporaryUnavailableError) {
    if (error.category === "rate_limited") {
      return NextResponse.json(
        errorResponseBody(error, "AI service temporarily unavailable because the Gemini API quota has been exceeded. Please try again later.", requestId),
        { status: 429 },
      );
    }
    return NextResponse.json(
      errorResponseBody(error, GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE, requestId),
      { status: 503 },
    );
  }

  if (error instanceof GeminiIntentAnalysisError) {
    return NextResponse.json(errorResponseBody(error, error.message, requestId), { status: 502 });
  }

  if (error instanceof GeminiIntentResponseError) {
    return NextResponse.json(
      errorResponseBody(error, "Command understanding service returned an invalid response. Please try again later.", requestId),
      { status: 502 },
    );
  }

  return undefined;
}
