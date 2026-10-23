import { AsyncLocalStorage } from "node:async_hooks";
import { getExternalRequestTrace } from "@/services/external-request-trace";

import {
  assertSafeOutboundUrl,
  isConfiguredDevelopmentLoopbackUrl,
} from "@/lib/ssrf";

type InventoryRole = "admin" | "manager" | "viewer";

export type InventoryApiErrorCategory =
  | "authentication"
  | "permission"
  | "not_found"
  | "validation"
  | "conflict"
  | "http_error"
  | "service_unavailable"
  | "timeout"
  | "dns"
  | "connection_refused"
  | "network"
  | "malformed_response";

export class InventoryApiError extends Error {
  constructor(
    readonly category: InventoryApiErrorCategory,
    message: string,
    readonly httpStatus?: number,
    options?: ErrorOptions,
    readonly stage = "unknown",
    readonly elapsedMs?: number,
  ) {
    super(message, options);
    this.name = "InventoryApiError";
  }
}

export interface InventoryApiConnection {
  baseUrl: string;
  authType: "NONE" | "BEARER" | "API_KEY" | "BASIC" | "INVENTORY_LOGIN";
  authConfig: Record<string, string>;
  timeoutMs?: number;
  requestId?: string;
}

interface InventoryProductVariant {
  id?: string;
  sku: string;
  color: string;
  size: string;
  price: number;
  stock: number;
  image?: string | null;
}

