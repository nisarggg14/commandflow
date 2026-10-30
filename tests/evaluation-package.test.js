const test = require("node:test");
const assert = require("node:assert/strict");
const evaluator = require("../scripts/evaluate-commandflow-dataset.js");

test("deepEqual ignores object key order but preserves nested arrays and types", () => {
  assert.equal(evaluator.deepEqual({ a: { x: 1, y: ["z", { q: true }] }, b: 2 }, { b: 2, a: { y: ["z", { q: true }], x: 1 } }), true);
  assert.equal(evaluator.deepEqual({ values: [1, 2] }, { values: [2, 1] }), false);
  assert.equal(evaluator.deepEqual({ value: 1 }, { value: "1" }), false);
  assert.equal(evaluator.deepEqual({ value: null }, {}), false);
  assert.equal(evaluator.deepEqual({ value: 1 }, { value: 1, extra: true }), false);
  assert.equal(evaluator.deepEqual({ value: 1 }, { value: 2 }), false);
});

test("schema audit recognizes valid, invalid, and unknown expected inputs", () => {
  assert.equal(evaluator.schemaCheck("products.getProducts", { limit: 20, offset: 0 }).valid, true);
  assert.equal(evaluator.schemaCheck("products.getProducts", { limit: 101 }).valid, false);
  assert.equal(evaluator.schemaCheck("products.searchProducts", { color: "black" }).valid, true);
  assert.equal(evaluator.schemaCheck("frontend.updateBackground", { background: "paper", extra: true }).valid, false);
  assert.equal(evaluator.schemaCheck("orders.updateOrderStatus", { orderId: "ORD-1", status: "CANCELLED" }).valid, false);
  assert.equal(evaluator.schemaCheck("made.up.tool", {}).reason, "unknown_tool");
});

test("tool selection requires the real parser category, not only a matching tool name", () => {
  assert.equal(evaluator.classifyRawOutput({ tool: "products.getProducts", arguments: {}, action: "unknown" }).category, "unknown_outcome");
  assert.equal(evaluator.classifyRawOutput({ tool: "products.getProducts", arguments: {} }).category, "tool_selection");
  assert.equal(evaluator.classifyRawOutput({ action: "unknown" }).category, "unknown_action");
  assert.equal(evaluator.classifyRawOutput({ action: "clarify" }).category, "malformed_output");
  assert.equal(evaluator.classifyRawOutput({ tool: "products.getProducts" }).category, "malformed_output");
  const result = evaluator.scoreRun({ runId: "category-regression", predictions: [
    { id: "P-001", output: { tool: "products.getProducts", arguments: {}, action: "clarify" } },
  ] });
  assert.equal(result.toolSelection.correct, 0);
  assert.equal(result.perTool["products.getProducts"].tp, 0);
  assert.equal(result.perTool["products.getProducts"].fp, 0);
  assert.equal(result.invalidActionFields, 1);
  assert.equal(result.parserFailures, 1);
});

test("failure accounting separates provider, malformed, missing, and scored responses", () => {
  const result = evaluator.scoreRun({
    runId: "offline-accounting",
    predictions: [
      { id: "P-001", output: { tool: "products.getProducts", arguments: {} } },
      { id: "P-002", providerFailure: true },
      { id: "P-003", output: "not-json-object" },
      { id: "X-001", output: { tool: "made.up.tool", arguments: {} } },
    ],
  });
  assert.equal(result.totalCases, 63);
  assert.equal(result.successfulModelResponses, 3);
  assert.equal(result.providerFailures, 1);
  assert.equal(result.malformedResponses, 1);
  assert.equal(result.missingUnrun, 59);
  assert.equal(result.toolSelection.denominator, 2);
  assert.equal(result.exactArguments.denominator, 2);
  assert.equal(result.unknownToolPredictions, 1);
  assert.equal(result.perTool["products.getProducts"].tp, 1);
});

test("registered-tool TP FP FN and macro-F1 are computed independently of unknown tools", () => {
  const result = evaluator.scoreRun({
    runId: "offline-confusion",
    predictions: [
      { id: "P-001", output: { tool: "products.getProducts", arguments: {} } },
      { id: "P-016", output: { tool: "products.getProducts", arguments: {} } },
      { id: "X-001", output: { tool: "made.up.tool", arguments: {} } },
    ],
  });
  assert.deepEqual(result.perTool["products.getProducts"], { tp: 1, fp: 1, fn: 0, goldCases: 3, eligibleGoldCases: 1, excludedGoldCases: 2, precision: 0.5, recall: 1, f1: 2 / 3 });
  assert.equal(result.perTool["analytics.inventorySummary"].fn, 1);
  assert.equal(result.unknownToolPredictions, 1);
  assert.equal(typeof result.macroF1, "number");
});

