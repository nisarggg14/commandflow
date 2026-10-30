const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const evaluator = require("../scripts/evaluate-commandflow-dataset.js");
const runner = require("../scripts/run-gemini-evaluation.js");

const cases = [
  { id: "mock-1", utterance: "Show products", role: "VIEWER" },
  { id: "mock-2", utterance: "Malformed", role: "VIEWER" },
  { id: "mock-3", utterance: "Empty", role: "VIEWER" },
  { id: "mock-4", utterance: "Provider failure", role: "VIEWER" },
  { id: "mock-5", utterance: "Unknown tool", role: "VIEWER" },
  { id: "mock-6", utterance: "Invalid action", role: "VIEWER" },
  { id: "mock-7", utterance: "Clarify", role: "VIEWER" },
];

async function main() {
  assert.equal(runner.normalizeModelName("models/gemini-test"), "gemini-test");
  assert.match(runner.evaluationPrompt(cases[0]), /Role: VIEWER/);
  assert.match(runner.evaluationPrompt(cases[0]), /Show products/);

  let callCount = 0;
  let dispatched = false;
  const outputs = [
    '{"tool":"products.getProducts","arguments":{}}',
    "not json",
    "",
    new Error("mock provider failure"),
    '{"tool":"made.up.tool","arguments":{}}',
    '{"tool":"products.getProducts","arguments":{},"action":"run"}',
    '{"action":"unknown"}',
  ];
  const result = await runner.runEvaluation({
    dataset: { cases },
    runId: "mock-run",
    client: {
      async generate(prompt) {
        assert.match(prompt, /Do not execute tools/);
        assert.equal(dispatched, false);
        const value = outputs[callCount++];
        if (value instanceof Error) throw value;
        return { text: value };
      },
    },
  });

  assert.equal(callCount, cases.length);
  assert.equal(dispatched, false);
  assert.equal(result.predictions.length, cases.length);
  assert.equal(result.counts.totalCases, 7);
  assert.equal(result.counts.successfulModelResponses, 6);
  assert.equal(result.counts.providerFailures, 1);
  assert.equal(result.counts.malformedResponses, 2);
  assert.equal(result.counts.invalidActionFields, 1);
  assert.equal(result.counts.unknownOutcomeResponses, 0);
  assert.equal(result.predictions[4].output.tool, "made.up.tool");
  assert.equal(result.predictions[5].responseStatus, "parsed_response");
  assert.equal(result.predictions[5].parserCategory, "invalid_action_field");
  assert.equal(result.predictions[6].parserCategory, "unknown_action");
  assert.equal(result.predictions[3].providerFailure, true);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "commandflow-gemini-runner-"));
  try {
    runner.writeArtifacts(result, tempDir, { model: "gemini-test" });
    const saved = JSON.parse(fs.readFileSync(path.join(tempDir, "predictions.json"), "utf8"));
    assert.deepEqual(saved.runs[0].predictions.map(p => p.id), cases.map(c => c.id));
    assert.equal(JSON.parse(fs.readFileSync(path.join(tempDir, "metadata.json"), "utf8")).noToolExecution, true);
    assert.match(fs.readFileSync(path.join(tempDir, "summary.md"), "utf8"), /Provider failures: 1/);

    const secretResult = {
      ...result,
      predictions: [{ id: "secret", output: { token: "AIza123456789012345678901234" } }],
      rawResponses: [{ id: "secret", rawText: "Authorization: Bearer super-secret-value" }],
    };
    runner.writeArtifacts(secretResult, tempDir, { model: "gemini-test" });
    const artifactText = ["predictions.json", "raw-responses.json", "metadata.json", "summary.md"]
      .map(file => fs.readFileSync(path.join(tempDir, file), "utf8"))
      .join("\n");
    assert.doesNotMatch(artifactText, /AIza123456789012345678901234|super-secret-value/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  assert.throws(() => runner.createGeminiClient({ apiKey: "" }), /GEMINI_API_KEY is required/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "scripts", "run-gemini-evaluation.js"), "utf8"), /require\(["'][^"']*(mcp|prisma)/i);
  assert.equal(evaluator.classifyRawOutput({ tool: "made.up.tool", arguments: {} }).category, "tool_selection");
  console.log("✔ mocked Gemini runner remains model-only and records all failure categories");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