export interface InventoryProduct {
  id?: string;
  productId: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  status: string;
  variants: InventoryProductVariant[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInventoryProduct(value: unknown): value is InventoryProduct {
  if (!isRecord(value) || !Array.isArray(value.variants)) return false;
  const requiredStrings = ["productId", "name", "brand", "category", "description", "status"];
  if (!requiredStrings.every((field) => typeof value[field] === "string")) return false;

  return value.variants.every((variant) => (
    isRecord(variant) &&
    typeof variant.sku === "string" &&
    typeof variant.color === "string" &&
    typeof variant.size === "string" &&
    typeof variant.price === "number" &&
    Number.isFinite(variant.price) &&
    typeof variant.stock === "number" &&
    Number.isFinite(variant.stock) &&
    (variant.image === undefined || variant.image === null || typeof variant.image === "string")
  ));
}

export interface InventorySummaryResponse {
  totalProducts: number;
  activeProducts: number;
  inactiveProducts: number;
  totalVariants: number;
  totalStock: number;
  lowStockCount: number;
  byCategory?: Record<string, number>;
  byStatus?: Record<string, number>;
}

export interface InventoryLowStockItem {
  productId: string;
  name: string;
  category: string;
  status: string;
  totalStock: number;
  threshold: number;
  variants: Array<{
    sku: string;
    color: string;
    size: string;
    stock: number;
  }>;
}

export interface InventoryLowStockReport {
  threshold: number;
  count: number;
  products: InventoryLowStockItem[];
}

const INVENTORY_AUTH_TIMEOUT_MS = 5_000;
const INVENTORY_REQUEST_TIMEOUT_MS = 5_000;

const inventoryConnectionStorage = new AsyncLocalStorage<InventoryApiConnection>();

async function assertInventoryUrl(
  raw: string,
  allowConfiguredDevelopmentLoopback: boolean,
): Promise<URL> {
  if (
    allowConfiguredDevelopmentLoopback &&
    isConfiguredDevelopmentLoopbackUrl(
      raw,
      process.env.INVENTORY_API_BASE_URL ?? "",
      process.env.NODE_ENV,
    )
  ) {
    return new URL(raw);
  }
  try {
    return await assertSafeOutboundUrl(raw);
  } catch (error) {
    const category = networkErrorCategory(error);
    throw new InventoryApiError(
      category === "network" ? "validation" : category,
      category === "timeout"
        ? "Inventory host DNS lookup timed out."
        : "Inventory Backend URL is not allowed or its host could not be validated.",
      undefined,
      { cause: error },
      "url_validation",
    );
  }
}

export async function validateInventoryApiBaseUrl(raw: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InventoryApiError("validation", "Enter a valid Inventory Backend URL.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new InventoryApiError("validation", "Inventory Backend URL is not allowed.");
  }
  await assertInventoryUrl(parsed.toString(), true);
  return parsed.toString().replace(/\/+$/, "");
}

function connectedLoginCredentials(config: Record<string, string>) {
  if (!config.username?.trim() || !config.password) {
    throw new InventoryApiError("authentication", "Inventory Backend username and password are required.");
  }
  return { username: config.username.trim(), password: config.password };
}

async function loginConnectedInventory(baseUrl: string, config: Record<string, string>): Promise<string> {
  const stageStartedAt = Date.now();
  const url = new URL("/auth/login", `${baseUrl.replace(/\/+$/, "")}/`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectedLoginCredentials(config)),
      signal: AbortSignal.timeout(INVENTORY_AUTH_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (error) {
    const category = networkErrorCategory(error);
    throw new InventoryApiError(category, networkErrorMessage(category), undefined, { cause: error }, "login", Date.now() - stageStartedAt);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new InventoryApiError("authentication", "Inventory Backend rejected the supplied username or password.", response.status, undefined, "login", Date.now() - stageStartedAt);
    }
    const error = normalizeInventoryError(response.status);
    throw new InventoryApiError(error.category, error.message, error.httpStatus, { cause: error }, "login", Date.now() - stageStartedAt);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new InventoryApiError("malformed_response", "Inventory Backend returned an invalid login response.", response.status, { cause: error }, "login", Date.now() - stageStartedAt);
  }
  if (!isRecord(payload) || typeof payload.token !== "string" || !payload.token) {
    throw new InventoryApiError("malformed_response", "Inventory Backend login response did not contain an access token.", response.status, undefined, "login", Date.now() - stageStartedAt);
  }
  return payload.token;
}

export async function testInventoryApiConnection(
  baseUrl: string,
  credentials: { username: string; password: string },
): Promise<{ productCount: number }> {
  const operationStartedAt = Date.now();
  let safeBaseUrl: string;
  try {
    safeBaseUrl = await validateInventoryApiBaseUrl(baseUrl);
  } catch (error) {
    if (error instanceof InventoryApiError) {
      throw new InventoryApiError(error.category, error.message, error.httpStatus, { cause: error }, "url_validation", Date.now() - operationStartedAt);
    }
    throw error;
  }
  const token = await loginConnectedInventory(safeBaseUrl, credentials);
  const requestStartedAt = Date.now();
  const productsUrl = new URL("/products", `${safeBaseUrl}/`);
  let response: Response;
  try {
    response = await fetch(productsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(INVENTORY_REQUEST_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch (error) {
    const category = networkErrorCategory(error);
    throw new InventoryApiError(category, networkErrorMessage(category), undefined, { cause: error }, "products", Date.now() - requestStartedAt);
  }
  if (!response.ok) {
    const error = normalizeInventoryError(response.status);
    throw new InventoryApiError(error.category, error.message, error.httpStatus, { cause: error }, "products", Date.now() - requestStartedAt);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new InventoryApiError("malformed_response", "Inventory Backend returned an invalid product-list response.", response.status, { cause: error }, "products", Date.now() - requestStartedAt);
  }
  if (!Array.isArray(payload) || !payload.every(isInventoryProduct)) {
    throw new InventoryApiError("malformed_response", "Inventory Backend returned an invalid product list.", response.status, undefined, "products", Date.now() - requestStartedAt);
  }
  return { productCount: payload.length };
}

export function runWithInventoryApiConnection<T>(
  connection: InventoryApiConnection,
  operation: () => Promise<T>
): Promise<T> {
  return inventoryConnectionStorage.run(connection, operation);
}

export function mapCommandFlowRoleToInventoryRole(role: string): InventoryRole {
  switch ((role || "").toUpperCase()) {
    case "ADMIN":
      return "admin";
    case "MANAGER":
      return "manager";
    case "VIEWER":
    default:
      return "viewer";
  }
}

function normalizeInventoryError(status: number): InventoryApiError {
  if (status === 401) {
    return new InventoryApiError("authentication", "Inventory authentication failed.", status);
  }

  if (status === 403) {
    return new InventoryApiError("permission", "You do not have permission to perform this inventory operation.", status);
  }

  if (status === 404) {
    return new InventoryApiError("not_found", "Inventory endpoint or product was not found.", status);
  }

  if (status === 400) {
    return new InventoryApiError("validation", "Inventory rejected the request data.", status);
  }

  if (status === 409) {
    return new InventoryApiError("conflict", "Inventory resource conflict.", status);
  }

  if (status >= 500) {
    return new InventoryApiError("service_unavailable", "Inventory service is currently unavailable.", status);
  }

  return new InventoryApiError("http_error", "Inventory request failed.", status);
}

function networkErrorCategory(error: unknown): Exclude<InventoryApiErrorCategory,
  "authentication" | "permission" | "not_found" | "validation" | "conflict" | "http_error" | "service_unavailable" | "malformed_response"> {
  const visited = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const record = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (record.name === "AbortError" || record.name === "TimeoutError") return "timeout";
    const code = typeof record.code === "string" ? record.code.toUpperCase() : "";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL") return "dns";
    if (code === "ECONNREFUSED") return "connection_refused";
    if (record.cause === undefined) break;
    current = record.cause;
  }

  return "network";
}

function networkErrorMessage(category: ReturnType<typeof networkErrorCategory>): string {
  switch (category) {
    case "timeout":
      return "Inventory service request timed out.";
    case "dns":
      return "Unable to resolve the Inventory service host.";
    case "connection_refused":
      return "Inventory service refused the connection.";
    default:
      return "Inventory service is unavailable.";
  }
}

function applyConnectedClientAuth(headers: Headers, connection: InventoryApiConnection) {
  const authConfig = connection.authConfig;

  switch (connection.authType) {
    case "NONE":
      return;
    case "BEARER":
      if (!authConfig.token) throw new Error("Connected client bearer credentials are unavailable.");
      headers.set("Authorization", `Bearer ${authConfig.token}`);
      return;
    case "API_KEY": {
      if (!authConfig.apiKey) throw new Error("Connected client API key credentials are unavailable.");
      const headerName = authConfig.headerName || "X-API-Key";
      if (!/^[A-Za-z0-9-]{1,64}$/.test(headerName) || /^(authorization|cookie|host|content-length)$/i.test(headerName)) {
        throw new Error("Connected client API key header configuration is invalid.");
      }
      headers.set(headerName, authConfig.apiKey);
      return;
    }
    case "BASIC":
      if (!authConfig.username || !authConfig.password) throw new Error("Connected client basic credentials are unavailable.");
      headers.set("Authorization", `Basic ${Buffer.from(`${authConfig.username}:${authConfig.password}`).toString("base64")}`);
      return;
    case "INVENTORY_LOGIN":
      return;
  }
}

function validateInventoryPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) {
    throw new Error("Inventory request path is not allowed.");
  }
}

async function inventoryRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  validateInventoryPath(path);
  const connection = inventoryConnectionStorage.getStore();
  if (!connection) {
    throw new InventoryApiError(
      "validation",
      "Select a target client before running this tool.",
      undefined,
      undefined,
      "client_selection",
    );
  }
  const baseUrl = connection.baseUrl;
  const requestUrl = await assertInventoryUrl(
    new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString(),
    true,
  );
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    throw new Error("Inventory base URL must use HTTP or HTTPS.");
  }

