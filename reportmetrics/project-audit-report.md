# CommandFlow project audit report

## Scope

This audit covered the offline evaluation package and metrics evidence. Application security controls, database configuration/schema, credentials, the IEEE paper, dataset gold labels, and unrelated working-tree changes were preserved.

## Confirmed repairs

- The historical benchmark writer used unsafe JSON-style escaping for CSV fields. The writer now emits RFC CSV quoting.
- A safe fixture-only benchmark generator was added and used for the current raw CSV. It does not import the MCP server, access a database, call external services, create approvals, consume MFA, or call Gemini.
- The current CSV contains 40,008 records: 40,000 latency samples and 8 deterministic fixtures. The validator checks 12-column row width, JSON and numeric types, sample counts, and fixture outcomes.
- Current metrics use nearest-rank percentiles, population standard deviation, all samples retained, and batch wall-clock throughput. Historical records remain separately preserved.

## Application and security status

No confirmed application defect was changed in this audit. The source registry, parser/evaluator package, isolated runner, and existing security controls were inspected as evidence only. Database-backed authorization, high-risk approval/MFA, authenticated live testing, Neon TLS, and external-client behavior were not exercised. No security control or production data was modified.

## Measurement status

The current fixture-only latency measurements are real local harness output, but are not production Zod, MCP, network, database, Gemini, or end-to-end measurements. Gemini tool accuracy, argument accuracy, precision/recall/F1, latency, robustness, throughput, and cost remain **not measured**. The paper's historical 60/60, 63/63, and 68/68 figures are distinct from the 63-case labelled dataset.

## Safe next phase

Review the evaluator and dataset, then authorize a separately controlled model-only experiment with explicit prediction input capture. Keep server validation/authorization dry-run results separate from raw model interpretation. Any later live application test requires independent database/TLS and credential approval.
