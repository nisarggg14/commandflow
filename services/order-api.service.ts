import { AsyncLocalStorage } from "node:async_hooks";
import { getExternalRequestTrace } from "@/services/external-request-trace";
import { validateInventoryApiBaseUrl } from "@/services/inventory-api.service";

import { assertSafeOutboundUrl, isConfiguredDevelopmentLoopbackUrl } from "@/lib/ssrf";

export interface OrderApiConnection {
  baseUrl: string;
  authType: "NONE" | "BEARER" | "API_KEY" | "BASIC" | "INVENTORY_LOGIN";
  authConfig: Record<string, string>;
  timeoutMs?: number;
}

const storage = new AsyncLocalStorage<OrderApiConnection>();

export function runWithOrderApiConnection<T>(connection: OrderApiConnection, operation: () => Promise<T>) {
  return storage.run(connection, operation);
}

async function auth(headers: Headers, connection: OrderApiConnection) {
  if (connection.authType === "BEARER") {
    if (!connection.authConfig.token) throw new Error("Connected client bearer credentials are unavailable.");
    headers.set("Authorization", `Bearer ${connection.authConfig.token}`);
  } else if (connection.authType === "API_KEY") {
    if (!connection.authConfig.apiKey) throw new Error("Connected client API key credentials are unavailable.");
    const headerName = connection.authConfig.headerName || "X-API-Key";

    if (!/^[A-Za-z0-9-]{1,64}$/.test(headerName) || /^(authorization|cookie|host|content-length)$/i.test(headerName)) throw new Error("Connected client API key header configuration is invalid.");

    headers.set(headerName, connection.authConfig.apiKey);
  } else if (connection.authType === "BASIC") {
    if (!connection.authConfig.username || !connection.authConfig.password) throw new Error("Connected client basic credentials are unavailable.");
    headers.set("Authorization", `Basic ${Buffer.from(`${connection.authConfig.username}:${connection.authConfig.password}`).toString("base64")}`);
  } else if (connection.authType === "INVENTORY_LOGIN") {
    const baseUrl = await validateInventoryApiBaseUrl(connection.baseUrl);
    const response = await fetch(new URL("/auth/login", `${baseUrl}/`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: connection.authConfig.username,
        password: connection.authConfig.password,
      }),
      signal: AbortSignal.timeout(connection.timeoutMs ?? 10_000),
      redirect: "manual",
    });
    if (response.status === 401 || response.status === 403) throw new Error("Inventory Backend rejected the supplied username or password.");
    if (!response.ok) throw new Error("Inventory Backend authentication failed.");
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || !("token" in payload) || typeof payload.token !== "string") {
      throw new Error("Inventory Backend returned an invalid login response.");
    }
    headers.set("Authorization", `Bearer ${payload.token}`);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.includes("..") || path.startsWith("//")) throw new Error("Order request path is not allowed.");
  const connection = storage.getStore();
  if (!connection) throw new Error("Select a target client before running this tool.");
  const rawUrl = new URL(path.slice(1), `${connection.baseUrl.replace(/\/+$/, "")}/`).toString();
  const url = isConfiguredDevelopmentLoopbackUrl(
    rawUrl,
    process.env.INVENTORY_API_BASE_URL ?? "",
    process.env.NODE_ENV,
  ) ? new URL(rawUrl) : await assertSafeOutboundUrl(rawUrl);
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  await auth(headers, connection);
  let response: Response;
  const requestTrace = storage.getStore() ? getExternalRequestTrace() : undefined;
  requestTrace?.onRequestStart();
  try { response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(connection.timeoutMs ?? 10000), redirect: "manual" }); }
  catch (error) { requestTrace?.onRequestFailed(error instanceof Error ? error.message : "Connected client request failed."); throw new Error("Order service is unavailable."); }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(response.status === 404 ? "Order endpoint or order was not found." : response.status >= 500 ? "Order service is currently unavailable." : "Order request failed.");
    requestTrace?.onRequestFailed(error.message);
    throw error;
  }
  requestTrace?.onRequestComplete();
  return payload as T;
}

export interface Order { orderId: string; customerName?: string; status: string; total?: number; items?: unknown[]; createdAt?: string }
export function getOrders(params: { limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams({ limit: String(params.limit ?? 50), offset: String(params.offset ?? 0) });
  return request<Order[]>(`/orders?${query}`);
}
export function updateOrderStatus(input: { orderId: string; status: string }) {
  if (!input.orderId.trim()) throw new Error("Order ID is required.");
  return request<Order>(`/orders/${encodeURIComponent(input.orderId)}/status`, { method: "PATCH", body: JSON.stringify({ status: input.status }) });
}
export function cancelOrder(orderId: string) {
  if (!orderId.trim()) throw new Error("Order ID is required.");
  return request<Order>(`/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
}
