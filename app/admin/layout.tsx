import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { authenticateToken, type AuthUser } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get("token")?.value;
  if (!token) redirect("/login");

  let user: AuthUser;
  try {
    user = await authenticateToken(token);
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }

  if (user.role !== UserRole.ADMIN) redirect("/");
  return children;
}
