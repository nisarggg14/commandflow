import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createTotpSetupResult, encryptSecret } from "@/lib/mfa";

export async function POST(req: NextRequest) {
  try {
    const authUser = authenticate(req);
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { email: true, mfaEnabled: true },
    });

    if (!user) {
      throw new UnauthorizedError("User not found.");
    }

    if (user.mfaEnabled) {
      return NextResponse.json({ success: false, message: "MFA is already enabled." }, { status: 409 });
    }

    const setup = await createTotpSetupResult(user.email);

    await prisma.user.update({
      where: { id: authUser.id },
      data: { mfaSecret: encryptSecret(setup.secret) },
    });

    return NextResponse.json({
      success: true,
      setup: {
        otpauthUrl: setup.otpauthUrl,
        qrCodeDataUrl: setup.qrCodeDataUrl,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "MFA setup failed." }, { status: 500 });
  }
}
