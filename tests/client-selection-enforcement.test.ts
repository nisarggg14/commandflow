import assert from "node:assert/strict";
import test, { mock } from "node:test";
import dns from "node:dns/promises";

import { chatRequestSchema } from "../validators/chat.validator";
import { CommandFlowMCPServer } from "../mcp/server";
import { createGetProductsTool } from "../mcp/tools/products/getProducts";
import { createGetThemeTool } from "../mcp/tools/ui/getTheme";
import { Permission } from "../mcp/types";
import { toolRequiresConnectedClient } from "../mcp/client-tool-policy";
import { getOrders } from "../services/order-api.service";

function createServer(options: {
  connectedClientId?: string;
  client: Record<string, unknown> | null;
  onQuery?: (args: unknown) => void;
}) {
  const db = {
    connectedClient: {
      findFirst: async (args: unknown) => {
        options.onQuery?.(args);
        return options.client;
      },
    },
  };
  const server = new CommandFlowMCPServer({
    userId: "user-1",
    companyId: "company-1",
    role: Permission.VIEWER,
    requestId: "request-1",
    timestamp: new Date().toISOString(),
    connectedClientId: options.connectedClientId,
    prisma: db,
    logger: () => undefined,
  } as never);
  server.registerTools([createGetProductsTool(), createGetThemeTool()]);
  return server;
}

test("chat requests explicitly carry a selected client or explicit null", () => {
  assert.throws(() => chatRequestSchema.parse({
    conversationId: "conversation-1",
    message: "Show products",
  }));
  assert.equal(chatRequestSchema.parse({
    conversationId: "conversation-1",
    message: "Show products",
    connectedClientId: null,
  }).connectedClientId, null);
  assert.equal(chatRequestSchema.parse({
    conversationId: "conversation-1",
    message: "Show products",
    connectedClientId: "client-1",
  }).connectedClientId, "client-1");
});

test("products.getProducts fails without a client and does not make a request", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json([]);
  };

  try {
    const server = createServer({ client: null });
    const result = await server.executeTool("products.getProducts", {});
    assert.equal(result.success, false);
    assert.equal(result.message, "Select a target client before running this tool.");
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("products.getProducts uses the explicitly selected active company client", async () => {
  const originalFetch = globalThis.fetch;
  const dnsLookupMock = mock.method(dns, "lookup", async () => [
    { address: "203.0.113.10", family: 4 },
  ]);
  const queries: Array<{ where: Record<string, unknown> }> = [];
  const requestedUrls: string[] = [];
  const product = {
    productId: "P-1",
    name: "Jacket",
    brand: "Example",
    category: "Clothing",
    description: "A jacket",
    status: "active",
    variants: [],
  };
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return Response.json([product]);
  };

  try {
    const server = createServer({
      connectedClientId: "client-1",
      client: {
        id: "client-1",
        baseUrl: "https://inventory.example.com",
        authType: "NONE",
        authConfig: null,
      },
      onQuery: (args) => queries.push(args as { where: Record<string, unknown> }),
    });
    const result = await server.executeTool("products.getProducts", {});

    assert.equal(result.success, true);
    assert.deepEqual(result.data, [product]);
    assert.deepEqual(requestedUrls, ["https://inventory.example.com/products"]);
    assert.ok(queries.length >= 2);
    assert.ok(queries.every(({ where }) => (
      where.id === "client-1" &&
      where.companyId === "company-1" &&
      where.status === "ACTIVE"
    )));
  } finally {
    globalThis.fetch = originalFetch;
    dnsLookupMock.mock.restore();
  }
});

test("inactive and cross-company client selections are rejected before fetching", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  const queries: Array<{ where: Record<string, unknown> }> = [];
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json([]);
  };

  try {
    for (const scenario of [
      { name: "inactive client", id: "inactive-client" },
      { name: "other company's client", id: "foreign-client" },
    ]) {
      await t.test(scenario.name, async () => {
        queries.length = 0;
        const server = createServer({
          connectedClientId: scenario.id,
          client: null,
          onQuery: (args) => queries.push(args as { where: Record<string, unknown> }),
        });
        const result = await server.executeTool("products.getProducts", {});

        assert.equal(result.success, false);
        assert.equal(result.message, "Selected connected client is unavailable.");
        assert.deepEqual(queries, [{
          where: { id: scenario.id, companyId: "company-1", status: "ACTIVE" },
          select: { id: true },
        }]);
        assert.equal(requestCount, 0);
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client-independent tools remain available with no client selected", async () => {
  const server = createServer({ client: null });
  const result = await server.executeTool("ui.getTheme", {});

  assert.equal(result.success, true);
  assert.deepEqual(result.data, { type: "ui-control", action: "getTheme" });
  assert.equal(toolRequiresConnectedClient("ui.getTheme"), false);
  assert.equal(toolRequiresConnectedClient("products.getProducts"), true);
  assert.equal(toolRequiresConnectedClient("orders.getOrders"), true);
});

test("orders adapter does not fall back to a default host without a selected client", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json([]);
  };

  try {
    await assert.rejects(
      () => getOrders(),
      /Select a target client before running this tool/,
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
