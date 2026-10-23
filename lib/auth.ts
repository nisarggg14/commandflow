import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { verifyToken, hashSessionToken } from "./jwt";
import { UserRole } from "@prisma/client";
import { AuthenticationServiceError, UnauthorizedError } from "./errors";
import { prisma } from "./prisma";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
}

export async function authenticate(req: NextRequest): Promise<AuthUser> {
  const authHeader = req.headers.get("authorization");
  const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : undefined;
  const tokenFromCookie = req.cookies.get("token")?.value;
  const token = tokenFromHeader ?? tokenFromCookie;

  return authenticateToken(token);
}

type AuthSessionStore = Pick<PrismaClient, "session" | "user">;

export async function authenticateToken(
  token: string | undefined,
  db: AuthSessionStore = prisma,
): Promise<AuthUser> {
  if (!token) {
    throw new UnauthorizedError("Authentication required.");
  }

  const tokenUser = verifyToken(token);
  if (!tokenUser.id) throw new UnauthorizedError("Invalid authentication token.");
  let session;
  try {
    session = await db.session.findUnique({
      where: { token: hashSessionToken(token) },
      select: {
        userId: true,
        expiresAt: true,
      },
    });
  } catch (error) {
    throw new AuthenticationServiceError("Authentication service unavailable. Please try again later.", error);
  }
  if (
    !session ||
    session.userId !== tokenUser.id ||
    session.expiresAt <= new Date()
  ) {
    throw new UnauthorizedError("Session is no longer valid.");
  }

  // Role and company always come from the current database record.
  let user;
  try {
    user = await db.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        companyId: true,
        company: { select: { id: true } },
      },
    });
  } catch (error) {
    throw new AuthenticationServiceError("Authentication service unavailable. Please try again later.", error);
  }
  if (!user || !user.active || !user.company || user.company.id !== user.companyId) {
    throw new UnauthorizedError("User account or company association is unavailable.");
  }
  return { id: user.id, email: user.email, role: user.role, companyId: user.company.id };
}
