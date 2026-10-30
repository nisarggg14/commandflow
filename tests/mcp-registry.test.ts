import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultTools, createToolsForClient } from "../mcp/tools";
import { normalizeEnabledToolNames } from "../mcp/client-tool-policy";

test("the default registry defines each existing tool name exactly once", () => {
  const tools = createDefaultTools();
  const names = tools.map((tool) => tool.name);
  assert.equal(names.length, 33);
  assert.equal(new Set(names).size, names.length);
});

test("client registry exposes only server-approved enabled tools", () => {
  const tools = createToolsForClient(["products.getProducts", "frontend.updateTheme"]);
  assert.deepEqual(tools.map((tool) => tool.name), ["products.getProducts", "frontend.updateTheme"]);
  assert.equal(tools.some((tool) => tool.name === "products.deleteProduct"), false);
  assert.equal(tools.every((tool) => tool.permissions.length > 0 && tool.riskLevel), true);
});

test("unknown client tool names are rejected", () => {
  assert.throws(() => normalizeEnabledToolNames(["products.getProducts", "arbitrary.execute"]), /unsupported MCP tool/i);
});

test("products.getProducts is allowlisted and validates its optional pagination schema", () => {
  const [tool] = createToolsForClient(["products.getProducts"]);
  assert.equal(tool?.name, "products.getProducts");
  assert.equal(tool?.inputSchema.safeParse({}).success, true);
  assert.equal(tool?.inputSchema.safeParse({ limit: 100, offset: 0 }).success, true);
  assert.equal(tool?.inputSchema.safeParse({ limit: 101 }).success, false);
  assert.equal(tool?.inputSchema.safeParse({ offset: -1 }).success, false);
});

test("frontend schemas remain allowlisted and branding is high risk", () => {
  const tools = createToolsForClient([
    "frontend.updateBackground",
    "frontend.updateTheme",
    "frontend.updateNavbar",
    "frontend.updateBranding",
  ]);
  const background = tools.find((tool) => tool.name === "frontend.updateBackground");
  const navbar = tools.find((tool) => tool.name === "frontend.updateNavbar");
  const branding = tools.find((tool) => tool.name === "frontend.updateBranding");
  assert.equal(background?.inputSchema.safeParse({ background: "paper" }).success, true);
  assert.equal(background?.inputSchema.safeParse({ background: "url(https://evil.example)" }).success, false);
  assert.equal(navbar?.inputSchema.safeParse({ density: "compact", showCompanyName: true, script: "alert(1)" }).success, false);
  assert.equal(branding?.riskLevel, "HIGH");
  assert.equal(branding?.inputSchema.safeParse({ accent: "sky", mark: "inventory", logoUrl: "https://evil.example" }).success, false);
});
