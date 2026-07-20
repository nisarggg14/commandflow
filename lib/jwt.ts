import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { UnauthorizedError } from "./errors";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.trim().length === 0) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return secret;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
}

export function generateToken(payload: JwtPayload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): JwtPayload {
  try {
    const verified = jwt.verify(token, getJwtSecret()) as unknown as Partial<JwtPayload> & Record<string, unknown>;

    return {
      id: typeof verified.id === "string" ? verified.id : "",
      email: typeof verified.email === "string" ? verified.email : "",
      role: (verified.role as JwtPayload["role"]) ?? UserRole.VIEWER,
      companyId: typeof verified.companyId === "string" ? verified.companyId : "",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "TokenExpiredError") {
      throw new UnauthorizedError("Session expired. Please sign in again.");
    }

    throw new UnauthorizedError("Invalid or missing authentication token.");
  }
}