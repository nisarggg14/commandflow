import dotenv from "dotenv";
dotenv.config();

import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { createDefaultTools } from "../mcp/tools";
import { CommandFlowMCPServer } from "../mcp/server";
import { Permission, type MCPContext } from "../mcp/types";
import {
  createTotpSecret,
  verifyTotpCode,
  createChallengeToken,
  validateAndConsumeMfaChallenge,
  encryptSecret,
  decryptSecret,
} from "../lib/mfa";
import {
  createApprovalRequest,
  approveApproval,
  validateApprovalForExecution,
  markApprovalExecuted,
} from "../services/approval.service";
import { ApprovalStatus } from "@prisma/client";
import { resolveProductReference, resolveSingleVariant } from "../services/product-resolver.service";
import { getProduct, getProducts } from "../services/inventory-api.service";
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";

const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();
const totpGen = new TOTP({ crypto: cryptoPlugin, base32: base32Plugin });

async function runInventoryDirectTest() {
  console.log("\n=== 1. INVENTORY API DIRECT MUTATION TEST ===");
  const baseUrl = process.env.INVENTORY_API_BASE_URL || "http://localhost:5000";
  
  // 1. Authenticate against Inventory API
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  assert.equal(loginRes.status, 200, "Inventory login should succeed");
  const loginData = await loginRes.json();
  const token = loginData.token;
  assert.ok(token, "Token should be present");

  // 2. PUT /products/P1003 with variant update
  console.log("Sending PUT /products/P1003 with stock: 10 for LEVIS-501-BLK-32...");
  const putRes = await fetch(`${baseUrl}/products/P1003`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      variants: [
        {
          sku: "LEVIS-501-BLK-32",
          stock: 10,
        },
      ],
    }),
  });
  assert.equal(putRes.status, 200, `PUT /products/P1003 should return 200, got ${putRes.status}`);
  const putData = await putRes.json();
  console.log("PUT response received. Product:", putData.name);

  // 3. GET /products/P1003 to verify mutation persisted
  const getRes = await fetch(`${baseUrl}/products/P1003`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(getRes.status, 200, "GET /products/P1003 should return 200");
  const product = await getRes.json();
  const variant = product.variants.find((v: any) => v.sku === "LEVIS-501-BLK-32");
  assert.ok(variant, "Variant LEVIS-501-BLK-32 must exist");
  assert.equal(variant.stock, 10, `Stock must be 10, got ${variant.stock}`);
  assert.equal(variant.color, "Black", "Unrelated field 'color' should remain 'Black'");
  assert.equal(variant.size, "32", "Unrelated field 'size' should remain '32'");
  console.log("✔ INVENTORY VARIANT UPDATE PASSED: Stock = 10 confirmed, other fields preserved.");
}

