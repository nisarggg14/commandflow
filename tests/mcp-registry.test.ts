import test from "node:test";
import assert from "node:assert/strict";
import { createToolsForClient } from "../mcp/tools";
import { normalizeEnabledToolNames } from "../mcp/client-tool-policy";

test("client registry exposes only server-approved enabled tools", () => {
  const tools = createToolsForClient(["products.getProducts", "frontend.updateTheme"]);
  assert.deepEqual(tools.map((tool) => tool.name), ["products.getProducts", "frontend.updateTheme"]);
  assert.equal(tools.some((tool) => tool.name === "products.deleteProduct"), false);
  assert.equal(tools.every((tool) => tool.permissions.length > 0 && tool.riskLevel), true);
});

test("unknown client tool names are rejected", () => {
  assert.throws(() => normalizeEnabledToolNames(["products.getProducts", "arbitrary.execute"]), /unsupported MCP tool/i);
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
