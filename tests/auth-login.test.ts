import test from "node:test";
import assert from "node:assert/strict";
import { createLoginSuccessResponse, getLoginErrorResponse, redactLoginDiagnostic } from "../app/api/auth/login/route";
import { AuthenticationServiceError, UnauthorizedError } from "../lib/errors";
import { ZodError } from "zod";

test("invalid login payloads return a safe bad-request response", () => {
  const result = getLoginErrorResponse(new ZodError([]));

  assert.deepEqual(result, {
    status: 400,
    message: "Invalid login request.",
    log: false,
  });
});

test("invalid credentials return a generic unauthorized response", () => {
  const result = getLoginErrorResponse(new UnauthorizedError("Invalid email or password."));

  assert.deepEqual(result, {
    status: 401,
    message: "Invalid email or password.",
    log: false,
  });
});

test("database connection failures return a safe service-unavailable response", () => {
  const internalError = new Error("Error opening a TLS connection to db.internal.example:5432");
  const result = getLoginErrorResponse(new AuthenticationServiceError("Authentication data store unavailable.", internalError));

  assert.equal(result.status, 503);
  assert.equal(result.message, "Authentication service unavailable. Please try again later.");
  assert.equal(result.log, true);
  assert.equal(result.message.includes("db.internal.example"), false);
  assert.equal(result.message.includes("TLS"), false);
});

test("login diagnostics redact database URLs and credential-like values", () => {
  const diagnostic = redactLoginDiagnostic(new Error("database_url=postgresql://user:password@db.internal:5432/app password=secret"));

  assert.equal(diagnostic.includes("postgresql://"), false);
  assert.equal(diagnostic.includes("password@db.internal"), false);
  assert.equal(diagnostic.includes("password=secret"), false);
  assert.match(diagnostic, /REDACTED/);
});
test("unexpected authentication failures do not expose internal details", () => {
  const result = getLoginErrorResponse(new Error("PrismaClientKnownRequestError: password=super-secret database_url=postgresql://internal"));

  assert.equal(result.status, 500);
  assert.equal(result.message, "Login failed. Please try again later.");
  assert.equal(result.message.includes("Prisma"), false);
  assert.equal(result.message.includes("super-secret"), false);
  assert.equal(result.message.includes("postgresql"), false);
});

test("successful login response omits the JWT while setting the httpOnly cookie", async () => {
  const response = createLoginSuccessResponse({
    success: true,
    message: "Login successful",
    token: "test-token-only",
    user: { id: "user-1", email: "qa@example.test" },
  });
  const body = await response.json();
  const cookie = response.headers.get("set-cookie") ?? "";

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.token, undefined);
  assert.match(cookie, /token=test-token-only/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Max-Age=604800/i);
  assert.equal(/;\s*Secure(?:;|$)/i.test(cookie), process.env.NODE_ENV === "production");
});