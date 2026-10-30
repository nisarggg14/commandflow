# CommandFlow Metrics Audit

Audit date: 2026-10-15 (Asia/Calcutta)
Repository revision: `a3ae2a7`, branch `feature/mcp-runtime`

## Executive summary

This audit measures the current repository without changing application behavior, security controls, database schema, dependencies, or production configuration. The implementation contains 33 registered MCP tools across seven categories, 21 Next.js API routes, 12 Prisma models, seven migrations, and six automated test files containing 63 test declarations.

The implemented execution path is:

`HTTP chat route -> authenticated company/user context -> connected-client selection and allowlisted tools -> MCP server/tool registry -> LLM command interpretation -> JSON sanitization -> product-reference resolution -> schema validation -> role authorization -> risk evaluation -> approval/MFA for HIGH risk -> selected client API -> result processing/audit/trace -> persisted assistant response`

The LLM stage is source-confirmed but was not measured: importing it requires `GEMINI_API_KEY`, which is unavailable in this environment. The Node test runner was also blocked by Windows `spawn EPERM` before test bodies ran. TypeScript typechecking passed. ESLint is not installed. The production build was started but did not complete during the audit and was stopped after prolonged no-progress compilation.

Local pure-control benchmarks were measurable: 10,000 warm schema validations and 10,000 warm authorization checks. These are microbenchmarks, not end-to-end user-perceived latency. A local mock HTTP request was attempted and rejected by the existing SSRF policy because loopback destinations are blocked; no external/API latency is claimed.

## Repository and architecture metrics

| Metric | Value | Method/evidence | Status |
|---|---:|---|---|
| API routes | 21 | Counted `app/api/**/route.ts` | Measured |
| Registered MCP tools | 33 | Counted tool constructors in `mcp/tools/index.ts`; excluded index file itself | Measured |
| MCP categories | 7 | Runtime metadata from `createDefaultTools()` | Measured |
| MCP tools by category | PRODUCTS 9; ANALYTICS 2; USERS 5; CONVERSATIONS 3; SYSTEM 3; UI 8; ORDERS 3 | Runtime metadata | Measured |
| Effective risk levels | LOW 20; MEDIUM 7; HIGH 6 | Runtime metadata; missing risk defaults to LOW in registry | Measured |
| Explicit risk classifications | 25 | 33 tools minus 8 definitions relying on default LOW | Measured |
| Default-risk tools | 8 | Runtime metadata marked `DEFAULT_LOW` before registry defaulting | Measured |
| HIGH-risk tools requiring MFA | 6 | Runtime metadata; all six HIGH tools set step-up MFA | Measured |
| HIGH-risk approval path | Yes | `mcp/server.ts` creates/validates approval for HIGH risk before execution | Source verified |
| Connected-client management features | 6 route operations: list, create, get, update, delete, tool-selection/execution integration | `app/api/connected-clients/**`, `services/connected-client.service.ts`, `services/mcp-connector.service.ts` | Measured/source verified |
| Prisma models | 12 | `model` declarations in `prisma/schema.prisma` | Measured |
| Prisma enums | 6 | `enum` declarations in `prisma/schema.prisma` | Measured |
| Migrations | 7 | Directories under `prisma/migrations` | Measured |
| Direct dependencies | 21 | `package.json` dependencies | Measured |
| Direct dev dependencies | 9 | `package.json` devDependencies | Measured |
| Direct dependencies total | 30 | Combined manifest keys | Measured |
| Lockfile package entries | 574 | `package-lock.json` v3 `packages` entries, excluding root | Measured |
| Application source files | 112 | `.ts/.tsx/.js/.jsx/.mjs` under app, components, lib, mcp, services, types, validators | Measured |
| Application source lines | 7,193 total; 6,243 nonblank | PowerShell line count; generated/build/dependency directories excluded | Measured |
| Test files | 6 | `tests/*.test.ts` | Measured |
| Test lines | 1,182 total; 1,048 nonblank | PowerShell line count | Measured |
| Test declarations | 63 | Counted lines beginning with `test(` | Measured |

