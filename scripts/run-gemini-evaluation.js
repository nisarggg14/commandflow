/*
 * Model-only CommandFlow evaluation runner.
 *
 * This file deliberately does not import CommandFlow services, MCP registries,
 * dispatchers, Prisma, authentication, approval, or MFA code. Gemini output is
 * captured as untrusted data and is never executed.
 */
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { classifyRawOutput } = require("./evaluate-commandflow-dataset.js");

const root = path.resolve(__dirname, "..");
const defaultDatasetPath = path.join(root, "evaluation", "commandflow-eval-dataset.json");
const defaultModel = "gemini-2.5-flash";
const defaultOutputRoot = path.join(root, "evaluation-results");

function usage() {
  return [
    "CommandFlow isolated Gemini evaluation",
    "",
    "Offline commands:",
    "  node scripts/run-gemini-evaluation.js --help",
    "  node scripts/run-gemini-evaluation.js --dry-run",
    "  node scripts/run-gemini-evaluation.js --preflight",
    "",
    "Live command (requires explicit review and --live):",
    "  node scripts/run-gemini-evaluation.js --live",
    "",
    "Environment: GEMINI_API_KEY, GEMINI_MODEL, COMMANDFLOW_EVAL_DATASET,",
    "COMMANDFLOW_EVAL_RUN_ID, and COMMANDFLOW_EVAL_OUTPUT.",
  ].join("\n");
}