async function runMfaTests() {
  console.log("\n=== 2. MFA SETUP & VERIFICATION SECURITY TESTS ===");
  
  // Test 1: Generate secret, encrypt/decrypt
  const rawSecret = createTotpSecret();
  const encrypted = encryptSecret(rawSecret);
  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, rawSecret, "Encrypted secret must decrypt to original");

  // Test 2: Valid TOTP verification
  const validCode = await totpGen.generate({ secret: rawSecret });
  const isValid = await verifyTotpCode(rawSecret, validCode);
  assert.equal(isValid, true, "Valid TOTP code should verify");

  // Test 3: Invalid TOTP verification rejected
  const isInvalid = await verifyTotpCode(rawSecret, "000000");
  assert.equal(isInvalid, false, "Invalid TOTP code should be rejected");

  // Test 4: Challenge creation & single-use consumption in DB
  const companyName = `MFA Test ${Date.now()}`;
  const company = await prisma.company.create({
    data: {
      name: companyName,
      normalizedName: companyName.trim().toLowerCase(),
      slug: `mfa-test-${Date.now()}`,
    },
  });
  const user = await prisma.user.create({
    data: {
      name: "MFA User",
      email: `mfa-${Date.now()}@example.com`,
      password: "hashed",
      role: "ADMIN",
      companyId: company.id,
      mfaEnabled: true,
      mfaSecret: encrypted,
    },
  });

  const challengeToken = createChallengeToken();
  await prisma.mfaChallenge.create({
    data: {
      userId: user.id,
      purpose: "step-up-mfa",
      riskLevel: "HIGH",
      challengeToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  // Consuming with matching context succeeds
  const consumed = await validateAndConsumeMfaChallenge(prisma, {
    userId: user.id,
    challengeToken,
    purpose: "step-up-mfa",
    riskLevel: "HIGH",
  });
  assert.ok(consumed.verifiedAt, "Challenge must be marked verified");

  // Consuming again fails (single-use)
  await assert.rejects(
    () =>
      validateAndConsumeMfaChallenge(prisma, {
        userId: user.id,
        challengeToken,
        purpose: "step-up-mfa",
        riskLevel: "HIGH",
      }),
    /already been consumed/i,
    "Consumed challenge cannot be reused"
  );

  // Consuming for wrong purpose fails
  const challenge2 = await prisma.mfaChallenge.create({
    data: {
      userId: user.id,
      purpose: "step-up-mfa",
      riskLevel: "HIGH",
      challengeToken: createChallengeToken(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  await assert.rejects(
    () =>
      validateAndConsumeMfaChallenge(prisma, {
        userId: user.id,
        challengeToken: challenge2.challengeToken,
        purpose: "different-purpose",
        riskLevel: "HIGH",
      }),
    /purpose does not match/i,
    "Challenge cannot be reused for different purpose"
  );

  // Expired challenge fails
  const expiredChallenge = await prisma.mfaChallenge.create({
    data: {
      userId: user.id,
      purpose: "step-up-mfa",
      riskLevel: "HIGH",
      challengeToken: createChallengeToken(),
      expiresAt: new Date(Date.now() - 1000), // in the past
    },
  });

  await assert.rejects(
    () =>
      validateAndConsumeMfaChallenge(prisma, {
        userId: user.id,
        challengeToken: expiredChallenge.challengeToken,
        purpose: "step-up-mfa",
        riskLevel: "HIGH",
      }),
    /expired/i,
    "Expired challenge must be rejected"
  );

  console.log("✔ MFA SECURITY TESTS PASSED: Secret encryption, TOTP verification, single-use, purpose-binding, and expiration all verified.");
  return { company, user };
}

async function runApprovalWorkflowTests(company: any, admin: any) {
  console.log("\n=== 3. APPROVAL + MFA WORKFLOW TESTS ===");

  const requester = await prisma.user.create({
    data: {
      name: "Requester",
      email: `req-${Date.now()}@example.com`,
      password: "hashed",
      role: "ADMIN",
      companyId: company.id,
      mfaEnabled: true,
      mfaSecret: admin.mfaSecret,
    },
  });

  const viewer = await prisma.user.create({
    data: {
      name: "Viewer",
      email: `viewer-${Date.now()}@example.com`,
      password: "hashed",
      role: "VIEWER",
      companyId: company.id,
      mfaEnabled: false,
    },
  });

  // 1. Create approval request
  const approval = await createApprovalRequest({
    prisma,
    requesterId: requester.id,
    companyId: company.id,
    toolName: "products.deleteProduct",
    argumentsObject: { productId: "P1003" },
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
  });
  assert.equal(approval.status, ApprovalStatus.PENDING);

  // 2. Viewer cannot approve
  await assert.rejects(
    () =>
      approveApproval({
        prisma,
        approvalId: approval.id,
        approverId: viewer.id,
        companyId: company.id,
        mfaChallengeToken: "dummy",
      }),
    /Only ADMIN users can approve/i
  );

  // 3. Requester cannot self-approve
  await assert.rejects(
    () =>
      approveApproval({
        prisma,
        approvalId: approval.id,
        approverId: requester.id,
        companyId: company.id,
        mfaChallengeToken: "dummy",
      }),
    /cannot approve their own/i
  );

  // 4. Admin with valid MFA approves
  const approveChallengeToken = createChallengeToken();
  await prisma.mfaChallenge.create({
    data: {
      userId: admin.id,
      purpose: `approval:${approval.id}:approve`,
      riskLevel: "HIGH",
      challengeToken: approveChallengeToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  const approved = await approveApproval({
    prisma,
    approvalId: approval.id,
    approverId: admin.id,
    companyId: company.id,
    mfaChallengeToken: approveChallengeToken,
  });
  assert.equal(approved.status, ApprovalStatus.APPROVED);

  // 5. Execution validation succeeds with exact arguments
  await validateApprovalForExecution({
    approval: approved as any,
    toolName: "products.deleteProduct",
    requesterId: requester.id,
    companyId: company.id,
    purpose: "products.deleteProduct",
    riskLevel: "HIGH",
    argumentsObject: { productId: "P1003" },
  });

  // 6. Modified arguments fail execution check (tamper resistance)
  await assert.rejects(
    () =>
      validateApprovalForExecution({
        approval: approved as any,
        toolName: "products.deleteProduct",
        requesterId: requester.id,
        companyId: company.id,
        purpose: "products.deleteProduct",
        riskLevel: "HIGH",
        argumentsObject: { productId: "P1001" }, // Changed argument!
      }),
    /hash mismatch/i
  );

  // 7. Mark executed
  const executed = await markApprovalExecuted(prisma, approval.id, company.id);
  assert.equal(executed?.status, ApprovalStatus.EXECUTED);

  // 8. Cannot execute again
  await assert.rejects(
    () => markApprovalExecuted(prisma, approval.id, company.id),
    /cannot be marked executed from status EXECUTED/i
  );

  console.log("✔ APPROVAL + MFA TESTS PASSED: RBAC, self-approval prevention, MFA requirement, tamper-evidence hash, and double-execution protection confirmed.");
}

async function runCommandFlowTests(company: any, admin: any) {
  console.log("\n=== 4. COMMANDFLOW MCP SERVER TESTS ===");

  function createServer(role: Permission, mfaToken?: string) {
    const context: MCPContext = {
      userId: admin.id,
      companyId: company.id,
      role,
      requestId: `req-${Date.now()}`,
      timestamp: new Date().toISOString(),
      prisma,
      logger: () => undefined,
      mfaChallengeToken: mfaToken,
    };
    const server = new CommandFlowMCPServer(context);
    server.registerTools(createDefaultTools());
    return server;
  }

  // TEST 1: Show products (products.getProducts)
  console.log("Running TEST 1: products.getProducts...");
  const viewerServer = createServer(Permission.VIEWER);
  const productsResult = await viewerServer.executeTool("products.getProducts", {});
  assert.equal(productsResult.success, true, "products.getProducts should succeed");
  assert.ok(Array.isArray(productsResult.data), "Should return array of products");
  console.log(`✔ TEST 1 PASSED: products.getProducts returned ${(productsResult.data as any[]).length} products.`);

  // TEST 2: Update product name (products.updateProduct)
  console.log("Running TEST 2: products.updateProduct...");
  const managerServer = createServer(Permission.MANAGER);
  const updateNameResult = await managerServer.executeTool("products.updateProduct", {
    productId: "P1003",
    name: "Levi's 501 Classic Jeans",
  });
  assert.equal(updateNameResult.success, true, "products.updateProduct should succeed");
  const p1003 = await getProduct("P1003");
  assert.equal(p1003.name, "Levi's 501 Classic Jeans", "Name must be updated in Inventory API");
  console.log("✔ TEST 2 PASSED: products.updateProduct updated name to:", p1003.name);

  // TEST 3: Set stock of P1003 SKU LEVIS-501-BLK-32 to 10 (products.updateStock)
  console.log("Running TEST 3: products.updateStock...");
  const updateStockResult = await managerServer.executeTool("products.updateStock", {
    productId: "P1003",
    sku: "LEVIS-501-BLK-32",
    stock: 10,
  });
  assert.equal(updateStockResult.success, true, "products.updateStock should succeed");
  const p1003Stock = await getProduct("P1003");
  const v1003 = p1003Stock.variants.find((v) => v.sku === "LEVIS-501-BLK-32");
  assert.equal(v1003?.stock, 10, "Stock must be verified as 10 via Inventory API");
  console.log("✔ TEST 3 PASSED: products.updateStock verified stock = 10 via Inventory API GET.");

  // TEST 4: Update variant price using specific SKU (products.adjustPrice)
  console.log("Running TEST 4: products.adjustPrice...");
  const adjustPriceResult = await managerServer.executeTool("products.adjustPrice", {
    productId: "P1003",
    sku: "LEVIS-501-BLK-32",
    operation: "set",
    price: 4299,
  });
  assert.equal(adjustPriceResult.success, true, "products.adjustPrice should succeed");
  const p1003Price = await getProduct("P1003");
  const v1003Price = p1003Price.variants.find((v) => v.sku === "LEVIS-501-BLK-32");
  assert.equal(v1003Price?.price, 4299, "Price must be verified as 4299 via Inventory API");
  console.log("✔ TEST 4 PASSED: products.adjustPrice verified price = 4299 via Inventory API.");

  // TEST 5: Ambiguous P1002 update without SKU fails gracefully
  console.log("Running TEST 5: Ambiguous P1002 price update without SKU/variant ID...");
  const p1002 = await getProduct("P1002");
  assert.ok(p1002.variants.length > 1, "P1002 must have multiple variants");
  assert.throws(
    () => resolveSingleVariant(p1002, {}),
    /has multiple variants. Please specify a SKU or variant ID/i,
    "System must reject ambiguous multi-variant update"
  );
  console.log("✔ TEST 5 PASSED: Ambiguous multi-variant update correctly asks for SKU or variant ID.");

  // TEST 6: Destructive delete operation creates pending approval & requires ADMIN + MFA
  console.log("Running TEST 6: High-risk deleteProduct requires approval...");
  const adminServer = createServer(Permission.ADMIN);
  // First attempt: no approval exists yet, should create approval and return success: false with approval notice
  const deleteResult = await adminServer.executeTool("products.deleteProduct", { productId: "P1003" });
  assert.equal(deleteResult.success, false, "Should not succeed without approval");
  assert.match(deleteResult.message || "", /requires a separate administrator approval/i);
  console.log("✔ TEST 6 Part A PASSED: Approval request created automatically for high-risk delete.");

  // TEST 7: Mutation as unauthorized role (VIEWER) is blocked
  console.log("Running TEST 7: Viewer mutation blocked by RBAC...");
  const viewerMutationResult = await viewerServer.executeTool("products.updateStock", {
    productId: "P1003",
    sku: "LEVIS-501-BLK-32",
    stock: 5,
  });
  assert.equal(viewerMutationResult.success, false, "Viewer must be blocked");
  assert.match(viewerMutationResult.message || "", /does not have permission/i);
  console.log("✔ TEST 7 PASSED: Viewer mutation blocked by RBAC middleware.");

}

async function main() {
  try {
    await runInventoryDirectTest();
    const { company, user } = await runMfaTests();
    await runApprovalWorkflowTests(company, user);
    await runCommandFlowTests(company, user);
    console.log("\n==========================================");
    console.log("ALL STABILIZATION VERIFICATION TESTS PASSED!");
    console.log("==========================================\n");
  } catch (error) {
    console.error("\n❌ VERIFICATION TEST FAILED:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