### Actual execution path

- Authentication and company binding: `app/api/chat/route.ts`, `lib/auth.ts`, `services/auth.service.ts`.
- Conversation and connected-client selection: `services/chat.service.ts` and `services/mcp-connector.service.ts`; database lookups require both client identity and `companyId`, and ACTIVE status.
- Tool registry and default risk: `mcp/tools/index.ts`, `mcp/registry.ts`.
- LLM interpretation and JSON sanitization: `services/command-parser.service.ts` and `services/llm.service.ts`.
- Product reference resolution: `services/product-resolver.service.ts`.
- Input validation, role authorization, risk evaluation, approval, MFA, execution, and audit logging: `mcp/server.ts`.
- Selected external client request and SSRF checks: `services/inventory-api.service.ts`, `services/order-api.service.ts`, `services/mcp-connector.service.ts`, `lib/ssrf.ts`.
- Execution trace/result persistence: `services/chat.service.ts`, `services/external-request-trace.ts`, and activity/message persistence.

## Automated test results

Configured commands are defined in `package.json`.

| Command | Result | Details |
|---|---|---|
| `node --import tsx --test tests/mcp-runtime.test.ts` | Failed before tests | Windows Node test runner returned `Error: spawn EPERM`; no test body executed |
| `npm test` | Failed before tests | All six test files were discovered, but each failed with `spawn EPERM`; no pass/fail assertions were executed |
| `npm run typecheck` | Passed | `tsc --noEmit` exited 0 |
| `npm run lint` | Not available | `eslint` is not installed/recognized |
| `npm run build` | Incomplete | Next.js 16.2.6 began optimized production compilation but made no observable progress; command was stopped; no success claimed |
| `git diff --check` | Passed | No whitespace errors; Git emitted only line-ending normalization warnings |

No coverage tool is configured or available in the existing manifest. Coverage percentage is therefore **NOT MEASURED**.

Because the test runner failed before test bodies, this audit does not convert source-level test names into passing runtime evidence. The test inventory below is a static inventory of intended automated checks.

### Test-control inventory from test names/source

- Authorization and role restrictions: `tests/mcp-runtime.test.ts`; approval role tests 1â€“5 and 14 in `tests/approval-security-matrix.test.ts`.
- Cross-company isolation: connected-client update test; approval matrix tests 6 and 22; company-scoped queries in source.
- MFA and approval integrity: `tests/approval.service.test.ts`, approval matrix tests 7â€“34, and connected-client MFA proof test.
- Approval expiry/replay/duplicate execution: approval matrix tests 8â€“13 and 26â€“28.
- SSRF/unsafe URL handling: connected-client validation/unsafe-base-URL test and approval matrix arbitrary-endpoint test; runtime attempt against loopback was rejected by `lib/ssrf.ts`.
- Credential handling/redaction: connected-client safe-response test, user-secret omission test, and approval matrix secret-log test.
- Tool allowlists/schema validation: `tests/mcp-registry.test.ts` and MCP runtime UI/order/schema tests.
- LLM quota classification: MCP runtime quota classification test; live provider behavior was not exercised.
- Rate limiting: implementation exists in `lib/rate-limit.ts` and MFA routes use it; no dedicated rate-limit test was identified.

## Security-control metrics

