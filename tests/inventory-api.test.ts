import assert from "node:assert/strict";
import test, { mock } from "node:test";
import dns from "node:dns/promises";

import { isConfiguredDevelopmentLoopbackUrl } from "../lib/ssrf";

const inventoryBaseUrl = "http://localhost:5000";

test("configured loopback inventory endpoint is allowed only in development", () => {
  assert.equal(
    isConfiguredDevelopmentLoopbackUrl(
      "http://localhost:5000/auth/login",
      inventoryBaseUrl,
      "development",
    ),
    true,
  );
  assert.equal(
    isConfiguredDevelopmentLoopbackUrl(
      "http://localhost:5000/products",
      inventoryBaseUrl,
      "production",
    ),
    false,
  );
});

test("development loopback exception does not allow other origins or credentials", () => {
  assert.equal(
    isConfiguredDevelopmentLoopbackUrl(
      "http://localhost:5001/products",
      inventoryBaseUrl,
      "development",
    ),
    false,
  );
  assert.equal(
    isConfiguredDevelopmentLoopbackUrl(
      "http://localhost:5000@public.example/products",
      inventoryBaseUrl,
      "development",
    ),
    false,
  );
  assert.equal(
    isConfiguredDevelopmentLoopbackUrl(
      "https://public.example/products",
      inventoryBaseUrl,
      "development",
    ),
    false,
  );
});

test("fallback product reads use the public product route without backend login", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBaseUrl = process.env.INVENTORY_API_BASE_URL;
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.INVENTORY_API_BASE_URL = "http://localhost:5000";
  const requests: Array<{ url: string; authorization: string | null }> = [];

  try {
    const { getProducts } = await import("../services/inventory-api.service");
    globalThis.fetch = async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      return Response.json([{
        id: "db-id",
        productId: "P1",
        name: "Product",
        brand: "Brand",
        category: "General",
        description: "Product description",
        status: "active",
        variants: [{ id: "variant-id", sku: "SKU-1", color: "blue", size: "M", price: 20, stock: 4 }],
      }]);
    };
    const products = await getProducts();
    assert.equal(products.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).pathname, "/products");
    assert.equal(requests[0].authorization, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
    if (originalBaseUrl === undefined) delete process.env.INVENTORY_API_BASE_URL;
    else process.env.INVENTORY_API_BASE_URL = originalBaseUrl;
  }
});

test("connected-client credentials remain attached to public product reads", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "test");
  const dnsLookupMock = mock.method(dns, "lookup", async () => [
    { address: "203.0.113.10", family: 4 },
  ]);
  let requestedAuthorization: string | null = null;

  try {
    const { getProducts, runWithInventoryApiConnection } = await import("../services/inventory-api.service");
    globalThis.fetch = async (_input, init) => {
      requestedAuthorization = new Headers(init?.headers).get("Authorization");
      return Response.json([]);
    };
    const products = await runWithInventoryApiConnection({
      baseUrl: "https://inventory.example.com/api",
      authType: "BEARER",
      authConfig: { token: "test-token" },
    }, getProducts);

    assert.deepEqual(products, []);
    assert.equal(requestedAuthorization, "Bearer test-token");
  } finally {
    globalThis.fetch = originalFetch;
    dnsLookupMock.mock.restore();
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
});