  const headers = new Headers(options.headers ?? {});

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const maxAttempts = 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (connection) {
      applyConnectedClientAuth(headers, connection);
      if (connection.authType === "INVENTORY_LOGIN") {
        const token = await loginConnectedInventory(baseUrl, connection.authConfig);
        headers.set("Authorization", `Bearer ${token}`);
      }
    }

    const signal = connection
      ? AbortSignal.timeout(connection.timeoutMs ?? INVENTORY_REQUEST_TIMEOUT_MS)
      : options.signal ?? AbortSignal.timeout(INVENTORY_REQUEST_TIMEOUT_MS);
    let response: Response;
    const requestTrace = getExternalRequestTrace();
    requestTrace?.onRequestStart();
    try {
      response = await fetch(requestUrl.toString(), { ...options, headers, signal, redirect: "manual" });
      console.info("[inventory.client] request completed", {
        requestId: connection.requestId,
        method: options.method ?? "GET",
        path,
        status: response.status,
      });
    } catch (error) {
      const category = networkErrorCategory(error);
      requestTrace?.onRequestFailed("Connected client request failed.", undefined, category);
      throw new InventoryApiError(category, networkErrorMessage(category), undefined, { cause: error });
    }

    try {
      const contentType = response.headers.get("content-type") ?? "";
      let payload: unknown = null;

      if (contentType.includes("application/json")) {
        try {
          payload = await response.json();
        } catch (error) {
          throw new InventoryApiError(
            "malformed_response",
            "Inventory service returned malformed JSON.",
            response.status,
            { cause: error },
          );
        }
      } else if (response.status !== 204) {
        payload = await response.text();
      }

      if (!response.ok) throw normalizeInventoryError(response.status);

      if (response.status === 204) {
        requestTrace?.onRequestComplete(response.status);
        return null as T;
      }

      requestTrace?.onRequestComplete(response.status);
      return payload as T;
    } catch (error) {
      const inventoryError = error instanceof InventoryApiError ? error : undefined;
      console.warn("[inventory.client] request failed", {
        requestId: connection.requestId,
        method: options.method ?? "GET",
        path,
        status: inventoryError?.httpStatus ?? response.status,
        category: inventoryError?.category ?? "malformed_response",
      });
      requestTrace?.onRequestFailed(
        "Connected client request failed.",
        inventoryError?.httpStatus ?? response.status,
        inventoryError?.category ?? "malformed_response",
      );
      throw error;
    }
  }

  throw new Error("Inventory request failed.");
}

