import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { createDefaultTools } from "../mcp/tools";
import { CommandFlowMCPServer } from "../mcp/server";
import { Permission, type MCPContext } from "../mcp/types";
import { parseCommand } from "../services/command-parser.service";
import {
  classifyGeminiError,
  GEMINI_DEFAULT_MODEL,
  getGeminiConfigurationStatus,
  getGeminiFailureDetails,
  geminiSafeFailureMessage,
  generateResponse,
  GeminiIntentAnalysisError,
  GeminiIntentResponseError,
  GeminiTemporaryUnavailableError,
  retryGeminiRequest,
} from "../services/llm.service";

function createServer(role = Permission.VIEWER) {
  const context: MCPContext = {
    userId: "user-1",
    companyId: "company-1",
    role,
    requestId: "request-1",
    timestamp: new Date().toISOString(),
    prisma: {} as PrismaClient,
    logger: () => undefined,
  };
  const server = new CommandFlowMCPServer(context);
  server.registerTools(createDefaultTools());
  return server;
}

function transientError(status: number, headers?: Headers) {
  return Object.assign(new Error(`provider status ${status}`), { status, headers });
}

function retryOptions(overrides: Record<string, unknown> = {}) {
  let now = 0;
  const delays: number[] = [];
  return {
    delays,
    options: {
      model: "test-model",
      requestTimeoutMs: 1_000,
      maxElapsedMs: 10_000,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      now: () => now,
      sleep: async (milliseconds: number) => {
        delays.push(milliseconds);
        now += milliseconds;
      },
      random: () => 1,
      log: () => undefined,
      ...overrides,
    },
  };
}

test("Gemini retry policy returns first-attempt success without waiting", async () => {
  const state = retryOptions();
  let calls = 0;

  const result = await retryGeminiRequest(async () => {
    calls += 1;
    return "ok";
  }, state.options);

  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.deepEqual(state.delays, []);
});

test("Gemini retries an unavailable response and recovers", async () => {
  const state = retryOptions();
  let calls = 0;

  const result = await retryGeminiRequest(async () => {
    calls += 1;
    if (calls === 1) throw transientError(503);
    return "recovered";
  }, state.options);

  assert.equal(result, "recovered");
  assert.equal(calls, 2);
  assert.deepEqual(state.delays, [100]);
});

