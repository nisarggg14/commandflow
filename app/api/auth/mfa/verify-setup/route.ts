import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { decryptSecret, verifyTotpCode } from "@/lib/mfa";

export async function POST(req: NextRequest) {
  try {
    const authUser = authenticate(req);
    const { code } = await req.json();

    if (!code || typeof code !== "string") {
      return NextResponse.json({ success: false, message: "A 6-digit MFA code is required." }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (!user || !user.mfaSecret) {
      return NextResponse.json({ success: false, message: "MFA setup has not been initiated for this account." }, { status: 400 });
    }

    if (!(await verifyTotpCode(decryptSecret(user.mfaSecret), code))) {
      return NextResponse.json({ success: false, message: "Invalid MFA code." }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: authUser.id },
      data: { mfaEnabled: true },
    });

    return NextResponse.json({ success: true, message: "MFA enabled." });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "MFA verification failed." }, { status: 500 });
  }
}
