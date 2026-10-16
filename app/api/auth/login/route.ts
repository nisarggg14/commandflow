import { NextRequest, NextResponse } from "next/server";

import { AuthenticationServiceError, UnauthorizedError } from "@/lib/errors";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { loginUser } from "@/services/auth.service";

const INVALID_LOGIN_MESSAGE = "Invalid email or password.";
const SERVICE_UNAVAILABLE_MESSAGE = "Authentication service unavailable. Please try again later.";
const GENERIC_LOGIN_MESSAGE = "Login failed. Please try again later.";

type LoginResult = {
  token: string;
  [key: string]: unknown;
};

export function getLoginErrorResponse(error: unknown): { status: number; message: string; log: boolean; logKind?: string } {
  if (error instanceof UnauthorizedError) {
    return { status: 401, message: INVALID_LOGIN_MESSAGE, log: false };
  }

  if (error instanceof AuthenticationServiceError) {
    return { status: 503, message: SERVICE_UNAVAILABLE_MESSAGE, log: true, logKind: "authentication-service" };
  }

  return { status: 500, message: GENERIC_LOGIN_MESSAGE, log: true, logKind: "unexpected" };
}

export function redactLoginDiagnostic(error: unknown): string {
  const diagnostic = error instanceof AuthenticationServiceError && error.cause instanceof Error
    ? error.cause
    : error;
  if (!(diagnostic instanceof Error)) return "Unknown authentication error.";

  return `${diagnostic.name}: [REDACTED]`;
}

function logLoginFailure(error: unknown, kind: string): void {
  const diagnostic = error instanceof AuthenticationServiceError && error.cause instanceof Error
    ? error.cause
    : error;
  const message = redactLoginDiagnostic(error);
  const name = diagnostic instanceof Error ? diagnostic.name : "UnknownError";
  console.error(`[auth.login] ${kind} failure`, { name, message });
}

export function createLoginSuccessResponse(result: LoginResult): NextResponse {
  const { token: _token, ...safeResult } = result;
  const response = NextResponse.json(safeResult);
  response.cookies.set("token", result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let limit;
    try {
      limit = await enforceRateLimit(`login:${requestAddress(req)}:${body.email ?? ""}`, 10, 15 * 60 * 1000);
    } catch (error) {
      throw new AuthenticationServiceError("Authentication rate limiter unavailable.", error);
    }

    if (!limit.allowed) return NextResponse.json({ success: false, message: "Too many login attempts." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    return createLoginSuccessResponse(await loginUser(body));
  } catch (error) {
    const result = getLoginErrorResponse(error);
    if (result.log) logLoginFailure(error, result.logKind ?? "unknown");
    return NextResponse.json(
      { success: false, message: result.message },
      { status: result.status },
    );
  }
}