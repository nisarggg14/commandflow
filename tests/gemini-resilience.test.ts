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

test("Gemini defaults to the documented stable text model", () => {
  if (!process.env.GEMINI_MODEL?.trim()) {
    assert.equal(getGeminiConfigurationStatus().model, GEMINI_DEFAULT_MODEL);
    assert.equal(GEMINI_DEFAULT_MODEL, "gemini-2.5-flash");
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
  assert.match(failedStages[0]?.message ?? "", /model was not found/i);
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
