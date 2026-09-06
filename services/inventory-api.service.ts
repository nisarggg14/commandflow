type InventoryRole = "admin" | "manager" | "viewer";

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

const INVENTORY_BASE_URL = (process.env.INVENTORY_API_BASE_URL ?? "http://localhost:5000").replace(/\/+$/, "");

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

  const response = await fetch(`${INVENTORY_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      password,
    }),
  });

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

function normalizeInventoryError(status: number, payload?: unknown): Error {
  if (status === 401) {
    return new Error("Inventory authentication failed.");
  }

  if (status === 403) {
    return new Error("You do not have permission to perform this inventory operation.");
  }

  if (status === 404) {
    return new Error("Product not found.");
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

  if (payload && typeof payload === "object") {
    const maybeMessage = "message" in payload ? payload.message : undefined;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return new Error(maybeMessage);
    }
  }

  return new Error("Inventory request failed.");
}

async function inventoryRequest<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = false
): Promise<T> {
  const requestUrl = new URL(path, `${INVENTORY_BASE_URL}/`);

  const headers = new Headers(options.headers ?? {});

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (requireAuth) {
    const token = await getInventoryToken();
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(requestUrl.toString(), {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") ?? "";

  let payload: unknown = null;

  if (contentType.includes("application/json")) {
    payload = await response.json();
  } else if (response.status !== 204) {
    payload = await response.text();
  }

  if (!response.ok) {
    throw normalizeInventoryError(response.status, payload);
  }

  if (response.status === 204) {
    return null as T;
  }

  return payload as T;
}

export async function getProducts(): Promise<InventoryProduct[]> {
  return inventoryRequest<InventoryProduct[]>("/products", { method: "GET" }, false);
}

export async function getProduct(productId: string): Promise<InventoryProduct> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  return inventoryRequest<InventoryProduct>(`/products/${encodeURIComponent(productId)}`, { method: "GET" }, false);
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

export async function deleteProduct(productId: string): Promise<{ message: string }> {
  if (!productId || !productId.trim()) {
    throw new Error("Product ID is required.");
  }

  return inventoryRequest<{ message: string }>(`/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  }, true);
}