| Control | Source implementation | Automated test evidence | Runtime integration | Limitations |
|---|---|---|---|---|
| Explicit tool risk classification | Partial: 25/33 explicit; 8 default LOW | Static MCP runtime/registry assertions | Registry defaults missing values to LOW | Defaulting is measurable, but not automatically a failure |
| HIGH-risk approval workflow | Yes in `mcp/server.ts` and `services/approval.service.ts` | 28+ approval-matrix scenarios by numbered test names | Not executed because test runner failed | No claim of passing runtime tests |
| HIGH-risk MFA | Yes in `lib/mfa.ts`, server, approval routes | Approval matrix MFA cases; tool metadata tests | Source verified; tests not executed | Requires configured database/secrets for full flow |
| Role/tool authorization | Yes in MCP server and API routes | Runtime role tests and approval role cases | Not executed | Static/source evidence only in this run |
| Company isolation | Yes in query filters and connector selection | Connected-client and approval isolation cases | Not executed | Requires database-backed execution |
| Approval tamper/replay/expiry | Yes: hash, status, expiry, claim/update guards | Approval matrix cases 8â€“13 and 20â€“29 | Not executed | No production database used |
| SSRF protection | Yes in `lib/ssrf.ts` and client API services | Connected-client unsafe URL coverage; local loopback request rejected | Directly exercised in benchmark attempt | No external target tested |
| Credential encryption/redaction | Yes: encrypted connected-client/MFA secrets and audit redaction | Safe-response, secret omission, and secret-log cases | Not executed | No secrets were printed or inspected |
| Tool allowlists | Yes in `mcp/client-tool-policy.ts` and connected-client selection | Registry unknown-tool and frontend allowlist cases | Source verified; tests not executed | Per-client persistence not exercised |
| Rate limiting | Partial: MFA endpoints use `enforceRateLimit` | No dedicated test identified | Not measured | Behavior may be in-memory/process-local; inspect before production claims |

The system should not be described as penetration-tested, formally verified, or production-secure solely from these source checks and unexecuted test cases.

## Performance benchmarks

Environment: Windows repository workspace, Node.js `v24.8.0`, npm `11.6.0`, warm process, sequential execution, `performance.now()` converted to microseconds. Hardware/OS inventory through WMI was denied by the environment, so CPU, RAM, and detailed OS build are **NOT MEASURED**.

| Benchmark | Samples | Minimum | Median | P95 | Maximum | Mean | Std. dev. | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `orders.updateOrderStatus` Zod schema validation | 10,000 | 0.7 Âµs | 1.3 Âµs | 4.7 Âµs | 4,519.4 Âµs | 2.95 Âµs | 48.39 Âµs | Measured locally |
| MCP Manager authorization check | 10,000 | 0.3 Âµs | 0.4 Âµs | 0.8 Âµs | 7,737.0 Âµs | 1.47 Âµs | 78.69 Âµs | Measured locally |
| LLM command interpretation | â€” | â€” | â€” | â€” | â€” | â€” | â€” | NOT MEASURED; `GEMINI_API_KEY` unavailable and no paid/live calls made |
| End-to-end selected-client request | â€” | â€” | â€” | â€” | â€” | â€” | â€” | NOT MEASURED; local loopback mock was rejected by SSRF protection |
| Throughput/concurrency | â€” | â€” | â€” | â€” | â€” | â€” | â€” | NOT MEASURED; no meaningful external-client target available |

These microbenchmarks measure local control code only. They do not represent network latency, database latency, LLM latency, production throughput, or user-perceived response time. No baseline or improvement claim is made.

## Reliability and failure handling

Verified or source-observed failure paths include invalid tool arguments, unauthorized roles, unknown/disabled client tool names, unsafe client URLs, unavailable/invalid connected-client credentials, missing MFA challenge, invalid/expired/replayed approvals, failed external requests, malformed LLM JSON fallback, and Gemini quota classification. The test suite contains named cases for most of these, but the Node runner prevented execution.

The local mock request experiment produced an explicit `Outbound destination is not allowed` error for loopback. This confirms the SSRF guard is active in the benchmark path; it is not an external-service failure-rate measurement.

Malformed external responses, timeout distributions, database failure rates, availability, and production reliability are **NOT MEASURED**.

## Limitations and unresolved items

1. Windows `spawn EPERM` prevented Node test files from executing.
2. ESLint is absent from the installed environment.
3. The production build did not complete during this audit.
4. `GEMINI_API_KEY` is unavailable; no LLM/API-costing experiment was attempted.
5. WMI hardware inventory was denied.
6. No coverage instrument is configured.
7. Database-backed integration and external API latency were not measured.
8. Existing working-tree changes and untracked files were preserved; no reset, clean, commit, push, dependency install, or database mutation was performed.

## Final metric register

