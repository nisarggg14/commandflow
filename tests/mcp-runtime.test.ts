import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import { CommandFlowMCPServer } from "../mcp/server";
import { createDefaultTools } from "../mcp/tools";
import { Permission, type MCPContext } from "../mcp/types";
import { isGeminiQuotaError } from "../services/llm.service";
import { getSuggestionsForRole } from "../components/empty-state";
import { sanitizeCommand } from "../services/command-parser.service";

function createTestServer(role: Permission) {
  const context: MCPContext = {
    userId: "test-user",
    companyId: "test-company",
    role,
    requestId: "test-request",
    timestamp: new Date().toISOString(),
    prisma: {} as PrismaClient,
    logger: () => undefined,
  };

  const server = new CommandFlowMCPServer(context);
  server.registerTools(createDefaultTools());
  return server;
}

test("viewer receives product and analytics tools but not mutations", () => {
  const names = createTestServer(Permission.VIEWER).listTools().map((tool) => tool.name);

  assert.ok(names.includes("products.getProducts"));
  assert.ok(names.includes("products.getProduct"));
  assert.ok(names.includes("products.searchProducts"));
  assert.ok(names.includes("analytics.inventorySummary"));
  assert.ok(names.includes("analytics.lowStockReport"));
  assert.ok(!names.includes("products.createProduct"));
  assert.ok(!names.includes("products.updateStock"));
  assert.ok(!names.includes("products.adjustPrice"));
  assert.ok(!names.includes("products.deleteProduct"));
});

test("viewer mutation execution is denied by MCP authorization", () => {
  const server = createTestServer(Permission.VIEWER);
  const createProduct = createDefaultTools().find((tool) => tool.name === "products.createProduct");

  assert.ok(createProduct);
  assert.throws(() => server.authorize(createProduct), /does not have permission/i);
});

test("orders are not exposed and price changes are medium risk without step-up MFA", () => {
  const tools = createDefaultTools();
  const names = tools.map((tool) => tool.name);
  const adjustPrice = tools.find((tool) => tool.name === "products.adjustPrice");
  const updateStock = tools.find((tool) => tool.name === "products.updateStock");

  assert.ok(!names.some((name) => name.startsWith("orders.")));
  assert.equal(adjustPrice?.riskLevel, "MEDIUM");
  assert.equal(adjustPrice?.requiresMfaStepUp, false);
  assert.equal(adjustPrice?.mfaPurpose, "products.adjustPrice");
  assert.equal(updateStock?.riskLevel, "MEDIUM");
  assert.equal(updateStock?.requiresMfaStepUp, false);
});

test("user queries omit password and MFA secrets", async () => {
  const getUsersTool = createDefaultTools().find((tool) => tool.name === "users.getUsers");
  assert.ok(getUsersTool);

  const result = await getUsersTool.execute({ limit: 10, offset: 0 }, {
    userId: "u1",
    companyId: "c1",
    role: Permission.ADMIN,
    requestId: "r1",
    timestamp: new Date().toISOString(),
    prisma: {
      user: {
        findMany: async () => [{
          id: "u1",
          name: "Admin",
          email: "admin@example.com",
          role: "ADMIN",
          password: "$2b$10$hash",
          mfaEnabled: true,
          mfaSecret: "secret",
          companyId: "c1",
        }],
      },
    } as any,
    logger: () => undefined,
  });

  assert.ok(Array.isArray(result));
  assert.ok(!Object.prototype.hasOwnProperty.call(result[0], "password"));
  assert.ok(!Object.prototype.hasOwnProperty.call(result[0], "mfaSecret"));
  assert.equal(result[0].email, "admin@example.com");
});

test("UI tools use strict allowlists", () => {
  const tools = createDefaultTools();
  const getTool = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    return tool;
  };

  assert.equal(getTool("ui.setTheme").inputSchema.safeParse({ theme: "dark" }).success, true);
  assert.equal(getTool("ui.setTheme").inputSchema.safeParse({ theme: "neon" }).success, false);
  assert.equal(getTool("ui.setBackground").inputSchema.safeParse({ background: "paper" }).success, true);
  assert.equal(getTool("ui.setBackground").inputSchema.safeParse({ background: "url(javascript:alert(1))" }).success, false);
  assert.equal(getTool("ui.setAccentColor").inputSchema.safeParse({ accent: "sky" }).success, true);
  assert.equal(getTool("ui.setAccentColor").inputSchema.safeParse({ accent: "#fff" }).success, false);
});

test("parser preserves exact UI accent arguments", () => {
  const tool = createDefaultTools().find((candidate) => candidate.name === "ui.setAccentColor");
  assert.ok(tool);

  const command = sanitizeCommand(JSON.stringify({
    tool: "ui.setAccentColor",
    arguments: { accent: "sky" },
  }));

  assert.deepEqual(command.arguments, { accent: "sky" });
  assert.equal(tool.inputSchema.safeParse(command.arguments).success, true);
});

test("parser does not alias invalid accent property names", () => {
  const tool = createDefaultTools().find((candidate) => candidate.name === "ui.setAccentColor");
  assert.ok(tool);

  const command = sanitizeCommand(JSON.stringify({
    tool: "ui.setAccentColor",
    arguments: { color: "sky" },
  }));

  assert.deepEqual(command.arguments, { color: "sky" });
  assert.equal(tool.inputSchema.safeParse(command.arguments).success, false);
});

test("parser normalizes parameters into arguments", () => {
  const tool = createDefaultTools().find((candidate) => candidate.name === "ui.setAccentColor");
  assert.ok(tool);

  const command = sanitizeCommand(JSON.stringify({
    tool: "ui.setAccentColor",
    parameters: { accent: "sky" },
  }));

  assert.deepEqual(command.arguments, { accent: "sky" });
  assert.equal(tool.inputSchema.safeParse(command.arguments).success, true);
});

test("malformed arguments are not replaced by parameters", () => {
  const command = sanitizeCommand(JSON.stringify({
    tool: "ui.setAccentColor",
    arguments: "sky",
    parameters: { accent: "sky" },
  }));

  assert.equal(command.action, "unknown");
});

test("invalid accent values remain rejected by MCP schema validation", () => {
  const tool = createDefaultTools().find((candidate) => candidate.name === "ui.setAccentColor");
  assert.ok(tool);

  const command = sanitizeCommand(JSON.stringify({
    tool: "ui.setAccentColor",
    arguments: { accent: "red" },
  }));

  assert.equal(tool.inputSchema.safeParse(command.arguments).success, false);
});

test("Gemini quota errors are classified without exposing provider details", () => {
  assert.equal(isGeminiQuotaError({ status: 429, message: "RESOURCE_EXHAUSTED" }), true);
  assert.equal(isGeminiQuotaError(new Error("invalid prompt")), false);
});

test("frontend suggestions follow the role model", () => {
  assert.deepEqual(getSuggestionsForRole("VIEWER"), [
    "Show products",
    "Show inventory summary",
    "List applications",
    "Switch to dark mode",
  ]);
  assert.ok(getSuggestionsForRole("MANAGER").includes("Update stock"));
  assert.ok(!getSuggestionsForRole("MANAGER").includes("Disable employee"));
  assert.ok(getSuggestionsForRole("ADMIN").includes("Disable employee"));
  assert.ok(!getSuggestionsForRole("VIEWER").some((suggestion) => /orders/i.test(suggestion)));
});
