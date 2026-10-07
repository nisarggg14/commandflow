import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { registerUser } from "@/services/auth.service";

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
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Registration failed",
      },
      { status: 400 }
    );
  }
}
