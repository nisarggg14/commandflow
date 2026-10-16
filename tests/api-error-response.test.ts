import assert from "node:assert/strict";
import test from "node:test";

import { safeApiErrorResponse } from "../lib/api-error-response";
import { AuthenticationServiceError } from "../lib/errors";

test("unexpected API errors are logged without their message or exposed to clients", async () => {
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const response = safeApiErrorResponse(
      new Error("TLS connection to private-db.internal with password=secret"),
      "api.test",
      "Request failed safely.",
    );
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.message, "Request failed safely.");
    assert.equal(JSON.stringify(logged).includes("private-db.internal"), false);
    assert.equal(JSON.stringify(logged).includes("secret"), false);
  } finally {
    console.error = originalConsoleError;
  }
});

test("authentication datastore errors use a safe service-unavailable response", async () => {
  const response = safeApiErrorResponse(
    new AuthenticationServiceError("internal", new Error("database host and credentials")),
    "api.test",
    "Request failed.",
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.message, "Authentication service unavailable. Please try again later.");
});
