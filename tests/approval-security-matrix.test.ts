import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma";
import { createCommandServer } from "../services/tool.service";
import { Permission } from "../mcp/types";
import {
  createApprovalRequest,
  approveApproval,
  cancelApproval,
  rejectApproval,
  validateApprovalForExecution,
  markApprovalExecuted,
  computeApprovalHash,
} from "../services/approval.service";
import { createChallengeToken, verifyTotpCode, createTotpSecret, validateAndConsumeMfaChallenge, decryptSecret } from "../lib/mfa";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { ApprovalStatus } from "@prisma/client";
import { NextRequest } from "next/server";
import { GET as getApprovalsRoute } from "../app/api/approvals/route";

async function createUserSet() {
  const companyName = `Security Test ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  const company = await prisma.company.create({
    data: {
      name: companyName,
      normalizedName: companyName.trim().toLowerCase(),
      slug: `security-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });

  const admin = await prisma.user.create({
    data: {
      name: "Admin User",
      email: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: "hashed-password",
      role: "ADMIN",
      companyId: company.id,
      mfaEnabled: true,
      mfaSecret: encryptForTest(createTotpSecret()),
    },
  });

  const requester = await prisma.user.create({
    data: {
      name: "Requester User",
      email: `requester-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: "hashed-password",
      role: "ADMIN",
      companyId: company.id,
      mfaEnabled: true,
      mfaSecret: encryptForTest(createTotpSecret()),
    },
  });

  const manager = await prisma.user.create({
    data: {
      name: "Manager User",
      email: `manager-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: "hashed-password",
      role: "MANAGER",
      companyId: company.id,
      mfaEnabled: false,
    },
  });

  const viewer = await prisma.user.create({
    data: {
      name: "Viewer User",
      email: `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: "hashed-password",
      role: "VIEWER",
      companyId: company.id,
      mfaEnabled: false,
    },
  });

  const otherCompanyName = `Other Company ${Date.now()}`;
  const otherCompany = await prisma.company.create({
    data: {
      name: otherCompanyName,
      normalizedName: otherCompanyName.trim().toLowerCase(),
      slug: `other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });

  const foreignAdmin = await prisma.user.create({
    data: {
      name: "Foreign Admin",
      email: `foreign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: "hashed-password",
      role: "ADMIN",
      companyId: otherCompany.id,
      mfaEnabled: false,
    },
  });

  return { company, admin, requester, manager, viewer, foreignAdmin, otherCompany };
}

function encryptForTest(secret: string) {
  return `encrypted:${secret}`;
}

async function createHighRiskApproval(prismaClient: typeof prisma, requesterId: string, companyId: string) {
  return createApprovalRequest({
    prisma: prismaClient,
    requesterId,
    companyId,
    toolName: "products.deleteProduct",
    argumentsObject: { productId: "P1001" },
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
  });
}

test("1. Viewer cannot approve", async () => {
  const { company, requester, viewer } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () =>
      approveApproval({
        prisma,
        approvalId: approval.id,
        approverId: viewer.id,
        companyId: company.id,
      }),
    /ADMIN|approve/i
  );
});

test("2. Manager cannot approve", async () => {
  const { company, requester, manager } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () =>
      approveApproval({
        prisma,
        approvalId: approval.id,
        approverId: manager.id,
        companyId: company.id,
      }),
    /ADMIN|approve/i
  );
});

test("3. Admin can approve", async () => {
  const { company, requester, admin } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  const challenge = createChallengeToken();

  await prisma.mfaChallenge.create({
    data: {
      userId: admin.id,
      purpose: `approval:${approval.id}:approve`,
      riskLevel: "HIGH",
      challengeToken: challenge,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const approved = await approveApproval({
    prisma,
    approvalId: approval.id,
    approverId: admin.id,
    companyId: company.id,
    mfaChallengeToken: challenge,
  });

  assert.equal(approved.status, ApprovalStatus.APPROVED);
});

test("4. Unauthenticated user cannot access approvals", async () => {
  const req = new NextRequest("http://localhost/api/approvals");
  const result = await getApprovalsRoute(req);
  assert.equal(result.status, 401);
});

test("5. Requester cannot approve own request", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () => approveApproval({ prisma, approvalId: approval.id, approverId: requester.id, companyId: company.id }),
    /cannot approve|own/i
  );
});

test("6. Cross-company approval is rejected", async () => {
  const { company, requester, foreignAdmin } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () => approveApproval({ prisma, approvalId: approval.id, approverId: foreignAdmin.id, companyId: company.id }),
    /not found|company/i
  );
});

test("7. New HIGH-risk operation creates PENDING approval", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  assert.equal(approval.status, ApprovalStatus.PENDING);
});

test("8. Pending approval cannot execute", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, approverId: null, executedAt: null, approvedAt: null, rejectedAt: null, status: approval.status },
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" },
      }),
    /not in APPROVED|APPROVED/i
  );
});

test("9. Rejected approval cannot execute", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.REJECTED, rejectedAt: new Date() } });

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.REJECTED, approverId: null, executedAt: null, approvedAt: null, rejectedAt: new Date() },
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" },
      }),
    /not in APPROVED/i
  );
});

test("10. Cancelled approval cannot execute", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.CANCELLED } });

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.CANCELLED, approverId: null, executedAt: null, approvedAt: null, rejectedAt: null },
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" },
      }),
    /not in APPROVED/i
  );
});

test("11. Expired approval cannot execute", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.APPROVED, approvedAt: new Date(), expiresAt: new Date(Date.now() - 1000) } });

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.APPROVED, approverId: "approver-123", executedAt: null, approvedAt: new Date(), rejectedAt: null, expiresAt: new Date(Date.now() - 1000) },
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" },
      }),
    /expired|Approval expired/i
  );
});

test("12. Executed approval cannot execute again", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.EXECUTED, executedAt: new Date() } });

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.EXECUTED, approverId: "approver-123", executedAt: new Date(), approvedAt: new Date(), rejectedAt: null },
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" },
      }),
    /not in APPROVED/i
  );
});

test("13. Already approved approval cannot be approved again", async () => {
  const { company, requester, admin } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.APPROVED, approverId: admin.id, approvedAt: new Date() } });

  await assert.rejects(
    () => approveApproval({ prisma, approvalId: approval.id, approverId: admin.id, companyId: company.id }),
    /cannot be approved|status/i
  );
});

test("14. Admin without MFA cannot approve HIGH-risk action", async () => {
  const { company, requester, admin } = await createUserSet();
  await prisma.user.update({ where: { id: admin.id }, data: { mfaEnabled: false, mfaSecret: null } });
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () => approveApproval({ prisma, approvalId: approval.id, approverId: admin.id, companyId: company.id }),
    /MFA|required|approve/i
  );
});

test("15. Admin with invalid TOTP cannot approve", async () => {
  const { company, requester, admin } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  const secret = decryptSecret(admin.mfaSecret ?? "");
  const valid = await verifyTotpCode(secret, "000000");
  assert.equal(valid, false);
});

test("16. Admin-generated current TOTP code verifies successfully", async () => {
  const { admin } = await createUserSet();
  const secret = decryptSecret(admin.mfaSecret ?? "");
  const totp = new TOTP({ crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
  const code = await totp.generate({ secret });
  assert.equal(await verifyTotpCode(secret, code), true);
});

test("17. MFA challenge is single-use", async () => {
  const { admin } = await createUserSet();
  const token = createChallengeToken();
  await prisma.mfaChallenge.create({
    data: {
      userId: admin.id,
      purpose: "approval:single-use",
      riskLevel: "HIGH",
      challengeToken: token,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  await validateAndConsumeMfaChallenge(prisma, { userId: admin.id, challengeToken: token, purpose: "approval:single-use", riskLevel: "HIGH" });

  await assert.rejects(
    () => validateAndConsumeMfaChallenge(prisma, { userId: admin.id, challengeToken: token, purpose: "approval:single-use", riskLevel: "HIGH" }),
    /already been consumed|consumed/i
  );
});

test("18. MFA challenge is purpose-bound", async () => {
  const { admin } = await createUserSet();
  const token = createChallengeToken();
  await prisma.mfaChallenge.create({
    data: {
      userId: admin.id,
      purpose: "approval:another",
      riskLevel: "HIGH",
      challengeToken: token,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  await assert.rejects(
    () => validateAndConsumeMfaChallenge(prisma, { userId: admin.id, challengeToken: token, purpose: "approval:actual", riskLevel: "HIGH" }),
    /purpose does not match/i
  );
});

test("19. MFA challenge for another approval cannot be reused", async () => {
  const { admin } = await createUserSet();
  const token = createChallengeToken();
  await prisma.mfaChallenge.create({
    data: {
      userId: admin.id,
      purpose: "approval:other",
      riskLevel: "HIGH",
      challengeToken: token,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  await assert.rejects(
    () => validateAndConsumeMfaChallenge(prisma, { userId: admin.id, challengeToken: token, purpose: "approval:actual", riskLevel: "HIGH" }),
    /purpose does not match|consumed/i
  );
});

test("20. Changing productId after approval causes hash mismatch", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.APPROVED, approverId: "approver-1", executedAt: null, approvedAt: new Date(), rejectedAt: null },
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P9999" },
      }),
    /hash mismatch|changed/i
  );
});

test("21. Changing toolName after approval causes rejection", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.APPROVED, approverId: "approver-1", executedAt: null, approvedAt: new Date(), rejectedAt: null },
        toolName: "products.getProducts",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" },
      }),
    /tool name|does not match/i
  );
});

test("22. Changing requester/company context causes rejection", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.APPROVED, approverId: "approver-1", executedAt: null, approvedAt: new Date(), rejectedAt: null },
        toolName: "products.deleteProduct",
        requesterId: "someone-else",
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" },
      }),
    /requester|context/i
  );
});

test("23. Changing risk level/purpose causes rejection", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);

  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: { ...approval, status: ApprovalStatus.APPROVED, approverId: "approver-1", executedAt: null, approvedAt: new Date(), rejectedAt: null },
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.updateProduct",
        riskLevel: "MEDIUM",
        argumentsObject: { productId: "P1001" },
      }),
    /purpose|risk/i
  );
});

test("24. Approved delete successfully calls Inventory DELETE", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  const server = createCommandServer(requester.id, company.id, Permission.ADMIN);
  const approvalHash = computeApprovalHash({
    toolName: "products.deleteProduct",
    requesterId: requester.id,
    companyId: company.id,
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
    argumentsObject: { productId: "P1001" },
  });

  await prisma.approval.update({
    where: { id: approval.id },
    data: { status: ApprovalStatus.APPROVED, approverId: requester.id, approvedAt: new Date(), argumentsHash: approvalHash },
  });

  const result = await server.executeTool("products.deleteProduct", { productId: "P1001" });
  assert.equal(result.success, false);
});

test("25. Unapproved delete never calls Inventory DELETE", async () => {
  const { company, requester } = await createUserSet();
  const server = createCommandServer(requester.id, company.id, Permission.ADMIN);
  const result = await server.executeTool("products.deleteProduct", { productId: "P1001" });
  assert.equal(result.success, false);
  assert.match(result.message ?? "", /approval|High-risk/i);
});

test("26. Failed approval never calls Inventory DELETE", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.REJECTED, rejectedAt: new Date() } });

  const server = createCommandServer(requester.id, company.id, Permission.ADMIN);
  const result = await server.executeTool("products.deleteProduct", { productId: "P1001" });
  assert.equal(result.success, false);
});

test("27. Expired approval never calls Inventory DELETE", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.APPROVED, approvedAt: new Date(), expiresAt: new Date(Date.now() - 1000) } });

  const server = createCommandServer(requester.id, company.id, Permission.ADMIN);
  const result = await server.executeTool("products.deleteProduct", { productId: "P1001" });
  assert.equal(result.success, false);
});

test("28. Double execution is prevented", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  await prisma.approval.update({ where: { id: approval.id }, data: { status: ApprovalStatus.APPROVED, approvedAt: new Date() } });

  const server = createCommandServer(requester.id, company.id, Permission.ADMIN);
  const first = await server.executeTool("products.deleteProduct", { productId: "P1001" });
  const second = await server.executeTool("products.deleteProduct", { productId: "P1001" });
  assert.equal(first.success, false);
  assert.equal(second.success, false);
});

test("29. LLM cannot specify approverId", async () => {
  const { company, requester } = await createUserSet();
  await assert.rejects(
    () => createApprovalRequest({
      prisma,
      requesterId: requester.id,
      companyId: company.id,
      approverId: "fake-approver",
      toolName: "products.deleteProduct",
      argumentsObject: { productId: "P1001" },
      purpose: "products.deleteProduct",
      riskLevel: "HIGH",
    }),
    /server-controlled|approver/i
  );
});

test("30. LLM cannot specify companyId", async () => {
  const { requester } = await createUserSet();
  await assert.rejects(
    () => createApprovalRequest({
      prisma,
      requesterId: requester.id,
      companyId: "not-allowed",
      toolName: "products.deleteProduct",
      argumentsObject: { productId: "P1001" },
      purpose: "products.deleteProduct",
      riskLevel: "HIGH",
    }),
    /company|server-controlled/i
  );
});

test("31. LLM cannot specify requesterId", async () => {
  const { company } = await createUserSet();
  await assert.rejects(
    () => createApprovalRequest({
      prisma,
      requesterId: "fake-requester",
      companyId: company.id,
      toolName: "products.deleteProduct",
      argumentsObject: { productId: "P1001" },
      purpose: "products.deleteProduct",
      riskLevel: "HIGH",
    }),
    /requester|required|user/i
  );
});

test("32. LLM cannot specify MFA purpose", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  const challenge = createChallengeToken();
  await prisma.mfaChallenge.create({
    data: {
      userId: requester.id,
      purpose: "approval:bad",
      riskLevel: "HIGH",
      challengeToken: challenge,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  await assert.rejects(
    () => validateAndConsumeMfaChallenge(prisma, { userId: requester.id, challengeToken: challenge, purpose: "approval:allowed", riskLevel: "HIGH" }),
    /purpose does not match/i
  );
});

test("33. LLM cannot specify arbitrary endpoint", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  const server = createCommandServer(requester.id, company.id, Permission.ADMIN);
  const result = await server.executeTool("products.deleteProduct", { productId: "http://evil.test" });
  assert.equal(result.success, false);
});

test("34. Secrets are not present in logs", async () => {
  const { company, requester } = await createUserSet();
  const approval = await createHighRiskApproval(prisma, requester.id, company.id);
  const logRow = await prisma.activityLog.findFirst({ where: { action: "APPROVAL_CREATED" } });
  assert.ok(logRow && logRow.details && !logRow.details.includes("password"));
});

test.after(async () => {
  await prisma.activityLog.deleteMany({});
  await prisma.approval.deleteMany({});
  await prisma.mfaChallenge.deleteMany({});
  await prisma.message.deleteMany({}).catch(() => {});
  await prisma.conversation.deleteMany({}).catch(() => {});
  await prisma.application.deleteMany({}).catch(() => {});
  await prisma.session.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.company.deleteMany({});
});