test("repeated Gemini 503 responses exhaust the bounded retry policy", async () => {
  const state = retryOptions();
  let calls = 0;

  await assert.rejects(
    () => retryGeminiRequest(async () => {
      calls += 1;
      throw transientError(503);
    }, state.options),
    (error: unknown) => {
      assert.ok(error instanceof GeminiTemporaryUnavailableError);
      assert.equal(error.attempts, 3);
      assert.equal(error.elapsedMs, 300);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(state.delays, [100, 200]);
});

test("Gemini 429 honors Retry-After when retrying", async () => {
  const state = retryOptions();
  let calls = 0;

  const result = await retryGeminiRequest(async () => {
    calls += 1;
    if (calls === 1) throw transientError(429, new Headers({ "Retry-After": "2" }));
    return "recovered";
  }, state.options);

  assert.equal(result, "recovered");
  assert.deepEqual(state.delays, [2_000]);
});

test("Gemini retries transient network failures and honors provider retry delay", async () => {
  const state = retryOptions();
  let calls = 0;

  const result = await retryGeminiRequest(async () => {
    calls += 1;
    if (calls === 1) {
      throw Object.assign(new Error("network failure"), {
        cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
        retryDelay: "1.5s",
      });
    }
    return "recovered";
  }, state.options);

  assert.equal(result, "recovered");
  assert.deepEqual(state.delays, [1_500]);
});

test("permanent Gemini errors are not retried", async () => {
  const state = retryOptions();
  let calls = 0;

  await assert.rejects(
    () => retryGeminiRequest(async () => {
      calls += 1;
      throw transientError(400);
    }, state.options),
  );
  assert.equal(calls, 1);
  assert.deepEqual(state.delays, []);
});

test("Gemini timeouts are retried as transient failures", async () => {
  const state = retryOptions();
  let calls = 0;
  const recovered = await retryGeminiRequest(async () => {
    calls += 1;
    if (calls === 1) throw new DOMException("request timed out", "TimeoutError");
    return "ok";
  }, state.options);

  assert.equal(recovered, "ok");
  assert.equal(calls, 2);
  assert.equal(classifyGeminiError(new DOMException("timeout", "TimeoutError")), "network");
});

test("Gemini provider diagnostics preserve status and redact secrets", () => {
  const details = getGeminiFailureDetails(Object.assign(new Error(
    "503 Service Unavailable: {\"error\":{\"code\":503,\"status\":\"UNAVAILABLE\",\"message\":\"retry later\"},\"api_key\":\"hidden\"}",
  ), { status: 503 }));

  assert.equal(details.status, 503);
  assert.equal(details.providerCode, "UNAVAILABLE");
  assert.equal(details.providerMessage, "retry later");
  assert.equal(getGeminiConfigurationStatus().apiKeyConfigured, Boolean(process.env.GEMINI_API_KEY));
});

test("retry diagnostics redact the prompt when a provider error echoes request text", async () => {
  const sensitivePrompt = "confidential customer request";
  const logged: Array<{ providerMessage?: string }> = [];

  await assert.rejects(
    () => retryGeminiRequest(
      async () => {
        throw Object.assign(new Error(`503 unavailable: ${sensitivePrompt}`), { status: 503 });
      },
      {
        model: "test-model",
        sensitiveValues: [sensitivePrompt],
        maxAttempts: 1,
        requestTimeoutMs: 1,
        maxElapsedMs: 10,
        log: (entry) => logged.push(entry),
      },
    ),
    GeminiTemporaryUnavailableError,
  );

  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.providerMessage?.includes(sensitivePrompt), false);
  assert.equal(logged[0]?.providerMessage?.includes("[redacted]"), true);
});

test("Gemini SDK provider errors preserve nested HTTP status and safely expose the provider reason", () => {
  const sensitivePrompt = "customer record for confidential@example.test";
  const providerError = Object.assign(
    new Error("404 Not Found sending request"),
    {
      responseInternal: { status: 404 },
      error: {
        code: 404,
        status: "NOT_FOUND",
        message: `Model not found for ${sensitivePrompt}`,
      },
    },
  );

  const details = getGeminiFailureDetails(providerError, [sensitivePrompt]);
  assert.equal(details.status, 404);
  assert.equal(details.providerCode, "NOT_FOUND");
  assert.equal(details.providerMessage, "Model not found for [redacted]");

  const safeMessage = geminiSafeFailureMessage(details);
  assert.match(safeMessage, /HTTP 404/);
  assert.match(safeMessage, /Model not found/);
  assert.equal(safeMessage.includes(sensitivePrompt), false);
});

test("mocked Gemini 400 and 404 SDK responses retain sanitized provider details", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-api-key-never-sent";
  const sensitivePrompt = "confidential customer request";
  const logged: unknown[][] = [];
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  console.warn = (...args: unknown[]) => logged.push(args);
  console.error = (...args: unknown[]) => logged.push(args);

  try {
    for (const responseCase of [
      {
        status: 400,
        providerCode: "INVALID_ARGUMENT",
        providerMessage: `Invalid request containing ${sensitivePrompt}`,
      },
      {
        status: 404,
        providerCode: "NOT_FOUND",
        providerMessage: `Model unavailable for ${sensitivePrompt}`,
      },
    ]) {
      const sdkError = Object.assign(
        new Error(JSON.stringify({
          error: {
            code: responseCase.status,
            status: responseCase.providerCode,
            message: responseCase.providerMessage,
          },
        })),
        { status: responseCase.status },
      );
      assert.equal(classifyGeminiError(sdkError), "permanent");
      assert.equal(getGeminiFailureDetails(sdkError, [sensitivePrompt]).status, responseCase.status);
      const createClient = () => ({
        interactions: {
          create: async () => {
            throw sdkError;
          },
        },
      });

      await assert.rejects(
        () => generateResponse(sensitivePrompt, [sensitivePrompt], createClient),
        (error: unknown) => {
          assert.ok(
            error instanceof GeminiIntentAnalysisError,
            `Expected GeminiIntentAnalysisError, received ${error instanceof Error ? error.name : typeof error}`,
          );
          assert.equal(error.details.status, responseCase.status);
          assert.equal(error.details.providerCode, responseCase.providerCode);
          assert.equal(
            error.details.providerMessage,
            responseCase.providerMessage.replace(sensitivePrompt, "[redacted]"),
          );
          return true;
        },
      );
    }

    const serializedLogs = JSON.stringify(logged);
    assert.match(serializedLogs, /providerStatus/);
    assert.match(serializedLogs, /INVALID_ARGUMENT/);
    assert.match(serializedLogs, /NOT_FOUND/);
    assert.equal(serializedLogs.includes("test-api-key-never-sent"), false);
    assert.equal(serializedLogs.includes(sensitivePrompt), false);
  } finally {
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test("Gemini provider details are extracted from nested response bodies", () => {
  const details = getGeminiFailureDetails({
    response: {
      data: {
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "Invalid generation configuration",
        },
      },
    },
  });

  assert.equal(details.status, 400);
  assert.equal(details.providerCode, "INVALID_ARGUMENT");
  assert.equal(details.providerMessage, "Invalid generation configuration");
});

test("mocked Gemini interaction returns validated intent without storing the prompt", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-api-key-never-sent";
  const requests: Array<{
    model: string;
    input: string;
    store: false;
    response_format: { type: string; mime_type: string };
  }> = [];
  const createClient = () => ({
    interactions: {
      create: async (request: {
        model: string;
        input: string;
        store: false;
        response_format: { type: "text"; mime_type: "application/json" };
      }) => {
        requests.push(request);
        return {
          output_text: JSON.stringify({ tool: "products.getProducts", arguments: {} }),
        };
      },
    },
  });

  try {
    const parsed = await parseCommand(
      "Show products",
      createServer(),
      undefined,
      (prompt, sensitiveValues) => generateResponse(prompt, sensitiveValues, createClient),
    );

    assert.deepEqual(parsed, { tool: "products.getProducts", arguments: {} });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.model, getGeminiConfigurationStatus().model);
    assert.equal(requests[0]?.store, false);
    assert.deepEqual(requests[0]?.response_format, { type: "text", mime_type: "application/json" });
    assert.match(requests[0]?.input ?? "", /Show products/);
  } finally {
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test("malformed mocked interaction output fails intent parsing", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-api-key-never-sent";
  const createClient = () => ({
    interactions: {
      create: async () => ({ output_text: "not valid JSON" }),
    },
  });

  try {
    await assert.rejects(
      () => parseCommand(
        "Show products",
        createServer(),
        undefined,
        (prompt, sensitiveValues) => generateResponse(prompt, sensitiveValues, createClient),
      ),
      GeminiIntentResponseError,
    );
  } finally {
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test("mocked Gemini 404 preserves the provider reason without sending a request externally", async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-api-key-never-sent";
  const privatePrompt = "confidential test request";
  let factoryCalled = false;
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  const createClient = () => {
    factoryCalled = true;
    return {
      interactions: {
        create: async () => {
          throw Object.assign(
            new Error("404 Not Found sending request"),
            {
              responseInternal: { status: 404 },
              error: {
                code: 404,
                status: "NOT_FOUND",
                message: `Model not found for ${privatePrompt}`,
              },
            },
          );
        },
      },
    };
  };

  try {
    await assert.rejects(
      () => generateResponse(privatePrompt, [privatePrompt], createClient),
      (error: unknown) => {
        assert.ok(error instanceof GeminiIntentAnalysisError);
        assert.equal(error.details.status, 404);
        assert.equal(error.details.providerCode, "NOT_FOUND");
        assert.match(error.message, /HTTP 404.*Model not found/);
        assert.equal(error.message.includes(privatePrompt), false);
        return true;
      },
    );

    assert.equal(factoryCalled, true);
    const output = JSON.stringify(logged);
    assert.match(output, /providerStatus/);
    assert.match(output, /NOT_FOUND/);
    assert.equal(output.includes("test-api-key-never-sent"), false);
    assert.equal(output.includes(privatePrompt), false);
  } finally {
    console.error = originalConsoleError;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test("Gemini defaults to the documented stable text model", () => {
  assert.equal(GEMINI_DEFAULT_MODEL, "gemini-3.8-flash");
  if (!process.env.GEMINI_MODEL?.trim()) {
    assert.equal(getGeminiConfigurationStatus().model, GEMINI_DEFAULT_MODEL);
  }
});

test("permanent provider errors preserve the HTTP status in safe intent diagnostics", async () => {
  const failedStages: Array<{ stage: string; message: string }> = [];

  await assert.rejects(
    () => parseCommand("Show products", createServer(), {
      onStageFailed: (stage, message) => failedStages.push({ stage, message }),
    }, async () => {
      throw new GeminiIntentAnalysisError({
        status: 404,
        providerCode: "NOT_FOUND",
        category: "permanent",
      });
    }),
    (error: unknown) => {
      assert.ok(error instanceof GeminiIntentAnalysisError);
      assert.match(error.message, /HTTP 404/);
      return true;
    },
  );
  assert.equal(failedStages[0]?.stage, "intent-analysis");
  assert.match(failedStages[0]?.message ?? "", /verify the configured model and endpoint/i);
});

test("exact read-only commands use validated existing tools during Gemini outage", async () => {
  const server = createServer();
  const trace: string[] = [];
  const failGemini = async () => {
    throw new GeminiTemporaryUnavailableError(3, 1_200, "unavailable");
  };

  const parsed = await parseCommand("Show products", server, {
    onStageComplete: (stage) => trace.push(`complete:${stage}`),
    onStageFallback: (stage, note) => trace.push(`fallback:${stage}:${note}`),
  }, failGemini);

  assert.deepEqual(parsed, { tool: "products.getProducts", arguments: {} });
  assert.ok(server.listTools().some((tool) => tool.name === parsed.tool));
  assert.ok(trace.some((item) => item.startsWith("fallback:intent-analysis:")));
  assert.ok(trace.includes("complete:mcp-plan-preparation"));
});

test("valid Gemini intent output passes registry permission and input validation", async () => {
  const parsed = await parseCommand(
    "Show products",
    createServer(),
    undefined,
    async () => ({ success: true, text: JSON.stringify({ tool: "products.getProducts", arguments: {} }) }),
  );

  assert.deepEqual(parsed, { tool: "products.getProducts", arguments: {} });
});

test("malformed and empty Gemini output fail MCP plan preparation safely", async () => {
  for (const text of ["", "{not valid json"]) {
    const failedStages: string[] = [];
    await assert.rejects(
      () => parseCommand("Show products", createServer(), {
        onStageFailed: (stage) => failedStages.push(stage),
      }, async () => ({ success: true, text })),
      (error: unknown) => {
        assert.ok(error instanceof GeminiIntentResponseError);
        return true;
      },
    );
    assert.deepEqual(failedStages, ["mcp-plan-preparation"]);
  }
});

test("Gemini 404 remains a provider failure instead of becoming a successful unknown command", async () => {
  const server = createServer();
  const providerError = Object.assign(new Error("model not found"), { status: 404 });

  await assert.rejects(
    () => parseCommand(
      "show products",
      server,
      undefined,
      async () => { throw providerError; },
    ),
    (error: unknown) => {
      assert.ok(error instanceof GeminiIntentAnalysisError);
      assert.equal(error.details.status, 404);
      assert.match(error.message, /HTTP 404/);
      return true;
    },
  );
});

test("unsuccessful Gemini response fails intent analysis", async () => {
  const failedStages: string[] = [];
  await assert.rejects(
    () => parseCommand("Show products", createServer(), {
      onStageFailed: (stage) => failedStages.push(stage),
    }, async () => ({ success: false, text: "" })),
    GeminiIntentResponseError,
  );
  assert.deepEqual(failedStages, ["intent-analysis"]);
});

test("Gemini output cannot select unregistered or unauthorized tools", async () => {
  await assert.rejects(
    () => parseCommand(
      "Disable a user",
      createServer(Permission.VIEWER),
      undefined,
      async () => ({
        success: true,
        text: JSON.stringify({ tool: "users.disableUser", arguments: { userId: "user-2" } }),
      }),
    ),
    GeminiIntentResponseError,
  );
});

test("inventory summary fallback uses its existing registered tool", async () => {
  const parsed = await parseCommand(
    "Show inventory summary",
    createServer(),
    undefined,
    async () => { throw new GeminiTemporaryUnavailableError(2, 800, "rate_limited"); },
  );

  assert.deepEqual(parsed, { tool: "analytics.inventorySummary", arguments: {} });
});

test("ambiguous and destructive commands never use deterministic fallback", async () => {
  const server = createServer();
  const failures: Array<{ stage: string; error: string }> = [];
  const failGemini = async () => {
    throw new GeminiTemporaryUnavailableError(3, 1_000, "unavailable");
  };

  await assert.rejects(
    () => parseCommand("Delete product P1001", server, {
      onStageFailed: (stage, error) => failures.push({ stage, error }),
    }, failGemini),
    GeminiTemporaryUnavailableError,
  );
  assert.equal(failures[0]?.stage, "intent-analysis");
  assert.match(failures[0]?.error ?? "", /temporarily unavailable/i);
  assert.match(failures[0]?.error ?? "", /3 attempts, 1\.0 seconds/);

  const denied = await server.executeTool("products.deleteProduct", { productId: "P1001" });
  assert.equal(denied.success, false);
  assert.match(denied.message ?? "", /does not have permission/i);
});

test("fallback phrases do not match broader or arbitrary requests", async () => {
  const failGemini = async () => {
    throw new GeminiTemporaryUnavailableError(3, 1_000, "unavailable");
  };

  await assert.rejects(
    () => parseCommand("Show products and delete one", createServer(), undefined, failGemini),
    GeminiTemporaryUnavailableError,
  );
  await assert.rejects(
    () => parseCommand("Show products in the other company's catalog", createServer(), undefined, failGemini),
    GeminiTemporaryUnavailableError,
  );
});
