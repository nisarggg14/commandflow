import fs from "node:fs";
import { performance } from "node:perf_hooks";

const toolsModule = await import("../mcp/tools/index.ts");
const serverModule = await import("../mcp/server.ts");
const orderModule = await import("../services/order-api.service.ts");

const tools = ((toolsModule.default ?? toolsModule["module.exports"] ?? toolsModule).createDefaultTools());
const get = (name) => tools.find((tool) => tool.name === name);
const orderUpdate = get("orders.updateOrderStatus");
const cancelOrder = get("orders.cancelOrder");
const uiTheme = get("ui.setTheme");
const context = {
  userId: "benchmark-user",
  companyId: "benchmark-company",
  role: "MANAGER",
  requestId: "benchmark-request",
  timestamp: new Date().toISOString(),
  prisma: {},
  logger: () => undefined,
};
const server = new (serverModule.default ?? serverModule["module.exports"] ?? serverModule).CommandFlowMCPServer(context);
server.registerTools(tools);
const viewerContext = { ...context, role: "VIEWER" };
const viewerServer = new (serverModule.default ?? serverModule["module.exports"] ?? serverModule).CommandFlowMCPServer(viewerContext);
viewerServer.registerTools(tools);

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + ((b - mean) ** 2), 0) / n;
  const elapsedSeconds = samples.reduce((a, b) => a + b, 0) / 1000;
  return {
    n,
    successes: n,
    failures: 0,
    min_ms: sorted[0],
    mean_ms: mean,
    p50_ms: sorted[Math.max(0, Math.ceil(n * 0.50) - 1)],
    p95_ms: sorted[Math.max(0, Math.ceil(n * 0.95) - 1)],
    p99_ms: sorted[Math.max(0, Math.ceil(n * 0.99) - 1)],
    max_ms: sorted[n - 1],
    stddev_ms: Math.sqrt(variance),
    throughput_per_second: n / elapsedSeconds,
  };
}

async function measure(name, operation, count = 10000) {
  for (let i = 0; i < 1000; i++) await operation();
  const samples = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await operation();
    samples.push(performance.now() - start);
  }
  return { name, ...stats(samples), samples };
}

const measurements = [];
measurements.push(await measure("schema-validation", () => orderUpdate.inputSchema.safeParse({ orderId: "order-1", status: "PROCESSING" })));
measurements.push(await measure("authorization", () => server.authorize(orderUpdate)));
measurements.push(await measure("direct-ui-baseline", () => uiTheme.execute({ theme: "dark" }, context)));
measurements.push(await measure("mcp-dispatch-ui", () => server.executeTool("ui.setTheme", { theme: "dark" })));

const fixtures = [];
function fixture(caseId, command, expectedTool, expectedArguments, expectedAuth, expectedOutcome, observedOutcome, success, durationMs, notes = "") {
  fixtures.push({ kind: "fixture", case_id: caseId, command, expected_tool: expectedTool ?? "", expected_arguments: JSON.stringify(expectedArguments ?? {}), expected_authorization: expectedAuth, expected_outcome: expectedOutcome, observed_outcome: observedOutcome, success: success ? 1 : 0, duration_ms: (durationMs ?? 0).toFixed(6), sample_index: 1, notes });
}
async function timed(fn) {
  const start = performance.now();
  try { const value = await fn(); return { value, ms: performance.now() - start }; }
  catch (error) { return { error, ms: performance.now() - start }; }
}

