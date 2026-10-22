import { NextResponse } from "next/server";

import {
  GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE,
  GeminiIntentAnalysisError,
  GeminiIntentResponseError,
  GeminiQuotaError,
  GeminiTemporaryUnavailableError,
} from "@/services/llm.service";

export function chatServiceErrorResponse(error: unknown): NextResponse | undefined {
  if (error instanceof GeminiQuotaError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 429 });
  }

  if (error instanceof GeminiTemporaryUnavailableError) {
    if (error.category === "rate_limited") {
      return NextResponse.json(
        { success: false, message: "AI service temporarily unavailable because the Gemini API quota has been exceeded. Please try again later." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { success: false, message: GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }

  if (error instanceof GeminiIntentAnalysisError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 502 });
  }

  if (error instanceof GeminiIntentResponseError) {
    return NextResponse.json(
      {
        success: false,
        message: "Command understanding service returned an invalid response. Please try again later.",
      },
      { status: 502 },
    );
  }

  return undefined;
}