function normalizeModelName(model) {
  const trimmed = typeof model === "string" ? model.trim() : "";
  if (!trimmed) return defaultModel;
  return trimmed
    .replace(/^models\//i, "")
    .replace(/^publishers\/google\/models\//i, "")
    .replace(/^google\//i, "")
    .trim();
}

function evaluationPrompt(item) {
  return [
    "You are an isolated CommandFlow command interpreter benchmark.",
    "Interpret the request only. Do not execute tools, call APIs, access databases, or invent tool names.",
    "Return exactly one JSON object and no Markdown.",
    'For a tool request use: {"tool":"registered.tool.name","arguments":{}}.',
    'For an ambiguous, unsupported, unsafe, or insufficient request use: {"action":"unknown"}.',
    "The role is context for interpretation and must not be treated as permission to execute anything.",
    `Role: ${item.role}`,
    `User request: ${item.utterance}`,
  ].join("\n");
}

function parseModelText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { status: "malformed_response", output: null, reason: "empty_response" };
  }
  try {
    return { status: "parsed_response", output: JSON.parse(text), reason: "json_parsed" };
  } catch {
    return { status: "malformed_response", output: null, reason: "invalid_json" };
  }
}

function redactSecrets(value) {
  if (typeof value === "string") {
    return value
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/(api[_-]?key|authorization|token|secret|password)\s*([:=])\s*["']?[^,"'\s}]+/gi, "$1$2[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item)]));
  return value;
}

function responseText(response) {
  if (!response || typeof response !== "object") return "";
  if (typeof response.text === "string") return response.text;
  if (typeof response.text === "function") {
    const value = response.text();
    return typeof value === "string" ? value : "";
  }
  return "";
}

function createGeminiClient({ apiKey, model, ai } = {}) {
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("GEMINI_API_KEY is required for a live evaluation");
  }
  const client = ai || new GoogleGenAI({ apiKey });
  return {
    model: normalizeModelName(model),
    async generate(prompt) {
      return client.models.generateContent({
        model: normalizeModelName(model),
        contents: prompt,
      });
    },
  };
}

async function runEvaluation({ dataset, client, runId, generationSettings = {} }) {
  if (!dataset || !Array.isArray(dataset.cases)) throw new Error("Dataset must contain a cases array");
  if (!client || typeof client.generate !== "function") throw new Error("A Gemini client with generate(prompt) is required");

  const predictions = [];
  const rawResponses = [];
  let providerFailures = 0;
  let parsedResponses = 0;
  let malformedResponses = 0;
  let invalidActionFields = 0;
  let unknownOutcomeResponses = 0;

  for (const item of dataset.cases) {
    const startedAt = new Date().toISOString();
    const prompt = evaluationPrompt(item);
    try {
      const response = await client.generate(prompt);
      const text = responseText(response);
      const parsed = parseModelText(text);
      if (parsed.status === "parsed_response") parsedResponses += 1;
      else malformedResponses += 1;
      const parserCategory = parsed.output === null ? "malformed_output" : classifyRawOutput(parsed.output).category;
      if (parserCategory === "invalid_action_field") invalidActionFields += 1;
      if (parserCategory === "unknown_outcome") unknownOutcomeResponses += 1;
      predictions.push({
        id: item.id,
        output: parsed.output,
        providerFailure: false,
        responseStatus: parsed.status,
        responseReason: parsed.reason,
        parserCategory,
      });
      rawResponses.push({
        id: item.id,
        role: item.role,
        utterance: item.utterance,
        prompt,
        status: parsed.status,
        reason: parsed.reason,
        parserCategory,
        rawText: text,
        startedAt,
        responseMetadata: response && typeof response === "object" ? (response.usageMetadata || null) : null,
      });
    } catch (error) {
      providerFailures += 1;
      predictions.push({
        id: item.id,
        providerFailure: true,
        responseStatus: "provider_failure",
        responseReason: "provider_request_failed",
      });
      rawResponses.push({
        id: item.id,
        role: item.role,
        utterance: item.utterance,
        prompt,
        status: "provider_failure",
        reason: "provider_request_failed",
        errorType: error && error.constructor ? error.constructor.name : "unknown_error",
        startedAt,
        responseMetadata: null,
      });
    }
  }

  return {
    runId: runId || `gemini-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    predictions,
    rawResponses,
    counts: {
      totalCases: dataset.cases.length,
      successfulModelResponses: dataset.cases.length - providerFailures,
      parsedResponses,
      malformedResponses,
      invalidActionFields,
      unknownOutcomeResponses,
      providerFailures,
      missingUnrun: 0,
    },
    generationSettings,
  };
}

function writeArtifacts(result, outputDirectory, metadata = {}) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const predictionsFile = {
    runs: [{ runId: result.runId, predictions: redactSecrets(result.predictions) }],
  };
  fs.writeFileSync(path.join(outputDirectory, "predictions.json"), JSON.stringify(predictionsFile, null, 2));
  fs.writeFileSync(path.join(outputDirectory, "raw-responses.json"), JSON.stringify(redactSecrets({ runId: result.runId, responses: result.rawResponses }), null, 2));
  fs.writeFileSync(path.join(outputDirectory, "metadata.json"), JSON.stringify({
    runId: result.runId,
    createdAt: new Date().toISOString(),
    model: metadata.model || null,
    generationSettings: result.generationSettings,
    attemptCount: result.rawResponses.length,
    counts: result.counts,
    noToolExecution: true,
    noDatabaseAccess: true,
    noMcpImports: true,
  }, null, 2));
  const summary = [
    `# Gemini evaluation run ${result.runId}`,
    "",
    "Status: captured model responses only; evaluator scoring must be run separately.",
    "",
    `- Total cases: ${result.counts.totalCases}`,
    `- Parsed responses: ${result.counts.parsedResponses}`,
    `- Malformed responses: ${result.counts.malformedResponses}`,
    `- Invalid action fields: ${result.counts.invalidActionFields}`,
    `- Unknown outcomes: ${result.counts.unknownOutcomeResponses}`,
    `- Provider failures: ${result.counts.providerFailures}`,
    `- Missing/unrun cases: ${result.counts.missingUnrun}`,
    "- MCP/tool execution: none",
    "- Database access: none",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outputDirectory, "summary.md"), summary);
}

function loadDataset(datasetPath = defaultDatasetPath) {
  return JSON.parse(fs.readFileSync(datasetPath, "utf8"));
}

function datasetAudit(dataset) {
  const ids = dataset.cases.map(item => item.id);
  const expectedTools = new Set(dataset.cases.filter(item => item.expected && item.expected.tool).map(item => item.expected.tool));
  return {
    cases: dataset.cases.length,
    uniqueCaseIds: new Set(ids).size === ids.length,
    expectedToolLabels: expectedTools.size,
    hasAllCaseFields: dataset.cases.every(item => item.id && item.utterance && item.role && item.expected),
  };
}

function isolationAudit() {
  const source = fs.readFileSync(__filename, "utf8");
  const implementation = source
    .replace(/function isolationAudit\(\) \{[\s\S]*?\n\}\n\nfunction preflight/, "function preflight")
    .replace(/function preflight\([\s\S]*?\n\}\n\nfunction dryRun/, "function dryRun");
  return {
    forbiddenImportsAbsent: !/require\(["'][^"']*(?:mcp|prisma|database|approval|mfa)/i.test(implementation),
    dispatchCallsAbsent: !/executeTool|dispatchTool|callTool/i.test(implementation),
    functionCallingAbsent: !/functionDeclarations|toolConfig|function_call/i.test(implementation),
    apiKeyNotPrinted: !/console\.(log|error)\([^\n]*GEMINI_API_KEY/i.test(implementation),
    retriesNotImplemented: !/\b(?:retry|retries|backoff)\b/i.test(implementation),
  };
}

function preflight({ datasetPath = defaultDatasetPath, outputRoot = defaultOutputRoot, env = process.env } = {}) {
  const dataset = loadDataset(datasetPath);
  const audit = datasetAudit(dataset);
  const isolation = isolationAudit();
  const checks = [
    { name: "dataset_has_63_cases", status: audit.cases === 63 ? "PASS" : "FAIL", detail: `${audit.cases} cases` },
    { name: "dataset_case_ids_unique", status: audit.uniqueCaseIds ? "PASS" : "FAIL", detail: "IDs are unique" },
    { name: "dataset_case_structure", status: audit.hasAllCaseFields ? "PASS" : "FAIL", detail: "required fields present" },
    { name: "isolated_import_graph", status: isolation.forbiddenImportsAbsent ? "PASS" : "FAIL", detail: "no MCP/database/security imports" },
    { name: "tool_dispatch_absent", status: isolation.dispatchCallsAbsent ? "PASS" : "FAIL", detail: "no dispatch calls" },
    { name: "function_calling_absent", status: isolation.functionCallingAbsent ? "PASS" : "FAIL", detail: "no callable tool declarations" },
    { name: "api_key_not_printed", status: isolation.apiKeyNotPrinted ? "PASS" : "FAIL", detail: "key is never printed" },
    { name: "no_automatic_retries", status: isolation.retriesNotImplemented ? "PASS" : "FAIL", detail: "one attempt per case" },
    { name: "output_directory_ignored", status: fs.readFileSync(path.join(root, ".gitignore"), "utf8").includes("/evaluation-results/") ? "PASS" : "FAIL", detail: outputRoot },
    { name: "configured_model", status: "PASS", detail: normalizeModelName(env.GEMINI_MODEL) },
    { name: "api_key_presence", status: env.GEMINI_API_KEY ? "PASS" : "BLOCKED", detail: env.GEMINI_API_KEY ? "present (value withheld)" : "missing (value withheld)" },
    { name: "request_count_policy", status: "PASS", detail: "one recorded attempt per case by default" },
  ];
  const report = [
    "# CommandFlow Gemini evaluation preflight",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This report is offline-only. No Gemini request, MCP execution, database access, approval, or MFA operation was performed.",
    "",
    "| Check | Status | Detail |",
    "|---|---|---|",
    ...checks.map(check => `| ${check.name} | ${check.status} | ${check.detail} |`),
    "",
    `Dataset expected-tool label coverage observed in this audit: ${audit.expectedToolLabels}. Full registered-tool coverage remains validated by the existing evaluator command.`,
    "",
  ].join("\n");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, "preflight-report.md"), report);
  return { checks, reportPath: path.join(outputRoot, "preflight-report.md") };
}

function dryRun({ datasetPath = defaultDatasetPath } = {}) {
  const dataset = loadDataset(datasetPath);
  const audit = datasetAudit(dataset);
  return {
    mode: "dry-run",
    datasetPath,
    cases: audit.cases,
    plannedAttempts: audit.cases,
    model: normalizeModelName(process.env.GEMINI_MODEL),
    apiRequestMade: false,
    toolExecution: false,
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(dryRun(), null, 2));
    return;
  }
  if (process.argv.includes("--preflight")) {
    const result = preflight();
    console.log(JSON.stringify({ reportPath: result.reportPath, checks: result.checks }, null, 2));
    return;
  }
  if (!process.argv.includes("--live")) {
    throw new Error("Live Gemini evaluation is opt-in. Re-run with --live only after review.");
  }
  const datasetPath = process.env.COMMANDFLOW_EVAL_DATASET || defaultDatasetPath;
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const model = normalizeModelName(process.env.GEMINI_MODEL);
  const client = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY, model });
  const result = await runEvaluation({ dataset, client, runId: process.env.COMMANDFLOW_EVAL_RUN_ID, generationSettings: { model } });
  const outputDirectory = process.env.COMMANDFLOW_EVAL_OUTPUT || path.join(root, "evaluation-results", result.runId);
  writeArtifacts(result, outputDirectory, { model });
  console.log(JSON.stringify({ runId: result.runId, outputDirectory, counts: result.counts }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { normalizeModelName, usage, evaluationPrompt, parseModelText, redactSecrets, createGeminiClient, runEvaluation, writeArtifacts, loadDataset, datasetAudit, isolationAudit, preflight, dryRun };