export async function getProducts(): Promise<InventoryProduct[]> {
  const payload = await inventoryRequest<unknown>("/products", { method: "GET" });
  if (!Array.isArray(payload) || !payload.every(isInventoryProduct)) {
    throw new InventoryApiError("malformed_response", "Inventory service returned an invalid product list.");
  }
  return payload;
}

export async function getProduct(productId: string): Promise<InventoryProduct> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  const payload = await inventoryRequest<unknown>(`/products/${encodeURIComponent(productId)}`, { method: "GET" });
  if (!isInventoryProduct(payload)) {
    throw new InventoryApiError("malformed_response", "Inventory service returned invalid product details.");
  }
  return payload;
}

export async function getInventorySummary(category?: string): Promise<InventorySummaryResponse> {
  const products = await getProducts();
  const filteredProducts = category && category.trim()
    ? products.filter((product) => product.category.toLowerCase() === category.trim().toLowerCase())
    : products;
  const byCategory = Object.fromEntries(
    filteredProducts.reduce((counts, product) => {
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())
  );
  const byStatus = Object.fromEntries(
    filteredProducts.reduce((counts, product) => {
      counts.set(product.status, (counts.get(product.status) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())
  );
  const totalStock = filteredProducts.reduce(
    (total, product) => total + product.variants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0),
    0
  );

  return {
    totalProducts: filteredProducts.length,
    activeProducts: filteredProducts.filter((product) => product.status.toLowerCase() === "active").length,
    inactiveProducts: filteredProducts.filter((product) => product.status.toLowerCase() !== "active").length,
    totalVariants: filteredProducts.reduce((total, product) => total + product.variants.length, 0),
    totalStock,
    lowStockCount: filteredProducts.filter((product) =>
      product.variants.reduce((sum, variant) => sum + Number(variant.stock ?? 0), 0) <= 10
    ).length,
    byCategory,
    byStatus,
  };
}

export async function getLowStockReport(threshold = 10, category?: string): Promise<InventoryLowStockReport> {
  const params = new URLSearchParams({ threshold: String(threshold) });
  if (category && category.trim()) {
    params.set("category", category.trim());
  }

  return inventoryRequest<InventoryLowStockReport>(`/products/low-stock?${params.toString()}`);
}

export async function createProduct(payload: {
  productId: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  status: string;
  variants: InventoryProductVariant[];
}): Promise<InventoryProduct> {
  return inventoryRequest<InventoryProduct>("/products", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProduct(
  productId: string,
  payload: Partial<{
    name: string;
    brand: string;
    category: string;
    description: string;
    status: string;
  }>
): Promise<InventoryProduct> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  return inventoryRequest<InventoryProduct>(`/products/${encodeURIComponent(productId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function updateStock(
  productId: string,
  payload: {
    stock?: number;
    delta?: number;
    sku?: string;
    variantId?: string;
  }
): Promise<InventoryProduct> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  if (typeof payload.stock !== "number" && typeof payload.delta !== "number") {
    throw new Error("A target stock value or delta is required.");
  }

  return inventoryRequest<InventoryProduct>(`/products/${encodeURIComponent(productId)}`, {
    method: "PUT",
    body: JSON.stringify({
      variants: [{
        sku: payload.sku,
        id: payload.variantId,
        stock: payload.stock,
      }],
    }),
  });
}

export async function reduceProductPrice(
  productId: string,
  payload: {
    percentage?: number;
    amount?: number;
    price?: number;
    variantId?: string;
    sku?: string;
  }
): Promise<InventoryProduct> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  const hasPriceValue = typeof payload.price === "number";
  const hasPercentValue = typeof payload.percentage === "number";
  const hasAmountValue = typeof payload.amount === "number";

  if (!hasPriceValue && !hasPercentValue && !hasAmountValue) {
    throw new Error("A price value, percentage reduction, or amount reduction is required.");
  }

  return inventoryRequest<InventoryProduct>(`/products/${encodeURIComponent(productId)}`, {
    method: "PUT",
    body: JSON.stringify({
      variants: [{
        sku: payload.sku,
        id: payload.variantId,
        price: payload.price,
      }],
    }),
  });
}

export async function bulkUpdateStatus(
  productIds: string[],
  status: string
): Promise<{ updated: number; failed: number; affectedProductIds: string[]; errors: string[] }> {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new Error("At least one product ID is required.");
  }

  if (!status || !status.trim()) {
    throw new Error("A status is required.");
  }

  return inventoryRequest<{ updated: number; failed: number; affectedProductIds: string[]; errors: string[] }>("/products/bulk-status", {
    method: "PATCH",
    body: JSON.stringify({ productIds, status }),
  });
}

export async function deleteProduct(productId: string): Promise<{ message: string }> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  return inventoryRequest<{ message: string }>(`/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  });
}
