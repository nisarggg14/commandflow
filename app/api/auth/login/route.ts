import { NextRequest, NextResponse } from "next/server";
import { AuthenticationServiceError, UnauthorizedError } from "@/lib/errors";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { loginUser } from "@/services/auth.service";
import { ZodError } from "zod";

const INVALID_LOGIN_MESSAGE = "Invalid email or password.";
const SERVICE_UNAVAILABLE_MESSAGE = "Authentication service unavailable. Please try again later.";
const GENERIC_LOGIN_MESSAGE = "Login failed. Please try again later.";

type LoginResult = {
  token: string;
  [key: string]: unknown;
};

export function getLoginErrorResponse(error: unknown): {
  status: number;
  message: string;
  log: boolean;
  logKind?: string;
} {
  if (error instanceof ZodError) {
    return { status: 400, message: "Invalid login request.", log: false };
  }

  if (error instanceof UnauthorizedError) {
    return { status: 401, message: INVALID_LOGIN_MESSAGE, log: false };
  }

  if (error instanceof AuthenticationServiceError) {
    return {
      status: 503,
      message: SERVICE_UNAVAILABLE_MESSAGE,
      log: true,
      logKind: "authentication-service",
    };
  }

  return {
    status: 500,
    message: GENERIC_LOGIN_MESSAGE,
    log: true,
    logKind: "unexpected",
  };
}

export function redactLoginDiagnostic(error: unknown): string {
  const diagnostic =
    error instanceof AuthenticationServiceError && error.cause instanceof Error
      ? error.cause
      : error;

  if (!(diagnostic instanceof Error)) return "Unknown authentication error.";
  return `${diagnostic.name}: [REDACTED]`;
}

function logLoginFailure(error: unknown, kind: string): void {
  const diagnostic =
    error instanceof AuthenticationServiceError && error.cause instanceof Error
      ? error.cause
      : error;

  console.error(`[auth.login] ${kind} failure`, {
    name: diagnostic instanceof Error ? diagnostic.name : "UnknownError",
    message: redactLoginDiagnostic(error),
  });
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

export function createLoginMfaRequiredResponse(result: {
  challengeToken: string;
  expiresAt: string;
}): NextResponse {
  return NextResponse.json({
    success: true,
    mfaRequired: true,
    challengeToken: result.challengeToken,
    expiresAt: result.expiresAt,
  });
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid login request." },
        { status: 400 },
      );
    }

    let limit;
    try {
      const email =
        body !== null &&
        typeof body === "object" &&
        "email" in body &&
        typeof body.email === "string"
          ? body.email
          : "";
      limit = await enforceRateLimit(
        `login:${requestAddress(req)}:${email}`,
        10,
        15 * 60 * 1000,
      );
    } catch (error) {
      throw new AuthenticationServiceError(
        "Authentication rate limiter unavailable.",
        error,
      );
    }

    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many login attempts." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    const result = await loginUser(body);
    if (result.mfaRequired) return createLoginMfaRequiredResponse(result);
    return createLoginSuccessResponse(result);
  } catch (error) {
    const result = getLoginErrorResponse(error);

    if (result.log) {
      logLoginFailure(error, result.logKind ?? "unknown");
    }

    return NextResponse.json(
      { success: false, message: result.message },
      { status: result.status },
    );
  }
}
