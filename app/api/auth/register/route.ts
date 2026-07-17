import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/services/auth.service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await registerUser(body);

    return NextResponse.json(result, { status: 201 });
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