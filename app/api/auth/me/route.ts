import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { getCurrentUser } from "@/services/auth.service";
import { UnauthorizedError, ForbiddenError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  try {
    const authUser = authenticate(req);
    const user = await getCurrentUser(authUser.id);

    return NextResponse.json({ success: true, user });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 403 });
    }

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}