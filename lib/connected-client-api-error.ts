import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  AuthenticationServiceError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@/lib/errors";

function logConnectedClientError(error: unknown): void {
  const cause =
    error instanceof AuthenticationServiceError ? error.cause : undefined;
  const diagnostic = cause instanceof Error ? cause : error;
  const code =
    diagnostic &&
    typeof diagnostic === "object" &&
    "code" in diagnostic &&
    typeof diagnostic.code === "string"
      ? diagnostic.code
      : undefined;

  console.error("[api.connected-clients] request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    causeName: cause instanceof Error ? cause.name : undefined,
    code,
  });
}

export function connectedClientErrorResponse(error: unknown): NextResponse {
  logConnectedClientError(error);

  if (error instanceof UnauthorizedError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 401 },
    );
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 403 },
    );
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 404 },
    );
  }
  if (error instanceof ConflictError) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 409 },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid connected client data.",
        issues: error.issues,
      },
      { status: 400 },
    );
  }
  if (error instanceof AuthenticationServiceError) {
    return NextResponse.json(
      {
        success: false,
        message: "Connected client service unavailable. Please try again later.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { success: false, message: "Internal Server Error" },
    { status: 500 },
  );
}
