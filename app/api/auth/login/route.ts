import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { loginUser } from "@/services/auth.service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const limit = await enforceRateLimit(`login:${requestAddress(req)}:${body.email ?? ""}`, 10, 15 * 60 * 1000);

    if (!limit.allowed) return NextResponse.json({ success: false, message: "Too many login attempts." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const result = await loginUser(body);

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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Login failed",
      },
      { status: 401 }
    );
  }
}