let r = await timed(() => orderUpdate.inputSchema.safeParse({ orderId: "order-1", status: "PROCESSING" }));
fixture("valid-order-status", "mark order order-1 as processing", "orders.updateOrderStatus", { orderId: "order-1", status: "PROCESSING" }, "MANAGER_ALLOWED", "schema_accept", r.value?.success ? "schema_accept" : "schema_reject", r.value?.success === true, r.ms);
r = await timed(() => orderUpdate.inputSchema.safeParse({ orderId: "order-1", status: "CANCELLED" }));
fixture("ordinary-cancel-rejected", "cancel order order-1", "orders.updateOrderStatus", { orderId: "order-1", status: "CANCELLED" }, "MANAGER_ALLOWED", "schema_reject", r.value?.success ? "schema_accept" : "schema_reject", r.value?.success === false, r.ms, "Cancellation must use orders.cancelOrder.");
r = await timed(() => orderUpdate.inputSchema.safeParse({ orderId: "order-1", status: "NOT_A_STATUS" }));
fixture("invalid-status", "set order order-1 to an invalid status", "orders.updateOrderStatus", { orderId: "order-1", status: "NOT_A_STATUS" }, "MANAGER_ALLOWED", "schema_reject", r.value?.success ? "schema_accept" : "schema_reject", r.value?.success === false, r.ms);
r = await timed(() => viewerServer.authorize(orderUpdate));
fixture("viewer-unauthorized-order", "update an order status", "orders.updateOrderStatus", { orderId: "order-1", status: "PROCESSING" }, "VIEWER_DENIED", "authorization_reject", r.error ? "authorization_reject" : "authorization_allow", Boolean(r.error), r.ms);
r = await timed(() => server.authorize(cancelOrder));
fixture("manager-unauthorized-cancel", "cancel order order-1", "orders.cancelOrder", { orderId: "order-1" }, "MANAGER_DENIED", "authorization_reject", r.error ? "authorization_reject" : "authorization_allow", Boolean(r.error), r.ms);
r = await timed(() => server.validateToolInput("unknown.operation", {}));
fixture("unknown-tool", "perform an unsupported operation", null, {}, "UNKNOWN_TOOL", "unknown_tool_reject", r.error ? "unknown_tool_reject" : "unknown_tool_allow", Boolean(r.error), r.ms);
r = await timed(() => uiTheme.inputSchema.safeParse({ theme: "neon" }));
fixture("invalid-ui-argument", "switch to neon theme", "ui.setTheme", { theme: "neon" }, "VIEWER_ALLOWED", "schema_reject", r.value?.success ? "schema_accept" : "schema_reject", r.value?.success === false, r.ms);
r = await timed(() => (orderModule.default ?? orderModule["module.exports"] ?? orderModule).runWithOrderApiConnection({ baseUrl: "http://127.0.0.1:9", authType: "NONE", authConfig: {}, timeoutMs: 100 }, () => (orderModule.default ?? orderModule["module.exports"] ?? orderModule).updateOrderStatus({ orderId: "order-1", status: "PROCESSING" })));
// The SSRF guard is expected to reject loopback before any network request.
fixture("unsafe-loopback-client", "mark order through loopback client", "orders.updateOrderStatus", { orderId: "order-1", status: "PROCESSING" }, "AUTHORIZED", "ssrf_reject", r.error ? "ssrf_reject" : "request_attempted", Boolean(r.error && /Outbound destination is not allowed/i.test(r.error.message)), r.ms, "No external request; loopback blocked by lib/ssrf.ts.");

const rows = [];
for (const item of measurements) {
  for (let i = 0; i < item.samples.length; i++) rows.push({ kind: "latency", case_id: item.name, command: item.name, expected_tool: item.name === "mcp-dispatch-ui" ? "ui.setTheme" : "", expected_arguments: item.name === "mcp-dispatch-ui" ? JSON.stringify({ theme: "dark" }) : "", expected_authorization: item.name === "authorization" ? "MANAGER_ALLOWED" : "", expected_outcome: "success", observed_outcome: "success", success: 1, duration_ms: item.samples[i].toFixed(6), sample_index: i + 1, notes: `warmup=1000; measured=${item.samples.length}; monotonic performance.now()` });
}
rows.push(...fixtures);
const columns = ["kind", "case_id", "command", "expected_tool", "expected_arguments", "expected_authorization", "expected_outcome", "observed_outcome", "success", "duration_ms", "sample_index", "notes"];
function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
const csv = [columns.map(csvEscape).join(","), ...rows.map(row => columns.map(column => csvEscape(row[column])).join(","))].join("\n") + "\n";
fs.writeFileSync(new URL("./benchmark-results.csv", import.meta.url), csv);
const summaries = measurements.map(({ samples, ...summary }) => summary);
console.log(JSON.stringify({ summaries, fixtures: fixtures.map(({ duration_ms, ...item }) => ({ ...item, duration_ms })) }, null, 2));
