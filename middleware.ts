import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPrefixes = ["/", "/chat", "/settings", "/logs", "/admin"];
const protectedApiPrefixes = ["/api/chat", "/api/logs", "/api/admin", "/api/approvals", "/api/connected-clients", "/api/conversations", "/api/automations"];

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
  matcher: ["/", "/chat/:path*", "/settings/:path*", "/logs/:path*", "/admin/:path*", "/api/chat/:path*", "/api/logs/:path*", "/api/admin/:path*", "/api/approvals/:path*", "/api/connected-clients/:path*", "/api/conversations/:path*", "/api/automations/:path*"],
};
