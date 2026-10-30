import assert from "node:assert/strict";
import test from "node:test";

import { chatServiceErrorResponse } from "../lib/chat-service-error-response";
import { logServerError } from "../lib/server-error-logging";
import {
  GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE,
  GeminiIntentAnalysisError,
  GeminiIntentResponseError,
  GeminiQuotaError,
  GeminiTemporaryUnavailableError,
} from "../services/llm.service";

test("Gemini provider failures map to consistent upstream HTTP responses", async () => {
  const modelNotFound = new GeminiIntentAnalysisError({
    status: 404,
    providerMessage: "model not found",
    category: "permanent",
  });
  const modelNotFoundResponse = chatServiceErrorResponse(modelNotFound);
  assert.ok(modelNotFoundResponse);
  assert.equal(modelNotFoundResponse.status, 502);
  const modelNotFoundBody = await modelNotFoundResponse.json();
  assert.equal(modelNotFoundBody.success, false);
  assert.match(modelNotFoundBody.message, /Gemini API returned HTTP 404/);

  const temporaryErrorResponse = chatServiceErrorResponse(
    new GeminiTemporaryUnavailableError(3, 1_000, "unavailable"),
  );
  assert.ok(temporaryErrorResponse);
  assert.equal(temporaryErrorResponse.status, 503);
  assert.deepEqual(await temporaryErrorResponse.json(), {
    success: false,
    message: GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE,
  });

  const invalidResponse = chatServiceErrorResponse(
    new GeminiIntentResponseError("provider response included unsafe details"),
  );
  assert.ok(invalidResponse);
  assert.equal(invalidResponse.status, 502);
  assert.equal((await invalidResponse.json()).success, false);

  const quotaResponse = chatServiceErrorResponse(new GeminiQuotaError());
  assert.ok(quotaResponse);
  assert.equal(quotaResponse.status, 429);
  assert.equal((await quotaResponse.json()).success, false);

  const rateLimitedResponse = chatServiceErrorResponse(
    new GeminiTemporaryUnavailableError(3, 1_000, "rate_limited"),
  );
  assert.ok(rateLimitedResponse);
  assert.equal(rateLimitedResponse.status, 429);
});

test("Gemini request failures retain the skipped execution trace", async () => {
  const error = Object.assign(
    new GeminiTemporaryUnavailableError(1, 4_000, "network"),
    {
      executionTrace: [{
        id: "client-api-request",
        label: "Client API Request",
        status: "skipped",
        requestId: "request-123",
        note: "Skipped because intent analysis failed.",
      }],
    },
  );
  const response = chatServiceErrorResponse(error);
  assert.ok(response);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.execution.stages[0].status, "skipped");
  assert.equal(body.execution.stages[0].requestId, "request-123");
});

test("server diagnostics include error details while redacting credentials and request text", () => {
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const requestMessage = "change stock for private product";
    const error = new Error(
      `request failed for ${requestMessage}; api_key=very-secret Bearer abc.def.ghi`,
    );
    logServerError(
      "api.chat",
      error,
      [requestMessage, "session-cookie-value"],
      "request-123",
    );

    const output = JSON.stringify(logged);
    assert.match(output, /requestId/);
    assert.match(output, /request-123/);
    assert.match(output, /errorName/);
    assert.match(output, /errorMessage/);
    assert.match(output, /errorStack/);
    assert.equal(output.includes(requestMessage), false);
    assert.equal(output.includes("very-secret"), false);
    assert.equal(output.includes("abc.def.ghi"), false);
    assert.equal(output.includes("session-cookie-value"), false);
  } finally {
    console.error = originalConsoleError;
  }
});

test("correlated chat diagnostics include sanitized Gemini SDK cause and provider details", () => {
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const privateRequest = "private product instructions";
    const providerFailure = Object.assign(
      new Error(`404 Not Found: ${privateRequest}; api_key=provider-secret`),
      { status: 404 },
    );
    const error = new GeminiIntentAnalysisError({
      status: 404,
      providerCode: "NOT_FOUND",
      providerMessage: `Model not found for ${privateRequest}`,
      category: "permanent",
    }, providerFailure);

    logServerError("api.chat", error, [privateRequest, "provider-secret"], "request-456");

    const output = JSON.stringify(logged);
    assert.match(output, /request-456/);
    assert.match(output, /providerStatus/);
    assert.match(output, /NOT_FOUND/);
    assert.match(output, /causeName/);
    assert.equal(output.includes("causeStack"), false);
    assert.equal(output.includes(privateRequest), false);
    assert.equal(output.includes("provider-secret"), false);
  } finally {
    console.error = originalConsoleError;
  }
});
