# CommandFlow evaluation-package audit

Audit date: 2026-10-16. Scope: evaluation dataset, methodology, offline evaluator, and offline evaluator tests only.

## Verified source facts

- `mcp/tools/index.ts` and `mcp/client-tool-policy.ts` expose 33 registered client tool names.
- `services/command-parser.service.ts` accepts JSON with `tool` and object `arguments`, accepts `parameters` only as a compatibility fallback, and otherwise returns `action:"unknown"`.
- `mcp/server.ts` validates the selected tool schema, authorizes the role, evaluates risk, creates/validates high-risk approval, and then enforces MFA before execution. High-risk approval is therefore a protected pre-execution outcome even when a later tool-specific business rule would reject the operation.
- Existing MCP runtime, registry, connector, approval, and security tests were inspected. No live model or tool execution was performed for this audit.

## Dataset result

The original 63 case IDs were preserved. Validation reports 63 cases, coverage of all 33 registered tools, and one intentional unknown gold tool (`made.up.tool`) for `X-001`. The dataset contains mock identifiers only.

## Corrections

- `U-005`: `safe_rejection` → `protected_approval_workflow`; `serverExpected: approval_required`. Reason: `users.changeRole` is HIGH risk and approval/MFA precede its no-promotion-to-ADMIN business rule.
- `U-007`: `safe_rejection` → `protected_approval_workflow`; `serverExpected: approval_required`. Reason: the self-role business rule is reached after the same HIGH-risk gate.
- Added explicit server-stage labels for schema-invalid cases `P-005`, `P-022`, `P-023`, `UI-005`, `O-006`, and `X-005`; authorization-denied cases retain their separate server expectations.

## Evaluator corrections

- Provider failures require an explicit `providerFailure: true`; missing records are reported as `missingUnrun`.
- Accuracy denominators exclude provider failures and missing records but retain malformed provider responses as parser failures; every count is reported.
- Raw parser interpretation, exact arguments, registered-tool confusion metrics, unknown-tool counts, and server safety decisions are separate outputs.
- Recursive deep equality now ignores object-key order while preserving array order, types, missing/extra keys, nulls, and values.
- Multi-run input is supported through `{runs:[{runId,predictions:[]}]}`. Robustness remains `not_measured` until repeated predictions exist.
- Raw tool-selection scoring now rejects contradictory `action` fields, invalid action values, and missing/non-object arguments according to the parser contract; matching a tool name alone is insufficient.
- Server-stage prediction is derived from the predicted tool and arguments plus the case role and source policy. Expected, predicted, and separately recorded observed stages are reported independently.
- Per-case robustness uses only eligible scored observations, reports eligible repetition counts, and marks cases with fewer than two observations `not_measured`; missing cases are not failures.
- Exact-argument reports now expose total tool-bearing cases, eligible parser responses, and exclusions by missing/provider/malformed/action category. Per-tool rows expose gold, eligible, and excluded positive cases, including zero-denominator tools.
- `P-005` was corrected only at the server-stage label: `products.searchProducts` is a non-strict Zod object, so its extra `color` key is stripped rather than rejected. The case ID, request, and raw interpretation label remain unchanged.
- `--validate` checks IDs, structure, labels, explicit tool/argument fields, source-derived schema validity, permissions/risk-derived server labels, and full registered-tool coverage.

## Paper alignment

The paper/report figures are not interchangeable: the paper reports 60/60 automated tests and 63/63 scenarios; a later project test run reports 68/68 tests; the new dataset contains 63 labelled cases and has no model results. See `reportmetrics/evaluation/paper-metrics-comparison.md` for provenance and limitations. The paper PDF located outside the repository was not copied or edited.

## Remaining limitations

- The paper PDF/DOCX or visible uploaded paper page was not available in the workspace, so Section VII/Table V/Results/Limitations/Future Work alignment remains unverified.
- The evaluator contains a source-verified offline schema manifest; it does not import TypeScript tool factories, so future schema changes require rerunning this audit and updating the manifest.
- The static manifest now records which frontend schemas are strict and models Zod object stripping for non-strict schemas. It remains a manually audited mirror, not runtime execution of the application factories; future schema changes require rerunning this audit.
- Server safety scoring accepts recorded dry-run outcomes but does not invoke `CommandFlowMCPServer.executeTool`; a future isolated harness must provide mocked persistence and MFA/approval state.
- No Gemini accuracy, precision, recall, F1, latency, robustness, or throughput result has been measured.
- Neon TLS/database issues and blocked authenticated live testing remain historical blocked dependencies; the next phase should use only an isolated provider-recording harness and mocked server-stage checks before any live request is authorized.
