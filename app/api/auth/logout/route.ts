import { NextRequest, NextResponse } from "next/server";

import { hashSessionToken } from "@/lib/jwt";

import { prisma } from "@/lib/prisma";



export async function POST(req: NextRequest) {

  const token = req.cookies.get("token")?.value;

  if (token) await prisma.session.deleteMany({ where: { token: hashSessionToken(token) } });

  const response = NextResponse.json({ success: true, message: "Logged out" });

  response.cookies.set("token", "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });

  return response;

}
