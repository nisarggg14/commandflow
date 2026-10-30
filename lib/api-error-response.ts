import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  AuthenticationServiceError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationFailedError,
} from "@/lib/errors";

export function safeApiErrorResponse(
  error: unknown,
  context: string,
  fallbackMessage: string,
  fallbackStatus = 500,
): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 409 });
  }
  if (error instanceof ValidationFailedError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }
  if (error instanceof AuthenticationServiceError) {
    return NextResponse.json(
      { success: false, message: "Authentication service unavailable. Please try again later." },
      { status: 503 },
    );
  }

  console.error(`[${context}] request failed`, {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json({ success: false, message: fallbackMessage }, { status: fallbackStatus });
}
