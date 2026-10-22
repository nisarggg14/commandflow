import test, { mock } from "node:test";
import dns from "node:dns/promises";
import assert from "node:assert/strict";
import { encryptSecret } from "../lib/mfa";
import { getConnectedClientToolNames, withAuthenticatedConnectedClient } from "../services/mcp-connector.service";
import { getProduct } from "../services/inventory-api.service";
import { CLIENT_TOOL_NAMES } from "../mcp/client-tool-policy";

process.env.MFA_ENCRYPTION_KEY ??= "test-mcp-connector-encryption-key-32-bytes";

function fakeContext(db: unknown, connectedClientId = "client-1") {
  return { companyId: "company-1", connectedClientId, prisma: db as never };
}

test("connected-client tool policy parses the JSON persisted by registration and updates", async () => {
  let query: unknown;
  const db = {
    connectedClient: {
      findFirst: async (args: unknown) => {
        query = args;
        return { enabledTools: JSON.stringify(["products.getProducts", "orders.getOrders"]) };
      },
    },
  };

  const enabledTools = await getConnectedClientToolNames("client-1", "company-1", db as never);

  assert.deepEqual(enabledTools, ["products.getProducts", "orders.getOrders"]);
  assert.deepEqual(query, {
    where: { id: "client-1", companyId: "company-1", status: "ACTIVE" },
    select: { enabledTools: true },
  });
});

test("connected-client tool policy preserves null defaults and rejects malformed persisted lists", async () => {
  const nullConfigDb = {
    connectedClient: {
      findFirst: async () => ({ enabledTools: null }),
    },
  };
  assert.deepEqual(
    await getConnectedClientToolNames("client-1", "company-1", nullConfigDb as never),
    [...CLIENT_TOOL_NAMES],
  );

  for (const enabledTools of [
    '{"products.getProducts":true}',
    JSON.stringify(["products.getProducts", "arbitrary.execute"]),
    "not-json",
  ]) {
    const invalidConfigDb = {
      connectedClient: {
        findFirst: async () => ({ enabledTools }),
      },
    };
    await assert.rejects(
      () => getConnectedClientToolNames("client-1", "company-1", invalidConfigDb as never),
      /Connected client tool configuration is invalid/,
    );
  }
});

test("MCP connector derives base URL and Authorization from the selected client", async () => {
  const originalFetch = globalThis.fetch;
  const dnsLookupMock = mock.method(dns, "lookup", async () => [
    { address: "203.0.113.10", family: 4 },
  ]);
  let requestedUrl = "";
  let requestedAuthorization = "";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
    return Response.json({
      productId: "P1", name: "Product", brand: "Brand", category: "General", description: "Product",
      status: "active", variants: [],
    });
  };

  try {
    const db = {
      connectedClient: {
        findFirst: async () => ({
          baseUrl: "https://inventory.example.com/api",
          authType: "BEARER",
          authConfig: encryptSecret(JSON.stringify({ token: "connector-secret" })),
        }),
      },
    };
    const product = await withAuthenticatedConnectedClient(fakeContext(db), () => getProduct("P1"));
    assert.equal(product.productId, "P1");
    assert.equal(requestedUrl, "https://inventory.example.com/api/products/P1");
    assert.equal(requestedAuthorization, "Bearer connector-secret");
  } finally {
    globalThis.fetch = originalFetch;
    dnsLookupMock.mock.restore();
  }
});

test("MCP connector refuses to send stored credentials to an HTTP endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({});
  };

  try {
    const db = {
      connectedClient: {
        findFirst: async () => ({
          baseUrl: "http://inventory.example.com/api",
          authType: "BEARER",
          authConfig: encryptSecret(JSON.stringify({ token: "connector-secret" })),
        }),
      },
    };

    await assert.rejects(
      () => withAuthenticatedConnectedClient(fakeContext(db), () => getProduct("P1")),
      /must use HTTPS/i,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MCP connector enforces company/status selection and rejects unsafe base URLs", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({});
  };

  try {
    const missingClientDb = { connectedClient: { findFirst: async () => null } };
    await assert.rejects(
      () => withAuthenticatedConnectedClient(fakeContext(missingClientDb), getProduct.bind(null, "P1")),
      /unavailable/i,
    );

    const unsafeUrlDb = {
      connectedClient: {
        findFirst: async () => ({ baseUrl: "file:///etc/secrets", authType: "NONE", authConfig: null }),
      },
    };
    await assert.rejects(
      () => withAuthenticatedConnectedClient(fakeContext(unsafeUrlDb), getProduct.bind(null, "P1")),
      /not allowed/i,
    );

    const privateUrlDb = {
      connectedClient: {
        findFirst: async () => ({ baseUrl: "http://127.0.0.1:8080", authType: "NONE", authConfig: null }),
      },
    };
    await assert.rejects(
      () => withAuthenticatedConnectedClient(fakeContext(privateUrlDb), getProduct.bind(null, "P1")),
      /not allowed/i,
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
