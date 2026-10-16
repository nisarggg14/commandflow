import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeCommand } from "../services/command-parser.service";

test("malformed model JSON is reduced to the non-executable unknown action", () => {
  assert.deepEqual(sanitizeCommand("{not valid JSON"), { action: "unknown" });
});

test("tool selections with invalid or conflicting action fields are rejected", () => {
  assert.deepEqual(
    sanitizeCommand(JSON.stringify({
      tool: "products.deleteProduct",
      arguments: { productId: "P1001" },
      action: "unknown",
    })),
    { action: "unknown" },
  );
  assert.deepEqual(
    sanitizeCommand(JSON.stringify({ tool: "products.getProducts", arguments: {}, action: "execute" })),
    { action: "unknown" },
  );
});

test("model output cannot hide extra top-level fields alongside a tool selection", () => {
  assert.deepEqual(
    sanitizeCommand(JSON.stringify({
      tool: "products.getProducts",
      arguments: {},
      companyId: "another-company",
    })),
    { action: "unknown" },
  );
});

test("unknown actions must not carry extra model-controlled fields", () => {
  assert.deepEqual(
    sanitizeCommand(JSON.stringify({ action: "unknown", arguments: { tool: "users.disableUser" } })),
    { action: "unknown" },
  );
});
