import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultTools } from "../mcp/tools";
import { createChangeRoleTool } from "../mcp/tools/users/changeRole";
import { RiskLevel } from "../mcp/types";

test("registered HIGH-risk tool inventory keeps approval and MFA metadata intact", () => {
  const tools = createDefaultTools().filter((tool) => tool.riskLevel === RiskLevel.HIGH);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const expected = [
    "products.deleteProduct",
    "users.changeRole",
    "users.disableUser",
    "frontend.updateBranding",
    "orders.cancelOrder",
  ];

  assert.deepEqual(tools.map((tool) => tool.name), expected);
  for (const name of expected) {
    const tool = byName.get(name);
    assert.equal(tool?.riskLevel, RiskLevel.HIGH);
    assert.equal(tool?.requiresMfaStepUp, true);
    assert.equal(typeof tool?.mfaPurpose, "string");
  }
});

test("users.changeRole does not report a missing target as successful", async () => {
  const tool = createChangeRoleTool();
  const context = {
    userId: "admin-1",
    companyId: "company-1",
    role: "ADMIN",
    prisma: {
      user: {
        updateMany: async () => ({ count: 0 }),
      },
    },
  } as never;

  await assert.rejects(
    async () => tool.execute({ userId: "missing-user", role: "MANAGER" }, context),
    /not found|already set/i,
  );
});
