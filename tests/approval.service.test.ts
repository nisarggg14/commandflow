import test from "node:test";
import assert from "node:assert/strict";

import {
  createApprovalRequest,
  computeApprovalHash,
  validateApprovalForExecution,
} from "../services/approval.service";

test("approval hash is deterministic and binds tool identity and arguments", () => {
  const args = { productId: "P1001" };
  const a = computeApprovalHash({
    toolName: "products.deleteProduct",
    requesterId: "req-1",
    companyId: "company-1",
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
    argumentsObject: args,
  });

  const b = computeApprovalHash({
    toolName: "products.deleteProduct",
    requesterId: "req-1",
    companyId: "company-1",
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
    argumentsObject: args,
  });

  assert.equal(a, b);
  assert.notEqual(a, computeApprovalHash({
    toolName: "products.deleteProduct",
    requesterId: "req-1",
    companyId: "company-1",
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
    argumentsObject: { productId: "P1002" },
  }));
});

test("createApprovalRequest rejects a client-supplied approver or company id", async () => {
  await assert.rejects(
    () =>
      createApprovalRequest({
        prisma: undefined as never,
        requesterId: "req-1",
        companyId: "company-1",
        approverId: "approver-1",
        toolName: "products.deleteProduct",
        argumentsObject: { productId: "P1001" },
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
      }),
    /server-controlled|approver|company/i
  );
});

test("validateApprovalForExecution rejects mismatched execution payload", async () => {
  const approval = {
    id: "app-1",
    status: "APPROVED",
    expiresAt: new Date(Date.now() + 60_000),
    toolName: "products.deleteProduct",
    companyId: "company-1",
    requesterId: "req-1",
    approverId: "approver-1",
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
    argumentsHash: "hash",
    executedAt: null,
    approvedAt: new Date(),
    rejectedAt: null,
  };

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval,
        toolName: "products.deleteProduct",
        requesterId: "req-1",
        companyId: "company-1",
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1002" },
        actualHash: "other-hash",
      }),
    /mismatch|hash/i
  );
});
