import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationServiceError, UnauthorizedError } from "@/lib/errors";
import { hashSessionToken } from "@/lib/jwt";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { verifyMfaLogin } from "@/services/auth.service";
import { createLoginSuccessResponse } from "@/app/api/auth/login/route";

const verificationSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(12).max(64).optional(),
}).refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
  message: "Provide either a TOTP code or a recovery code.",
});

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const input = verificationSchema.parse(body);
    const limit = await enforceRateLimit(
      `mfa-login:${requestAddress(req)}:${hashSessionToken(input.challengeToken)}`,
      5,
      5 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many MFA login attempts." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const result = await verifyMfaLogin(input);
    return createLoginSuccessResponse(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Invalid MFA login request." },
        { status: 400 },
      );
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired MFA login verification." },
        { status: 401 },
      );
    }
    if (error instanceof AuthenticationServiceError) {
      console.error("[auth.mfa.login] service unavailable", {
        errorName: error.name,
        causeName: error.cause instanceof Error ? error.cause.name : undefined,
      });
      return NextResponse.json(
        { success: false, message: "MFA login is temporarily unavailable." },
        { status: 503 },
      );
    }
    console.error("[auth.mfa.login] operation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { success: false, message: "MFA login failed. Please try again later." },
      { status: 500 },
    );
  }
}
