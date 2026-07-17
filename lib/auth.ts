import { NextRequest } from "next/server";
import { verifyToken } from "./jwt";
import { UserRole } from "@prisma/client";
import { UnauthorizedError } from "./errors";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
}

export function authenticate(req: NextRequest): AuthUser {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const token = authHeader.split(" ")[1];

  return verifyToken(token) as AuthUser;
}