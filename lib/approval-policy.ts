import type { UserRole } from "@prisma/client";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const PROJECT_DEFAULT_ALLOW_ADMIN_SELF_APPROVAL = true;

export const ADMIN_SELF_APPROVAL_DISABLED_MESSAGE =
  "Administrators cannot approve their own destructive action while ALLOW_ADMIN_SELF_APPROVAL is disabled.";

export function isAdminSelfApprovalEnabled(): boolean {
  const configured = process.env.ALLOW_ADMIN_SELF_APPROVAL;
  if (configured === undefined || configured.trim() === "") {
    return PROJECT_DEFAULT_ALLOW_ADMIN_SELF_APPROVAL;
  }
  return TRUE_VALUES.has(configured.trim().toLowerCase());
}

export function isSelfApprovalAllowed({
  requesterId,
  approverId,
  approverRole,
}: {
  requesterId: string;
  approverId: string;
  approverRole: UserRole | string;
}): boolean {
  if (requesterId !== approverId) return true;
  return approverRole === "ADMIN" && isAdminSelfApprovalEnabled();
}
