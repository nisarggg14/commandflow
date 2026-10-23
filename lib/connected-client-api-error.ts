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
import { InventoryApiError } from "@/services/inventory-api.service";

function logConnectedClientError(error: unknown): void {
  if (error instanceof InventoryApiError) {
    const safeNetworkCodes = new Set([
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EAI_FAIL",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
    ]);
    const visited = new Set<object>();
    let current: unknown = error.cause;
    let networkCode: string | undefined;
    while (current && typeof current === "object" && !visited.has(current)) {
      visited.add(current);
      const cause = current as { code?: unknown; cause?: unknown };
      if (typeof cause.code === "string" && safeNetworkCodes.has(cause.code)) {
        networkCode = cause.code;
        break;
      }
      current = cause.cause;
    }
    console.error("[api.connected-clients] Inventory Backend operation failed", {
      stage: error.stage,
      category: error.category,
      httpStatus: error.httpStatus,
      elapsedMs: error.elapsedMs,
      networkCode,
    });
    return;
  }
  const cause = error instanceof AuthenticationServiceError ? error.cause : undefined;
  const diagnostic = cause instanceof Error ? cause : error;
  const code =
    diagnostic &&
    typeof diagnostic === "object" &&
    "code" in diagnostic &&
    typeof diagnostic.code === "string"
      ? diagnostic.code
      : undefined;
  const meta = diagnostic && typeof diagnostic === "object" && "meta" in diagnostic
    ? diagnostic.meta
    : undefined;
  const metadata = meta && typeof meta === "object"
    ? meta as { modelName?: unknown; column?: unknown }
    : undefined;
  const column = typeof metadata?.column === "string"
    ? metadata.column.split(".").at(-1)
    : undefined;

  console.error("[api.connected-clients] request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    causeName: cause instanceof Error ? cause.name : undefined,
    code: typeof code === "string" && (/^P\d{4}$/.test(code) || /^[A-Z0-9_]{1,40}$/.test(code)) ? code : undefined,
    modelName: typeof metadata?.modelName === "string" ? metadata.modelName : undefined,
    column,
  });
}

export function connectedClientErrorResponse(error: unknown): NextResponse {
  logConnectedClientError(error);

  if (error instanceof InventoryApiError) {
    const status = error.category === "validation" ? 400
      : error.category === "authentication" ? 401
      : error.category === "permission" ? 403
      : error.category === "not_found" ? 404
      : 502;
    return NextResponse.json({
      success: false,
      message: error.message,
      category: error.category,
      httpStatus: error.httpStatus,
      stage: error.stage,
      elapsedMs: error.elapsedMs,
    }, { status });
  }
  if (error instanceof ValidationFailedError) {
    return NextResponse.json({ success: false, message: error.message }, { status: 400 });
  }
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
        message: error.message,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { success: false, message: "Internal Server Error" },
    { status: 500 },
  );
}
