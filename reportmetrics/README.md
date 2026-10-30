# CommandFlow metrics and evaluation bundle

This is the flat, upload-ready metrics directory. Every file listed below is directly inside `reportmetrics/`; executable source remains in `scripts/` and tests remain in `tests/`.

## Current evaluation and safety evidence

- [`evaluation-dataset.json`](evaluation-dataset.json) — **Not measured**: 63 labelled cases, unchanged gold labels, no model predictions.
- [`evaluation-methodology.md`](evaluation-methodology.md) — current evaluator definitions, denominators, failure accounting, and robustness rules.
- [`evaluation-audit.md`](evaluation-audit.md) — dataset/schema/policy audit and corrections.
- [`gemini-isolation-audit.md`](gemini-isolation-audit.md) — model-only runner isolation audit and Checkpoint A status.
- [`gemini-preflight-report.md`](gemini-preflight-report.md) — offline preflight; API-key presence is blocked without exposing a value.
- [`metrics-integrity-audit.md`](metrics-integrity-audit.md) — CSV repair, authoritative statistics, provenance, report statuses, and unresolved discrepancies.
- [`paper-metrics-comparison.md`](paper-metrics-comparison.md) — separates historical paper figures from the new labelled dataset.
- [`llm-evaluation.md`](llm-evaluation.md) — historical lightweight LLM evaluation notes.

## Historical and supporting metrics

- [`metrics-report.md`](metrics-report.md) — historical testing/build/typecheck report.
- [`metrics-summary.csv`](metrics-summary.csv) — historical metrics inventory.
- [`benchmark-results.csv`](benchmark-results.csv) — historical deterministic/local benchmark records; not Gemini accuracy.
- [`metrics-evidence.md`](metrics-evidence.md) — historical evidence and command log.
- [`paper-ready-metrics.md`](paper-ready-metrics.md) — historical paper-oriented metric summary.
- [`blackbook-ready-metrics.md`](blackbook-ready-metrics.md) — historical black-book metric summary.
- [`paper-ready-results.md`](paper-ready-results.md) — historical paper-ready results; LLM metrics remain unmeasured.
- [`blackbook-ready-results.md`](blackbook-ready-results.md) — historical black-book results.
- `paper-ready-metrics-historical.md`, `blackbook-ready-metrics-historical.md`, `paper-ready-results-historical.md`, `blackbook-ready-results-historical.md` — preserved pre-repair report revisions.
- `metrics-report-historical.md`, `metrics-evidence-historical.md`, `reproduce-historical.md`, `metrics-summary-historical.csv` — preserved historical provenance and summary artifacts.

## Current benchmark artifact

- [`benchmark-generation-metadata.json`](benchmark-generation-metadata.json) - fixture-only generation configuration and safety boundary.
- [`project-audit-report.md`](project-audit-report.md) - current safe project/evaluation audit and remaining blockers.
- [`final-application-verification.md`](final-application-verification.md) - application verification, confirmed repair, exact test outcomes, and blockers.
- [`submission-readiness.md`](submission-readiness.md) - concise final review status, required files, blockers, and prohibited claims.

## Testing and reproduction

- [`test-results.md`](test-results.md) — current offline evaluator regression results.
- [`validation-report.md`](validation-report.md) — current 63-case/all-33-tool validation result.
- [`live-e2e-report.md`](live-e2e-report.md) — historical live QA report; authenticated/database checks remain blocked.
- [`live-e2e-checklist.md`](live-e2e-checklist.md) — historical PASS/FAIL/BLOCKED/NOT TESTED checklist.
- [`reproduce.md`](reproduce.md) — historical deterministic-control reproduction instructions.

## Source links

- Offline evaluator: [`../scripts/evaluate-commandflow-dataset.js`](../scripts/evaluate-commandflow-dataset.js)
- Isolated Gemini runner: [`../scripts/run-gemini-evaluation.js`](../scripts/run-gemini-evaluation.js)
- Evaluator tests: [`../tests/evaluation-package.test.js`](../tests/evaluation-package.test.js)
- Mocked Gemini tests: [`../tests/gemini-evaluation-runner.test.js`](../tests/gemini-evaluation-runner.test.js)
- Benchmark CSV validator: [`../scripts/validate-commandflow-benchmark.mjs`](../scripts/validate-commandflow-benchmark.mjs)
- Fixture-only benchmark generator: [`../scripts/run-commandflow-fixture-benchmark.mjs`](../scripts/run-commandflow-fixture-benchmark.mjs)
- Generated preflight source artifact: `evaluation-results/preflight-report.md` (copied here as [`gemini-preflight-report.md`](gemini-preflight-report.md)).

## Status and interpretation rules

- **Measured and passed:** current fixture-only benchmark generation/CSV validation and offline evaluator tests; these are not application or MCP execution results.
- **Historical / superseded:** prior benchmark, test, QA, and paper-support reports retained for traceability.
- **Blocked:** Neon TLS/database-dependent checks, authenticated live testing, and API-key preflight in this offline environment.
- **Not measured:** Gemini accuracy, precision/recall/F1, latency, throughput, robustness, cost, and baseline/improved model comparisons.

The paper’s historical 60/60 automated-test figure, 63/63 scenario figure, and later 68/68 project test figure are distinct from one another and from the new 63-case labelled dataset. None is a Gemini performance result.

## Safe reproduction commands

Run from the repository root:

```text
node scripts/evaluate-commandflow-dataset.js --validate
node tests/evaluation-package.test.js
node tests/gemini-evaluation-runner.test.js
node scripts/run-gemini-evaluation.js --dry-run
git diff --check
```

These commands do not call Gemini, execute MCP tools, access the database, create approvals, consume MFA, or edit the paper. The live runner remains explicitly gated behind `--live` and requires separate review.
