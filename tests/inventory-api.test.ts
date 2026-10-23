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

test("product reads do not use an implicit fallback when no client is selected", async () => {
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
    await assert.rejects(
      () => getProducts(),
      (error: unknown) => error instanceof Error &&
        error.message === "Select a target client before running this tool.",
    );
    assert.equal(requests.length, 0);
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
    const { getProducts, InventoryApiError, runWithInventoryApiConnection } = await import("../services/inventory-api.service");
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

test("configured localhost Inventory Backend is reachable through a connected client in development", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBaseUrl = process.env.INVENTORY_API_BASE_URL;
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.INVENTORY_API_BASE_URL = inventoryBaseUrl;
  const dnsLookupMock = mock.method(dns, "lookup", async () => {
    throw new Error("Configured loopback URL must bypass public-address DNS validation.");
  });
  const requestedUrls: string[] = [];

  try {
    const { getProducts, InventoryApiError, runWithInventoryApiConnection } = await import("../services/inventory-api.service");
    globalThis.fetch = async (input) => {
      requestedUrls.push(String(input));
      return Response.json([]);
    };

    const products = await runWithInventoryApiConnection({
      baseUrl: inventoryBaseUrl,
      authType: "NONE",
      authConfig: {},
    }, getProducts);

    assert.deepEqual(products, []);
    assert.deepEqual(requestedUrls, ["http://localhost:5000/products"]);
  } finally {
    globalThis.fetch = originalFetch;
    dnsLookupMock.mock.restore();
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
    if (originalBaseUrl === undefined) delete process.env.INVENTORY_API_BASE_URL;
    else process.env.INVENTORY_API_BASE_URL = originalBaseUrl;
  }
});

test("production never allows a connected-client loopback exception", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const dnsLookupMock = mock.method(dns, "lookup", async () => [
    { address: "127.0.0.1", family: 4 },
  ]);
  let fetchCalled = false;
  Reflect.set(process.env, "NODE_ENV", "production");

  try {
    const { getProducts, InventoryApiError, runWithInventoryApiConnection } = await import("../services/inventory-api.service");
    globalThis.fetch = async () => {
      fetchCalled = true;
      return Response.json([]);
    };

    await assert.rejects(
      () => runWithInventoryApiConnection({
        baseUrl: inventoryBaseUrl,
        authType: "NONE",
        authConfig: {},
      }, getProducts),
      (error: unknown) => error instanceof InventoryApiError &&
        error.category === "validation" &&
        error.stage === "url_validation",
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    dnsLookupMock.mock.restore();
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
});

test("Inventory failures retain safe categories for DNS, connection, timeout, and HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBaseUrl = process.env.INVENTORY_API_BASE_URL;
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.INVENTORY_API_BASE_URL = inventoryBaseUrl;

  try {
    const { getProducts, InventoryApiError, runWithInventoryApiConnection } = await import("../services/inventory-api.service");
    const readProducts = () => runWithInventoryApiConnection({
      baseUrl: inventoryBaseUrl,
      authType: "NONE",
      authConfig: {},
    }, getProducts);
    const failures: Array<{ error: Error; category: string }> = [
      {
        error: Object.assign(new Error("fetch failed"), {
          cause: Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" }),
        }),
        category: "dns",
      },
      {
        error: Object.assign(new Error("fetch failed"), {
          cause: Object.assign(new Error("connection failed"), { code: "ECONNREFUSED" }),
        }),
        category: "connection_refused",
      },
      {
        error: new DOMException("request timed out", "TimeoutError"),
        category: "timeout",
      },
    ];

    for (const failure of failures) {
      globalThis.fetch = async () => { throw failure.error; };
      await assert.rejects(
        readProducts,
        (error: unknown) => error instanceof InventoryApiError && error.category === failure.category,
      );
    }

    globalThis.fetch = async () => Response.json({ internal: "not exposed" }, { status: 503 });
    await assert.rejects(
      readProducts,
      (error: unknown) => error instanceof InventoryApiError &&
        error.category === "service_unavailable" &&
        error.httpStatus === 503 &&
        error.message === "Inventory service is currently unavailable.",
    );

    globalThis.fetch = async () => Response.json({ internal: "not exposed" }, { status: 401 });
    await assert.rejects(
      readProducts,
      (error: unknown) => error instanceof InventoryApiError &&
        error.category === "authentication" &&
        error.httpStatus === 401 &&
        error.message === "Inventory authentication failed.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.INVENTORY_API_BASE_URL;
    else process.env.INVENTORY_API_BASE_URL = originalBaseUrl;
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
});

test("product reads reject malformed backend payloads rather than reporting empty success", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBaseUrl = process.env.INVENTORY_API_BASE_URL;
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.INVENTORY_API_BASE_URL = inventoryBaseUrl;

  try {
    const { getProducts, InventoryApiError, runWithInventoryApiConnection } = await import("../services/inventory-api.service");
    globalThis.fetch = async () => Response.json({ products: [] });
    await assert.rejects(
      () => runWithInventoryApiConnection({
        baseUrl: inventoryBaseUrl,
        authType: "NONE",
        authConfig: {},
      }, getProducts),
      (error: unknown) => error instanceof InventoryApiError && error.category === "malformed_response",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.INVENTORY_API_BASE_URL;
    else process.env.INVENTORY_API_BASE_URL = originalBaseUrl;
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
});

test("connected Inventory Backend login uses its real username/password contract and reads products with Bearer token", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBaseUrl = process.env.INVENTORY_API_BASE_URL;
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.INVENTORY_API_BASE_URL = inventoryBaseUrl;
  const requests: Array<{ url: string; method: string; authorization: string | null; body?: string; redirect?: RequestRedirect }> = [];
  const product = {
    productId: "P1",
    name: "Product",
    brand: "Brand",
    category: "General",
    description: "Product description",
    status: "active",
    variants: [{ sku: "SKU-1", color: "blue", size: "M", price: 20, stock: 4 }],
  };

  try {
    const { testInventoryApiConnection } = await import("../services/inventory-api.service");
    globalThis.fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("Authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
        redirect: init?.redirect,
      });
      return String(input).endsWith("/auth/login")
        ? Response.json({ token: "backend-jwt", role: "admin", username: "backend-admin" })
        : Response.json([product]);
    };

    const result = await testInventoryApiConnection(inventoryBaseUrl, {
      username: "backend-admin",
      password: "external-password",
    });

    assert.deepEqual(result, { productCount: 1 });
    assert.equal(new URL(requests[0].url).pathname, "/auth/login");
    assert.equal(requests[0].method, "POST");
    assert.deepEqual(JSON.parse(requests[0].body ?? "{}"), {
      username: "backend-admin",
      password: "external-password",
    });
    assert.equal(requests[0].redirect, "manual");
    assert.equal(new URL(requests[1].url).pathname, "/products");
    assert.equal(requests[1].method, "GET");
    assert.equal(requests[1].authorization, "Bearer backend-jwt");
    assert.equal(requests[1].redirect, "manual");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
    if (originalBaseUrl === undefined) delete process.env.INVENTORY_API_BASE_URL;
    else process.env.INVENTORY_API_BASE_URL = originalBaseUrl;
  }
});

test("connected Inventory Backend rejects invalid external credentials with a sanitized error", async () => {
  const originalFetch = globalThis.fetch;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBaseUrl = process.env.INVENTORY_API_BASE_URL;
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.INVENTORY_API_BASE_URL = inventoryBaseUrl;

  try {
    const { testInventoryApiConnection, InventoryApiError } = await import("../services/inventory-api.service");
    globalThis.fetch = async () => Response.json({ message: "do not expose response body" }, { status: 401 });
    await assert.rejects(
      () => testInventoryApiConnection(inventoryBaseUrl, { username: "wrong-user", password: "wrong-password" }),
      (error: unknown) => error instanceof InventoryApiError &&
        error.category === "authentication" &&
        error.stage === "login" &&
        typeof error.elapsedMs === "number" &&
        !error.message.includes("wrong-password"),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
    if (originalBaseUrl === undefined) delete process.env.INVENTORY_API_BASE_URL;
    else process.env.INVENTORY_API_BASE_URL = originalBaseUrl;
  }
});

test("connected Inventory Backend bounds DNS validation and reports its diagnostic stage", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "test");
  const dnsLookupMock = mock.method(dns, "lookup", () => new Promise(() => {}));

  try {
    const { testInventoryApiConnection, InventoryApiError } = await import("../services/inventory-api.service");
    const startedAt = Date.now();
    await assert.rejects(
      () => testInventoryApiConnection("https://inventory.example.com", {
        username: "external-admin",
        password: "external-password",
      }),
      (error: unknown) => error instanceof InventoryApiError &&
        error.category === "timeout" &&
        error.stage === "url_validation" &&
        typeof error.elapsedMs === "number" &&
        error.elapsedMs >= 1_900 &&
        error.elapsedMs < 3_000 &&
        !error.message.includes("external-password"),
    );
    assert.ok(Date.now() - startedAt < 3_000);
  } finally {
    dnsLookupMock.mock.restore();
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
});
