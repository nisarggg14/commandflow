import assert from "node:assert/strict";
import test from "node:test";
import { getApprovalHref } from "@/lib/approval-navigation";

test("approval navigation preserves a valid approval ID", () => {
  assert.equal(getApprovalHref("approval-123"), "/admin/approvals?id=approval-123");
  assert.equal(getApprovalHref(" approval/123 "), "/admin/approvals?id=approval%2F123");
});

test("approval navigation rejects missing or malformed IDs", () => {
  assert.equal(getApprovalHref(undefined), null);
  assert.equal(getApprovalHref(null), null);
  assert.equal(getApprovalHref("   "), null);
  assert.equal(getApprovalHref("x".repeat(201)), null);
});
