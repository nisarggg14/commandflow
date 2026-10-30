import type { UserRole } from "@prisma/client";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const PROJECT_DEFAULT_ALLOW_ADMIN_SELF_APPROVAL = true;

export const ADMIN_SELF_APPROVAL_DISABLED_MESSAGE =
  "Administrators cannot approve their own destructive action while ALLOW_ADMIN_SELF_APPROVAL is disabled.";

export const HIGH_RISK_APPROVAL_TOOL_NAME = "products.deleteProduct";

export const HIGH_RISK_APPROVAL_TOOL_NAMES = [
  HIGH_RISK_APPROVAL_TOOL_NAME,
] as const;

const KNOWN_NON_APPROVAL_TOOLS = new Set([
  "products.getProducts",
  "products.getProduct",
  "products.createProduct",
  "products.searchProducts",
  "products.updateProduct",
  "products.bulkUpdateStatus",
  "products.updateStock",
  "products.adjustPrice",
  "analytics.inventorySummary",
  "analytics.lowStockReport",
  "users.getUsers",
  "users.getUser",
  "users.createUser",
  "users.changeRole",
  "users.disableUser",
  "conversations.createConversation",
  "conversations.renameConversation",
  "conversations.deleteConversation",
  "applications.listApplications",
  "applications.enableApplication",
  "applications.disableApplication",
  "ui.getTheme",
  "ui.setTheme",
  "ui.setBackground",
  "ui.setAccentColor",
  "frontend.updateBackground",
  "frontend.updateTheme",
  "frontend.updateNavbar",
  "frontend.updateBranding",
  "orders.getOrders",
  "orders.updateOrderStatus",
  "orders.cancelOrder",
]);

export function isKnownNonApprovalTool(toolName: string): boolean {
  return KNOWN_NON_APPROVAL_TOOLS.has(toolName);
}

export function isToolApprovalRequired(toolName: string, riskLevel?: string): boolean {
  if (toolName === HIGH_RISK_APPROVAL_TOOL_NAME) return true;
  return riskLevel === "HIGH" && !isKnownNonApprovalTool(toolName);
}

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
