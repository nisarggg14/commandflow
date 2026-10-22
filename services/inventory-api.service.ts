import { AsyncLocalStorage } from "node:async_hooks";
import { getExternalRequestTrace } from "@/services/external-request-trace";

import {
  assertSafeOutboundUrl,
  isConfiguredDevelopmentLoopbackUrl,
} from "@/lib/ssrf";

type InventoryRole = "admin" | "manager" | "viewer";

export interface InventoryApiConnection {
  baseUrl: string;
  authType: "NONE" | "BEARER" | "API_KEY" | "BASIC";
  authConfig: Record<string, string>;
  timeoutMs?: number;
}

interface InventoryAuthResponse {
  token: string;
  role: InventoryRole;
  username: string;
}

interface InventoryProductVariant {
  sku: string;
  color: string;
  size: string;
  price: number;
  stock: number;
  image?: string | null;
}

export interface InventoryProduct {
  productId: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  status: string;
  variants: InventoryProductVariant[];
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

const INVENTORY_BASE_URL = (process.env.INVENTORY_API_BASE_URL ?? "http://localhost:5000").replace(/\/+$/, "");
const INVENTORY_AUTH_TIMEOUT_MS = 10_000;
const INVENTORY_REQUEST_TIMEOUT_MS = 10_000;

const inventoryConnectionStorage = new AsyncLocalStorage<InventoryApiConnection>();

async function assertInventoryUrl(
  raw: string,
  allowConfiguredDevelopmentLoopback: boolean,
): Promise<URL> {
  if (
    allowConfiguredDevelopmentLoopback &&
    isConfiguredDevelopmentLoopbackUrl(
      raw,
      INVENTORY_BASE_URL,
      process.env.NODE_ENV,
    )
  ) {
    return new URL(raw);
  }
  return assertSafeOutboundUrl(raw);
}

export function runWithInventoryApiConnection<T>(
  connection: InventoryApiConnection,
  operation: () => Promise<T>
): Promise<T> {
  return inventoryConnectionStorage.run(connection, operation);
}

let inventoryToken: string | null = null;
let inventoryTokenExpiresAt = 0;

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

async function getInventoryToken(): Promise<string> {
  const username = process.env.INVENTORY_API_USERNAME;
  const password = process.env.INVENTORY_API_PASSWORD;

  if (!username || !password) {
    throw new Error("Inventory API credentials are not configured.");
  }

  if (inventoryToken && Date.now() < inventoryTokenExpiresAt) {
    return inventoryToken;
  }

  const loginUrl = await assertInventoryUrl(
    new URL("/auth/login", `${INVENTORY_BASE_URL}/`).toString(),
    true,
  );
  let response: Response;
  try {
    response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        password,
      }),
      signal: AbortSignal.timeout(INVENTORY_AUTH_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch {
    throw new Error("Inventory authentication is unavailable.");
  }

  if (!response.ok) {
    throw new Error("Inventory authentication failed.");
  }

  const data = (await response.json()) as InventoryAuthResponse;

  if (!data?.token || typeof data.token !== "string") {
    throw new Error("Inventory authentication failed.");
  }

  inventoryToken = data.token;
  inventoryTokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000;

  return inventoryToken;
}

function normalizeInventoryError(status: number): Error {
  if (status === 401) {
    return new Error("Inventory authentication failed.");
  }

  if (status === 403) {
    return new Error("You do not have permission to perform this inventory operation.");
  }

  if (status === 404) {
    return new Error("Inventory endpoint or product was not found.");
  }

  if (status === 400) {
    return new Error("Invalid product data.");
  }

  if (status === 409) {
    return new Error("Inventory resource conflict.");
  }

  if (status >= 500) {
    return new Error("Inventory service is currently unavailable.");
  }

  return new Error("Inventory request failed.");
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
  }
}

function validateInventoryPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) {
    throw new Error("Inventory request path is not allowed.");
  }
}

async function inventoryRequest<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = false
): Promise<T> {
  validateInventoryPath(path);
  const connection = inventoryConnectionStorage.getStore();
  const baseUrl = connection?.baseUrl ?? INVENTORY_BASE_URL;
  const requestUrl = await assertInventoryUrl(
    new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString(),
    !connection,
  );
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    throw new Error("Inventory base URL must use HTTP or HTTPS.");
  }

  const headers = new Headers(options.headers ?? {});

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const maxAttempts = connection ? 1 : (requireAuth ? 2 : 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (connection) {
      applyConnectedClientAuth(headers, connection);
    } else if (requireAuth) {
      const token = await getInventoryToken();
      headers.set("Authorization", `Bearer ${token}`);
    }

    const signal = connection
      ? AbortSignal.timeout(connection.timeoutMs ?? INVENTORY_REQUEST_TIMEOUT_MS)
      : options.signal ?? AbortSignal.timeout(INVENTORY_REQUEST_TIMEOUT_MS);
    let response: Response;
    const requestTrace = getExternalRequestTrace();
    requestTrace?.onRequestStart();
    try {
      response = await fetch(requestUrl.toString(), { ...options, headers, signal, redirect: "manual" });
    } catch (error) {
      requestTrace?.onRequestFailed(error instanceof Error ? error.message : "Connected client request failed.");
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new Error("Connected client request timed out.");
      }
      throw new Error("Inventory service is unavailable.");
    }

    try {
      const contentType = response.headers.get("content-type") ?? "";
      let payload: unknown = null;

      if (contentType.includes("application/json")) {
        payload = await response.json();
      } else if (response.status !== 204) {
        payload = await response.text();
      }

      if (response.status === 401 && requireAuth && attempt === 0) {
        inventoryToken = null;
        inventoryTokenExpiresAt = 0;
        continue;
      }

      if (!response.ok) throw normalizeInventoryError(response.status);

      if (response.status === 204) {
        requestTrace?.onRequestComplete();
        return null as T;
      }

      requestTrace?.onRequestComplete();
      return payload as T;
    } catch (error) {
      requestTrace?.onRequestFailed(error instanceof Error ? error.message : "Connected client request failed.");
      throw error;
    }
  }

  throw new Error("Inventory request failed.");
}

export async function getProducts(): Promise<InventoryProduct[]> {
  return inventoryRequest<InventoryProduct[]>("/products", { method: "GET" });
}

export async function getProduct(productId: string): Promise<InventoryProduct> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  return inventoryRequest<InventoryProduct>(`/products/${encodeURIComponent(productId)}`, { method: "GET" });
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
  }, true);
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
  }, true);
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
  }, true);
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
  }, true);
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
  }, true);
}

export async function deleteProduct(productId: string): Promise<{ message: string }> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  return inventoryRequest<{ message: string }>(`/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  }, true);
}
