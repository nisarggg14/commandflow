import assert from "node:assert/strict";
import test from "node:test";
import { getExecutionStatus } from "../lib/execution-status";

test("high-risk approval-required results remain pending instead of failed", () => {
  assert.equal(getExecutionStatus({ success: false, outcome: "APPROVAL_REQUIRED" }), "PENDING_APPROVAL");
  assert.equal(getExecutionStatus({ success: false }), "FAILED");
  assert.equal(getExecutionStatus({ success: true }), "SUCCESS");
});
