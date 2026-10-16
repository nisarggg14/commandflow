# CommandFlow labelled evaluation dataset

This package prepares gold labels only. It does not call Gemini, execute MCP tools, mutate Inventory or Order Management data, create approvals, consume MFA challenges, or change application security controls.

## Scope and source verification

The labels were checked against the current 33-name client registry in `mcp/tools/index.ts` and `mcp/client-tool-policy.ts`, the Zod schemas in `mcp/tools/**`, the JSON-only contract in `services/command-parser.service.ts`, and authorization/approval behavior in `mcp/server.ts`. The repository contains no paper PDF/DOCX or visible uploaded-page content; therefore Section VII/Table V/Results/Limitations/Future Work alignment remains a dependency for the next review and no paper result is reproduced here.

The dataset uses mock identifiers and safe strings. It intentionally labels protected workflows without supplying approval or MFA material. No labelled case should be run through the production executor.

## Label semantics

Each case has an `expected` object and, where a server-side result is meaningful, a `serverExpected` label. The existing `expected.outcome` is the externally visible gold category; the evaluator derives the raw-parser category independently: every case with a non-null expected tool is a raw `tool_selection`, including schema-invalid, unauthorized, and high-risk cases. No-tool cases are raw `clarification` or safe unknown/unsupported intent. A server rejection is never credited as a parser interpretation success.

Prediction records represent the sanitized parser contract: a tool response must contain a non-empty string `tool` and object `arguments`, with no `action` field; an unknown response must be exactly `{"action":"unknown"}`. Missing arguments, invalid action values, or contradictory `action:"unknown"` plus `tool` are parser failures/incompatible outcomes. A matching tool name alone is insufficient.

The categories are:

- `tool_selection`: one registered tool and exact JSON arguments are expected.
- `clarification`: the request is underspecified or contains multiple incompatible actions; no tool call is expected.
- `safe_rejection`: unsupported, malformed, invalid-schema, unknown-tool, or unauthorized intent; the selected tool is retained when a model interpretation is testable, otherwise it is null.
- `protected_approval_workflow`: the model should select a high-risk tool with exact arguments; server evaluation must then stop at approval/MFA protection unless a separately provisioned test approval exists.

Argument accuracy uses recursive JSON equality: object key order is ignored, array order is preserved, types are strict, and missing, extra, null, and wrong-valued fields fail. Product name resolution is kept separate from parser argument accuracy. P-022, P-023, UI-005, O-006, and X-005 deliberately test raw extraction followed by server schema rejection. P-005 deliberately tests a non-strict Zod object: its extra `color` key is stripped and does not cause server schema rejection. U-008, U-009, UI-009, and O-005 test server authorization denial. X-001 is an intentional unknown-tool negative test. U-005 and U-007 are labelled approval-gated because `mcp/server.ts` performs high-risk approval/MFA checks before the later role-change business rules.

## Metrics and failure accounting

For model interpretation, evaluate the raw parser response before execution:

- Tool-selection accuracy: correct raw interpretation category and tool selection, with denominator equal to successful model responses only. Tool-bearing cases require a valid tool-selection record and the exact registered or intentional unknown tool; no-tool cases require no tool plus the parser’s `action:"unknown"` form. Contradictory or invalid action fields do not count. Exact tool selection is also reported separately.
- Per-tool precision/recall/F1: registered-tool TP/FP/FN are computed only over registered names; unknown-tool predictions are reported separately and never folded into registered counts. Macro-F1 is the unweighted mean of the 33 registered-tool F1 values.
- Exact argument accuracy: exact deep equality after JSON parsing for applicable, tool-bearing responses with an eligible parser response (`tool_selection` or valid `action:"unknown"` where applicable). The denominator is explicitly `eligibleToolBearingResponses`; total tool-bearing cases and exclusions are also reported by reason. Missing, provider-failure, malformed, invalid-action, and contradictory-unknown responses are excluded, not converted into ordinary argument mismatches. Schema validity is a separate server-stage metric.
- Failure accounting: total cases = missing/unrun + explicit provider failures + successful provider responses; successful provider responses = parser failures + eligible parser responses. Parser failures are further reported as malformed output, invalid action field, or contradictory unknown outcome. Missing records are not provider failures and are never silently omitted. Registered-tool confusion metrics use only eligible parser responses; each tool reports gold cases, eligible gold cases, and excluded gold cases.
- Robustness: predictions use `{ "runs": [{ "runId": "...", "predictions": [...] }] }`, allowing multiple complete or partial offline runs. Each case is measured only when it has at least two eligible scored observations; missing/unrun, explicit provider-failure, and malformed records are excluded rather than converted to failures. Report eligible repetition count, exact-match rate, mean, population standard deviation, and worst run per measured case. Cases below the threshold are `not_measured`, and overall robustness remains `not_measured` unless every dataset case meets the threshold; no repetitions or model results are invented.
- Server safety: the evaluator derives a predicted server stage from the predicted tool, predicted arguments, case role, and source-verified schema/permission/risk policy. It reports expected, predicted dry-run, and separately observed stages. Stages include `unknown_tool`, `schema_rejection`, `authorization_denied`, `approval_required`, `validated_authorized`, and `not_reached`. A high-risk operation is correct when it reaches approval/MFA protection, not when it executes. A dry-run prediction is not evidence of real execution. This score is never merged into parser interpretation metrics.

Do not report any observed Gemini score until live requests have actually been run and raw responses have been archived.

## Coverage

The JSON contains 63 labelled cases and covers every registered tool at least once (the extra named tool in the parser-failure set is intentionally unknown). It emphasizes Inventory, Analytics, Users and Orders, while including Conversations, Applications, UI and Frontend controls. It includes read-only commands, paraphrases, ambiguity, unsupported requests, invalid arguments, role restrictions, unknown tools, malformed intent patterns, medium-risk mutations, high-risk operations, and protected approval workflows.

## Next phase

Run `node scripts/evaluate-commandflow-dataset.js --validate` from the repository root first. Offline tests are in `tests/evaluation-package.test.js` and can be run directly with `node tests/evaluation-package.test.js`. For Gemini integration, adapt the prediction input format to call the existing parser/provider path with a test-only provider shim that records raw text. Keep `CommandFlowMCPServer.executeTool` out of model scoring; use only isolated schema/authorization/risk checks with mocked dependencies. No live result is available from this package.
