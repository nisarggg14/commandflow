import { AsyncLocalStorage } from "node:async_hooks";
import { getExternalRequestTrace } from "@/services/external-request-trace";

export interface OrderApiConnection {
  baseUrl: string;
  authType: "NONE" | "BEARER" | "API_KEY" | "BASIC";
  authConfig: Record<string, string>;
  timeoutMs?: number;
}

const storage = new AsyncLocalStorage<OrderApiConnection>();
const fallbackBaseUrl = (process.env.ORDER_API_BASE_URL ?? "http://localhost:5001").replace(/\/+$/, "");

export function runWithOrderApiConnection<T>(connection: OrderApiConnection, operation: () => Promise<T>) {
  return storage.run(connection, operation);
}

function auth(headers: Headers, connection: OrderApiConnection) {
  if (connection.authType === "BEARER") {
    if (!connection.authConfig.token) throw new Error("Connected client bearer credentials are unavailable.");
    headers.set("Authorization", `Bearer ${connection.authConfig.token}`);
  } else if (connection.authType === "API_KEY") {
    if (!connection.authConfig.apiKey) throw new Error("Connected client API key credentials are unavailable.");
    headers.set(connection.authConfig.headerName || "X-API-Key", connection.authConfig.apiKey);
  } else if (connection.authType === "BASIC") {
    if (!connection.authConfig.username || !connection.authConfig.password) throw new Error("Connected client basic credentials are unavailable.");
    headers.set("Authorization", `Basic ${Buffer.from(`${connection.authConfig.username}:${connection.authConfig.password}`).toString("base64")}`);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.includes("..") || path.startsWith("//")) throw new Error("Order request path is not allowed.");
  const connection = storage.getStore() ?? { baseUrl: fallbackBaseUrl, authType: "NONE" as const, authConfig: {}, timeoutMs: 10000 };
  const url = new URL(path.slice(1), `${connection.baseUrl.replace(/\/+$/, "")}/`);
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  auth(headers, connection);
  let response: Response;
  const requestTrace = storage.getStore() ? getExternalRequestTrace() : undefined;
  requestTrace?.onRequestStart();
  try { response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(connection.timeoutMs ?? 10000) }); }
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
