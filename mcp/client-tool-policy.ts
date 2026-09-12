import { z } from "zod";

export const CLIENT_TOOL_NAMES = [
  "products.getProducts", "products.getProduct", "products.createProduct", "products.searchProducts",
  "products.updateProduct", "products.bulkUpdateStatus", "products.updateStock", "products.adjustPrice",
  "products.deleteProduct", "analytics.inventorySummary", "analytics.lowStockReport", "users.getUsers",
  "users.getUser", "users.createUser", "users.changeRole", "users.disableUser",
  "conversations.createConversation", "conversations.renameConversation", "conversations.deleteConversation",
  "applications.listApplications", "applications.enableApplication", "applications.disableApplication",
  "ui.getTheme", "ui.setTheme", "ui.setBackground", "ui.setAccentColor",
  "frontend.updateBackground", "frontend.updateTheme", "frontend.updateNavbar", "frontend.updateBranding",
  "orders.getOrders", "orders.updateOrderStatus", "orders.cancelOrder",
] as const;

export const clientToolNameSchema = z.enum(CLIENT_TOOL_NAMES);

export function normalizeEnabledToolNames(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("Connected client tools must be an array.");
  const known = new Set<string>(CLIENT_TOOL_NAMES);
  const names = [...new Set(value.filter((item): item is string => typeof item === "string"))];
  if (names.length !== value.length || names.some((name) => !known.has(name))) {
    throw new Error("Connected client contains an unsupported MCP tool.");
  }
  return names;
}
