# Reproduction instructions

Run these commands from the repository root in PowerShell. They are read-only with respect to application behavior and do not require production credentials or database mutation.

## Environment and inventory

```powershell
node --version
npm --version
git branch --show-current
git rev-parse --short HEAD
rg --files app/api -g route.ts
rg -n '^test\(' tests
rg -n '^(model|enum) ' prisma/schema.prisma
Get-ChildItem prisma/migrations -Directory
```

The audit was run with Node.js v24.8.0 and npm 11.6.0. Hardware WMI queries were denied in the audit environment.

## Historical benchmark command

```powershell
node --import tsx metrics-report/benchmark-harness.mjs
```

This command is retained for historical reproduction only. It imports the MCP registry/server and executes a local MCP UI dispatch, so it was not run during the integrity repair. The harness:

- Imports the existing MCP tool registry, server, and order service.
- Uses 1,000 warm-up iterations and 10,000 measured sequential iterations for schema validation, authorization, direct local UI execution, and MCP UI dispatch.
- Uses `performance.now()` for monotonic timing.
- Calculates mean, population standard deviation, p50, p95, p99, min, max, and throughput.
- Writes anonymized raw records to `metrics-report/benchmark-results.csv`.
- Runs eight deterministic ground-truth control fixtures.
- Attempts only a loopback order-client URL to verify the existing SSRF guard; it must reject before any network request. It does not bypass SSRF or contact an external service.

The direct baseline is the same local UI tool's `execute` function without MCP server validation/authorization/dispatch. The comparison is a local overhead measurement, not a third-party API comparison.

## Existing checks

```powershell
git diff --check
node --import tsx --test tests/mcp-runtime.test.ts
npm test
npm run typecheck
npm run lint
npm run build
```

In this environment, the targeted and full Node test commands fail before test bodies with Windows `spawn EPERM`; typecheck passes; lint is unavailable because ESLint is not installed; and the production build did not complete. Do not reinterpret those outcomes as application test failures or successes.

## Safe CSV validation and metric assumptions

```powershell
node scripts/validate-commandflow-benchmark.mjs metrics-report/benchmark-results.csv
node scripts/validate-commandflow-benchmark.mjs metrics-report/benchmark-results.csv --canonicalize
```

The validator parses every row, checks all 12 columns, JSON argument fields, types, 40,000 latency rows, eight fixtures, and 10,000 samples per latency operation. `--canonicalize` repairs legacy backslash-escaped JSON quoting without executing application code.

The eight fixture cases and expected outcomes are defined directly in `benchmark-harness.mjs`. Expected outcomes are deterministic local control decisions, not model predictions. Live Gemini accuracy is intentionally not measured. Percentiles use nearest rank, sorted index `ceil(p*n)-1`. Standard deviation uses the population denominator. Throughput equals measured samples divided by total measured seconds, with no outlier removal. Rates always report numerator and denominator in `metrics-summary.csv`.

Do not run this harness against production URLs, replace the SSRF guard, provide real credentials, enable live model calls solely for benchmarking, or use destructive API operations.
