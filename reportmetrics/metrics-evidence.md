# Metrics Evidence

Status: **Historical execution log / superseded for current benchmark provenance.** The current canonical evidence is `benchmark-results.csv`, validated by `scripts/validate-commandflow-benchmark.mjs`; the harness was not rerun during the CSV repair because it executes a local MCP dispatch. Historical command outcomes below are preserved for traceability.

Audit date: 2026-10-15. Working directory: `C:\Users\Nisarg\Documents\MAJOR PROJECT FINAL\Commander main`.

## Exact commands executed

```powershell
Get-ChildItem -Force
rg --files app mcp services lib validators prisma tests docs
Get-Content -Raw package.json
rg -n "^(model|enum) " prisma/schema.prisma
(rg --files app/api -g 'route.ts' | Measure-Object).Count
(rg --files mcp/tools -g '*.ts' | Measure-Object).Count
(Get-ChildItem prisma/migrations -Directory | Measure-Object).Count
rg -n '^test\(' tests
node --version
npm --version
git branch --show-current
git rev-parse --short HEAD
git status --short
npm test
node --import tsx --test tests/mcp-runtime.test.ts
npm run typecheck
npm run lint
npm run build
git diff --check
```

The final audit also used a read-only Node import of `mcp/tools/index.ts` to obtain runtime tool metadata, a PowerShell line-count script, and the following no-file benchmark command:

```powershell
node --import tsx --input-type=module -e "...10,000 schema safeParse calls and 10,000 MCP authorize calls..."
```

The benchmark used `performance.now()`, 1,000 warm-up calls, then 10,000 sequential samples per operation. The reported values are in `metrics-report.md` and `metrics-summary.csv`.

## Command outcomes

- `git diff --check`: exit 0; only line-ending normalization warnings.
- `npm run typecheck`: exit 0.
- `npm test`: six test files were discovered; all failed before test execution with Node `Error: spawn EPERM`.
- Targeted MCP runtime test: failed before test execution with Node `Error: spawn EPERM`.
- `npm run lint`: failed because `eslint` was not recognized/installed.
- `npm run build`: Next.js 16.2.6 started an optimized production build, showed no progress after compilation began, and was stopped; no success is claimed.

## Source evidence

- Execution orchestration: `app/api/chat/route.ts`, `services/chat.service.ts`.
- LLM/parser boundary: `services/command-parser.service.ts`, `services/llm.service.ts`.
- Registry/default risk: `mcp/tools/index.ts`, `mcp/registry.ts`.
- MCP validation/auth/risk/approval/MFA/audit: `mcp/server.ts`, `services/approval.service.ts`, `lib/mfa.ts`.
- Connected clients and company/status selection: `services/mcp-connector.service.ts`, `services/connected-client.service.ts`.
- SSRF: `lib/ssrf.ts`, `services/inventory-api.service.ts`, `services/order-api.service.ts`.
- Redaction: `lib/audit-redaction.ts`, `app/api/logs/route.ts`.
- Database structure: `prisma/schema.prisma`, `prisma/migrations/`.
- Tests: `tests/mcp-runtime.test.ts`, `tests/mcp-registry.test.ts`, `tests/mcp-connector.test.ts`, `tests/connected-clients.test.ts`, `tests/approval.service.test.ts`, `tests/approval-security-matrix.test.ts`.

## Benchmark limitation evidence

A local HTTP server was created only in memory on loopback and returned a fixed non-sensitive order JSON. The existing order service called `assertSafeOutboundUrl`, which rejected the loopback destination with `Outbound destination is not allowed.` No request was sent to any external service. This result is evidence that the SSRF control intercepts the benchmark, not a latency measurement.

Importing `services/command-parser.service.ts` loaded `services/llm.service.ts`, which raised `GEMINI_API_KEY is missing in .env`; no model API calls were made.

Hardware inventory through WMI (`Get-CimInstance`) was denied by the environment. CPU, RAM, and detailed OS build are therefore not reported.

No secrets, environment contents, customer records, credentials, tokens, MFA secrets, or database URLs were included in the artifacts.
## Quantitative harness evidence

Exact benchmark command:

```powershell
node --import tsx metrics-report/benchmark-harness.mjs
```

Observed exit code: 0. The harness generated 40,008 CSV records: 40,000 latency records (four operations × 10,000) and eight deterministic control fixtures. Each latency operation used 1,000 warm-up iterations and sequential concurrency of one. The four operations were schema validation, Manager authorization, direct UI execution baseline, and full MCP dispatch for `ui.setTheme`.

The harness measured:

- Schema validation: mean 0.00294858 ms, p50 0.0013 ms, p95 0.0047 ms, p99 0.0191 ms, throughput 339,146.3009/s.
- Authorization: mean 0.00146688 ms, p50 0.0004 ms, p95 0.0008 ms, p99 0.0013 ms, throughput 681,719.0227/s.
- Direct UI baseline: mean 0.00063720 ms.
- MCP UI dispatch: mean 0.02730999 ms.

The local baseline-derived overhead calculations are absolute 0.02667279 ms, relative 4,185.9369%, and baseline/pipeline ratio 0.02333212. These are derived from the two measured local means and are not external-service performance claims.

The eight local fixtures all matched their expected outcomes. This gives 8/8 control-fixture success, 2/2 unauthorized prevention, 3/3 invalid/unsafe schema rejection, 1/1 unknown-tool rejection, and 1/1 loopback SSRF rejection. The denominators are finite and are not generalized security rates.
