import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
}

export function generateToken(payload: JwtPayload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyToken(token: string): JwtPayload {
  const verified = jwt.verify(token, JWT_SECRET) as unknown as Partial<JwtPayload> & Record<string, unknown>;

  return {
    id: typeof verified.id === "string" ? verified.id : "",
    email: typeof verified.email === "string" ? verified.email : "",
    role: (verified.role as JwtPayload["role"]) ?? "VIEWER",
    companyId: typeof verified.companyId === "string" ? verified.companyId : "",
  };
}