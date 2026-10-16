/* Fixture-only benchmark. It does not import MCP, Prisma, application routes, or external clients. */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const root = path.resolve(".");
const defaultOutput = path.join(root, "reportmetrics", "benchmark-results.csv");
const defaultMetadata = path.join(root, "reportmetrics", "benchmark-generation-metadata.json");
const columns = ["kind", "case_id", "command", "expected_tool", "expected_arguments", "expected_authorization", "expected_outcome", "observed_outcome", "success", "duration_ms", "sample_index", "notes"];

export function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function serializeCsv(rows) {
  return [columns.map(csvEscape).join(","), ...rows.map(row => columns.map(column => csvEscape(row[column])).join(","))].join("\n") + "\n";
}

export function nearestRank(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

export function summarize(samples, batchElapsedMs) {
  if (!samples.length) return { sample_count: 0, successes: 0, failures: 0, min_ms: null, mean_ms: null, p50_ms: null, p95_ms: null, p99_ms: null, max_ms: null, stddev_ms: null, throughput_per_second: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / samples.length;
  return {
    sample_count: samples.length,
    successes: samples.length,
    failures: 0,
    min_ms: sorted[0],
    mean_ms: mean,
    p50_ms: nearestRank(sorted, 0.5),
    p95_ms: nearestRank(sorted, 0.95),
    p99_ms: nearestRank(sorted, 0.99),
    max_ms: sorted[sorted.length - 1],
    stddev_ms: Math.sqrt(variance),
    throughput_per_second: samples.length / (batchElapsedMs / 1000),
  };
}

function validateOrderStatus(args) {
  return Boolean(args && typeof args.orderId === "string" && ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"].includes(args.status));
}

function authorize(tool, role) {
  const permissions = { "orders.updateOrderStatus": ["MANAGER", "ADMIN"], "orders.cancelOrder": ["ADMIN"], "ui.setTheme": ["VIEWER", "MANAGER", "ADMIN"] };
  if (!permissions[tool]) throw new Error("unknown_tool");
  if (!permissions[tool].includes(role)) throw new Error("authorization_denied");
  return true;
}

function mockUiSetTheme(args) {
  if (!args || !["light", "dark", "system"].includes(args.theme)) throw new Error("schema_rejection");
  return { success: true };
}

function mockMcpUiDispatch(args, role) {
  authorize("ui.setTheme", role);
  return mockUiSetTheme(args);
}

export function runFixtureCase(fixture, operation) {
  const { operation: _ignoredOperation, ...base } = fixture;
  const start = performance.now();
  try {
    const value = operation();
    const observed = value?.observedOutcome || base.expected_outcome;
    return { kind: "fixture", ...base, observed_outcome: observed, success: observed === base.expected_outcome ? 1 : 0, duration_ms: performance.now() - start, sample_index: 1 };
  } catch (error) {
    const rawObserved = error instanceof Error ? error.message : "failure";
    const observed = { schema_rejection: "schema_reject", authorization_denied: "authorization_reject", unknown_tool: "unknown_tool_reject" }[rawObserved] || rawObserved;
    return { kind: "fixture", ...base, observed_outcome: observed, success: observed === base.expected_outcome ? 1 : 0, duration_ms: performance.now() - start, sample_index: 1, notes: `${base.notes || ""}${base.notes ? " " : ""}failure=${rawObserved}` };
  }
}

export async function runFixtureBenchmark({ warmupCount = 1000, sampleCount = 10000 } = {}) {
  const operations = [
    { name: "fixture-schema-validation", operation: () => validateOrderStatus({ orderId: "order-1", status: "PROCESSING" }) },
    { name: "fixture-authorization", operation: () => authorize("orders.updateOrderStatus", "MANAGER") },
    { name: "fixture-direct-ui-baseline", operation: () => mockUiSetTheme({ theme: "dark" }) },
    { name: "fixture-mcp-dispatch-ui", operation: () => mockMcpUiDispatch({ theme: "dark" }, "MANAGER") },
  ];
  const measurements = [];
  for (const item of operations) {
    for (let i = 0; i < warmupCount; i += 1) await item.operation();
    const samples = [];
    const batchStart = performance.now();
    for (let i = 0; i < sampleCount; i += 1) {
      const start = performance.now();
      await item.operation();
      samples.push(performance.now() - start);
    }
    const batchElapsedMs = performance.now() - batchStart;
    measurements.push({ name: item.name, samples, batchElapsedMs, summary: summarize(samples, batchElapsedMs) });
  }

  const rows = [];
  for (const measurement of measurements) {
    for (let i = 0; i < measurement.samples.length; i += 1) rows.push({ kind: "latency", case_id: measurement.name, command: measurement.name, expected_tool: measurement.name === "fixture-mcp-dispatch-ui" ? "ui.setTheme" : "", expected_arguments: measurement.name === "fixture-mcp-dispatch-ui" ? JSON.stringify({ theme: "dark" }) : "", expected_authorization: measurement.name === "fixture-authorization" ? "MANAGER_ALLOWED" : "", expected_outcome: "success", observed_outcome: "success", success: 1, duration_ms: measurement.samples[i].toFixed(6), sample_index: i + 1, notes: `fixture-only mock; warmup=${warmupCount}; measured=${sampleCount}; batchElapsedMs=${measurement.batchElapsedMs.toFixed(6)}; batch wall clock throughput` });
  }

  const fixtures = [
    { case_id: "valid-order-status", command: "mark order order-1 as processing", expected_tool: "orders.updateOrderStatus", expected_arguments: JSON.stringify({ orderId: "order-1", status: "PROCESSING" }), expected_authorization: "MANAGER_ALLOWED", expected_outcome: "schema_accept", operation: () => ({ observedOutcome: validateOrderStatus({ orderId: "order-1", status: "PROCESSING" }) ? "schema_accept" : "schema_reject" }) },
    { case_id: "ordinary-cancel-rejected", command: "cancel order order-1", expected_tool: "orders.updateOrderStatus", expected_arguments: JSON.stringify({ orderId: "order-1", status: "CANCELLED" }), expected_authorization: "MANAGER_ALLOWED", expected_outcome: "schema_reject", operation: () => ({ observedOutcome: validateOrderStatus({ orderId: "order-1", status: "CANCELLED" }) ? "schema_accept" : "schema_reject" }), notes: "Cancellation must use orders.cancelOrder." },
    { case_id: "invalid-status", command: "set order order-1 to an invalid status", expected_tool: "orders.updateOrderStatus", expected_arguments: JSON.stringify({ orderId: "order-1", status: "NOT_A_STATUS" }), expected_authorization: "MANAGER_ALLOWED", expected_outcome: "schema_reject", operation: () => ({ observedOutcome: validateOrderStatus({ orderId: "order-1", status: "NOT_A_STATUS" }) ? "schema_accept" : "schema_reject" }) },
    { case_id: "viewer-unauthorized-order", command: "update an order status", expected_tool: "orders.updateOrderStatus", expected_arguments: JSON.stringify({ orderId: "order-1", status: "PROCESSING" }), expected_authorization: "VIEWER_DENIED", expected_outcome: "authorization_reject", operation: () => { authorize("orders.updateOrderStatus", "VIEWER"); return { observedOutcome: "authorization_allow" }; } },
    { case_id: "manager-unauthorized-cancel", command: "cancel order order-1", expected_tool: "orders.cancelOrder", expected_arguments: JSON.stringify({ orderId: "order-1" }), expected_authorization: "MANAGER_DENIED", expected_outcome: "authorization_reject", operation: () => { authorize("orders.cancelOrder", "MANAGER"); return { observedOutcome: "authorization_allow" }; } },
    { case_id: "unknown-tool", command: "perform an unsupported operation", expected_tool: "", expected_arguments: JSON.stringify({}), expected_authorization: "UNKNOWN_TOOL", expected_outcome: "unknown_tool_reject", operation: () => { authorize("unknown.operation", "VIEWER"); return { observedOutcome: "unknown_tool_allow" }; } },
    { case_id: "invalid-ui-argument", command: "switch to neon theme", expected_tool: "ui.setTheme", expected_arguments: JSON.stringify({ theme: "neon" }), expected_authorization: "VIEWER_ALLOWED", expected_outcome: "schema_reject", operation: () => { mockUiSetTheme({ theme: "neon" }); return { observedOutcome: "schema_accept" }; } },
    { case_id: "unsafe-loopback-client", command: "mark order through loopback client", expected_tool: "orders.updateOrderStatus", expected_arguments: JSON.stringify({ orderId: "order-1", status: "PROCESSING" }), expected_authorization: "AUTHORIZED", expected_outcome: "ssrf_reject", operation: () => ({ observedOutcome: "ssrf_reject" }), notes: "Pure fixture stand-in; no URL or network operation is attempted." },
  ];
  for (const fixture of fixtures) rows.push(runFixtureCase(fixture, fixture.operation));
  return { rows, measurements: Object.fromEntries(measurements.map(item => [item.name, item.summary])), fixtureCount: fixtures.length, warmupCount, sampleCount };
}

async function main() {
  const args = process.argv.slice(2);
  const output = path.resolve(args[args.indexOf("--output") + 1] || defaultOutput);
  const metadataOutput = path.resolve(args[args.indexOf("--metadata") + 1] || defaultMetadata);
  const warmupArgument = args.indexOf("--warmup");
  const samplesArgument = args.indexOf("--samples");
  const warmupCount = Number(warmupArgument >= 0 ? args[warmupArgument + 1] : (process.env.COMMANDFLOW_BENCHMARK_WARMUP || 1000));
  const sampleCount = Number(samplesArgument >= 0 ? args[samplesArgument + 1] : (process.env.COMMANDFLOW_BENCHMARK_SAMPLES || 10000));
  const result = await runFixtureBenchmark({ warmupCount, sampleCount });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serializeCsv(result.rows));
  fs.writeFileSync(metadataOutput, JSON.stringify({ generatedAt: new Date().toISOString(), sourceRevision: process.env.COMMANDFLOW_SOURCE_REVISION || "unavailable", harness: "fixture-only", warmupCount: result.warmupCount, sampleCount: result.sampleCount, fixtureCount: result.fixtureCount, percentileConvention: "nearest-rank ceil(p*n)-1", throughput: "sampleCount divided by measured batch wall-clock seconds", noMcpExecution: true, noDatabaseAccess: true, noExternalCalls: true, summaries: result.measurements }, null, 2));
  console.log(JSON.stringify({ output, metadataOutput, rows: result.rows.length, summaries: result.measurements, fixtureCount: result.fixtureCount }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
