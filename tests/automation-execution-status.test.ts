import assert from "node:assert/strict";
import test from "node:test";

import { getAutomationExecutionStatus } from "../lib/execution-status";

test("automation execution keeps pending approval distinct from success and failure", () => {
  assert.equal(getAutomationExecutionStatus({ success: false, outcome: "APPROVAL_REQUIRED" }), "PENDING_APPROVAL");
  assert.equal(getAutomationExecutionStatus({ success: true }), "SUCCEEDED");
  assert.equal(getAutomationExecutionStatus({ success: false }), "FAILED");
});
