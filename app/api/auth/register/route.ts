import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { registerUser } from "@/services/auth.service";
import { ZodError } from "zod";

const DUPLICATE_ACCOUNT_MESSAGE = "An account with this email already exists.";

export function getRegistrationErrorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof ZodError) {
    return { status: 400, message: "Invalid registration request." };
  }

  if (error instanceof Error && error.message === DUPLICATE_ACCOUNT_MESSAGE) {
    return { status: 409, message: DUPLICATE_ACCOUNT_MESSAGE };
  }

  if (error instanceof Error && error.message === "A strong production password is required.") {
    return { status: 400, message: error.message };
  }

  return { status: 500, message: "Registration failed. Please try again later." };
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production" && process.env.PUBLIC_REGISTRATION_ENABLED !== "true") return NextResponse.json({ success: false, message: "Public registration is disabled." }, { status: 404 });
    const body = await req.json();
    const limit = await enforceRateLimit("register:" + requestAddress(req), 5, 60 * 60 * 1000);

    if (!limit.allowed) return NextResponse.json({ success: false, message: "Too many registration attempts." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

    const result = await registerUser(body);

    const { token: _token, ...safeResult } = result;

    return NextResponse.json(safeResult, { status: 201 });
  } catch (error) {
    const result = getRegistrationErrorResponse(error);
    if (result.status === 500) {
      console.error("[auth.register] registration failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json({ success: false, message: result.message }, { status: result.status });
  }
}