The complete machine-readable register is in `metrics-summary.csv`. Evidence commands and source references are in `metrics-evidence.md`. Paper/report prose is separated into `paper-ready-metrics.md` and `blackbook-ready-metrics.md`.
## Quantitative performance evaluation addendum

### Ground-truth control dataset

The harness uses eight anonymized fixtures with explicit expected tool, arguments, authorization, and outcome:

| Case | Expected outcome |
|---|---|
| Valid order status | Schema accepts `PROCESSING` |
| Ordinary cancellation through status update | Schema rejects `CANCELLED` |
| Invalid order status | Schema rejects invalid enum value |
| Viewer order update | Authorization rejects |
| Manager cancellation | Authorization rejects Admin-only cancellation |
| Unknown operation | Registry rejects unknown tool |
| Invalid UI theme | Schema rejects value outside allowlist |
| Loopback connected client | SSRF guard rejects before request |

This dataset evaluates local control decisions. It does not evaluate natural-language Gemini selection because the provider key was unavailable. The raw records are in `benchmark-results.csv`.

### Mathematical definitions

For latency samples `x_1 ... x_n`, mean is `mean = (1/n) * sum(x_i)`, standard deviation is the population form `sqrt((1/n) * sum((x_i - mean)^2))`, and p50/p95/p99 are sorted samples at indices `floor(0.50n)`, `floor(0.95n)`, and `floor(0.99n)`. Throughput is `n / total measured seconds`.

For control rates, `rate = correct outcomes / applicable attempts * 100`. The harness recorded 8/8 local control fixtures correct (100%), 2/2 unauthorized attempts blocked (100%), 3/3 unsafe/invalid schema inputs rejected (100%), 1/1 unknown tool rejected (100%), and 1/1 loopback SSRF attempt rejected (100%). These are finite fixture results, not general security guarantees.

For the local overhead comparison, absolute overhead is `pipeline mean - direct baseline mean`; relative overhead is `(pipeline mean - baseline mean) / baseline mean * 100`; speedup is `baseline mean / pipeline mean`.

### Latency and throughput results

| Stage | Samples | Mean ms | p50 ms | p95 ms | p99 ms | Min ms | Max ms | Std. dev. ms | Throughput/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Schema validation | 10,000 | 0.00294858 | 0.0013 | 0.0047 | 0.0191 | 0.0007 | 4.5194 | 0.04839225 | 339,146.3009 |
| Authorization | 10,000 | 0.00146688 | 0.0004 | 0.0008 | 0.0013 | 0.0003 | 7.7370 | 0.07869460 | 681,719.0227 |
| Direct UI baseline | 10,000 | 0.00063720 | 0.0004 | 0.0011 | 0.0027 | 0.0002 | 0.5067 | 0.00735706 | 1,569,365.9761 |
| MCP UI dispatch | 10,000 | 0.02730999 | 0.0104 | 0.0258 | 0.1348 | 0.0050 | 50.3922 | 0.63473418 | 36,616.6374 |

The MCP UI dispatch comparison is a local control-path comparison, not a comparison with another framework or a third-party API. It produced 0.02667279 ms absolute overhead, 4,185.9369% relative overhead, and a 0.02333212 baseline/pipeline speedup ratio. The large relative percentage is expected from a sub-microsecond direct baseline and should not be generalized to networked commands.

### Accuracy, reliability, and security measurements

Live tool-selection accuracy, argument exact-match accuracy, intent precision/recall/F1, valid authorized execution success rate, timeout rate, and external API failure rate are NOT MEASURED. The parser imports the LLM service, which requires `GEMINI_API_KEY`; no provider requests were made. The local fixture control-success rate is not a substitute for those metrics.

High-risk approval/MFA negative-path runtime rates are also NOT MEASURED by the harness because they require database-backed approval and MFA fixtures. Source and static test inventories are documented in the security section, while the Node test runner failed with `spawn EPERM` before executing them.

The harness command and raw results are retained in `benchmark-harness.mjs` and `benchmark-results.csv`. Reproduction instructions, formulas, and environment limitations are in `reproduce.md`.