test("zero-denominator tools remain visible with zero metrics", () => {
  const result = evaluator.scoreRun({ runId: "zero-denominator", predictions: [] });
  const tool = result.perTool["frontend.updateBranding"];
  assert.deepEqual(tool, { tp: 0, fp: 0, fn: 0, goldCases: 1, eligibleGoldCases: 0, excludedGoldCases: 1, precision: 0, recall: 0, f1: 0 });
  const neverSeen = result.perTool["analytics.inventorySummary"];
  assert.equal(neverSeen.tp, 0);
  assert.equal(neverSeen.fp, 0);
  assert.equal(neverSeen.fn, 0);
  assert.equal(neverSeen.precision, 0);
  assert.equal(neverSeen.recall, 0);
  assert.equal(neverSeen.f1, 0);
});

test("server safety scoring is opt-in and does not turn rejection into parser success", () => {
  const result = evaluator.scoreRun({
    runId: "offline-safety",
    predictions: [
      { id: "P-005", output: { tool: "products.searchProducts", arguments: { name: "hoodie", minimumStock: 5, color: "black" } }, serverOutcome: "validated_authorized" },
      { id: "P-022", output: { tool: "products.updateStock", arguments: { productId: "P1002", stock: -4 } }, serverOutcome: "schema_rejection" },
    ],
  });
  assert.equal(result.serverSafety.observedStageScored, 2);
  assert.equal(result.serverSafety.observedStageCorrect, 2);
  assert.equal(result.serverSafety.predictedStageCorrect, 2);
  assert.equal(result.perTool["products.searchProducts"].tp, 1);
  const p022 = result.rows.find((row) => row.id === "P-022");
  assert.equal(p022.serverExpected, "schema_rejection");
  assert.equal(p022.serverPredicted, "schema_rejection");
});

test("server stage uses predicted arguments and role, not only gold arguments", () => {
  const result = evaluator.scoreRun({
    runId: "server-prediction-regression",
    predictions: [
      { id: "P-022", output: { tool: "products.updateStock", arguments: { productId: "P1002", stock: 4 } } },
      { id: "O-005", output: { tool: "orders.cancelOrder", arguments: { orderId: "ORD-5002" } } },
      { id: "P-014", output: { tool: "products.deleteProduct", arguments: { productId: "P1002" } } },
    ],
  });
  assert.equal(result.rows.find((row) => row.id === "P-022").serverExpected, "schema_rejection");
  assert.equal(result.rows.find((row) => row.id === "P-022").serverPredicted, "validated_authorized");
  assert.equal(result.rows.find((row) => row.id === "O-005").serverExpected, "authorization_denied");
  assert.equal(result.rows.find((row) => row.id === "O-005").serverPredicted, "authorization_denied");
  assert.equal(result.rows.find((row) => row.id === "P-014").serverPredicted, "approval_required");
  assert.equal(result.exactArguments.correct, 2);
  assert.equal(result.exactArguments.denominator, 3);
});

test("partial repeated runs do not turn missing cases into robustness failures", () => {
  const report = evaluator.buildReport({ runs: [
    { runId: "r1", predictions: [{ id: "P-001", output: { tool: "products.getProducts", arguments: {} } }] },
    { runId: "r2", predictions: [{ id: "P-001", output: { tool: "products.getProducts", arguments: {} } }, { id: "P-002", output: { tool: "products.getProducts", arguments: {} } }] },
  ] });
  assert.equal(report.robustness.status, "not_measured");
  assert.equal(report.robustness.perCase["P-001"].status, "measured");
  assert.equal(report.robustness.perCase["P-001"].eligibleRepetitions, 2);
  assert.equal(report.robustness.perCase["P-002"].status, "not_measured");
  assert.equal(report.robustness.perCase["P-002"].eligibleRepetitions, 1);
  assert.equal(report.robustness.perCase["P-003"].eligibleRepetitions, 0);
});
