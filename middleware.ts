import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPrefixes = ["/chat", "/settings", "/logs"];
const protectedApiPrefixes = ["/api/chat", "/api/logs"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("token")?.value;

  const isProtectedPage = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isProtectedApi = protectedApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if ((!token && isProtectedPage) || (!token && isProtectedApi)) {
    const redirectUrl = new URL("/login", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/chat", "/settings", "/logs", "/api/chat/:path*", "/api/logs/:path*", "/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};