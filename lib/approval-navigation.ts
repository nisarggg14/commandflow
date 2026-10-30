export function getApprovalHref(approvalId: unknown): string | null {
  if (typeof approvalId !== "string") return null;
  const normalizedId = approvalId.trim();
  if (!normalizedId || normalizedId.length > 200) return null;
  return `/admin/approvals?id=${encodeURIComponent(normalizedId)}`;
}
