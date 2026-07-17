import { UserRole } from "@prisma/client";
import { AuthUser } from "./auth";
import { ForbiddenError } from "./errors";

export function requireRole(
  user: AuthUser,
  allowedRoles: UserRole[]
) {
  if (!allowedRoles.includes(user.role)) {
    throw new ForbiddenError();
  }
}