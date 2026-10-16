# Black-book-ready metrics

## What was measured

This audit measured the repository as it existed on 15 October 2026. No source behavior, authorization rule, MFA requirement, database schema, dependency, or production configuration was changed. Generated/build output, `node_modules`, and the existing `tsconfig.tsbuildinfo` file were excluded from source-size counts.

| Area | Result | Meaning |
|---|---:|---|
| API surface | 21 routes | Count of Next.js `route.ts` files under `app/api` |
| MCP tools | 33 | Unique registered tool constructors in `mcp/tools/index.ts` |
| Tool categories | 7 | Products, analytics, users, conversations, system, UI, orders |
| Effective risk | 20 LOW / 7 MEDIUM / 6 HIGH | Runtime metadata after LOW defaults |
| MFA-protected tools | 6 | All six HIGH-risk tools declare step-up MFA |
| Source size | 7,193 lines / 6,243 nonblank | 112 application source files, excluding dependencies/build output |
| Tests | 6 files / 63 declarations | Static test inventory under `tests` |
| Database | 12 models / 7 migrations | Prisma schema and migration directories |
| Packages | 30 direct / 574 lockfile entries | 21 runtime, 9 development direct dependencies; lockfile v3 package entries |

## Architecture interpretation

A request enters through the authenticated chat route. The service binds the request to a user and company, selects an active connected client, loads its allowlisted tools, and constructs an MCP server. The parser asks the configured LLM for strict JSON, sanitizes the result, and resolves product references where needed. The MCP server validates the tool schema, checks role permissions, applies risk handling, creates or validates approvals for HIGH-risk operations, consumes MFA challenges when required, executes through the selected client connection, and records audit/trace information. The result is serialized into the conversation response.

The source supports company isolation through company-scoped database queries and connected-client selection. It supports encrypted connected-client/MFA secrets, audit redaction, allowlisted tool names, SSRF checks, approval hashing/status checks, MFA purpose binding, and rate limiting on MFA endpoints. These are implementation findings; the runtime suite did not execute because of the Windows test-runner restriction.

## Automated checks

`npm run typecheck` passed. `git diff --check` passed. The targeted MCP runtime test and `npm test` were blocked before assertions by `spawn EPERM`. `npm run lint` could not run because ESLint was not installed. `npm run build` began with Next.js 16.2.6 but was incomplete and is not marked successful. No coverage percentage is supplied because no coverage tool is configured.

## Performance interpretation

The local warm schema-validation benchmark used 10,000 samples and returned a 0.9 microsecond median and 2.0 microsecond p95. The local warm authorization benchmark used 10,000 samples and returned a 0.5 microsecond median and 0.9 microsecond p95. Maximum outliers were 2,101.1 microseconds and 411.2 microseconds, respectively. These are process-local measurements and should not be presented as complete command latency.

No LLM latency was measured because `GEMINI_API_KEY` was unavailable. No external API latency was measured. A loopback mock server was intentionally rejected by the SSRF guard, confirming that the benchmark did not bypass outbound safety controls. Throughput, concurrency, timeout distributions, database latency, and availability remain unmeasured.

## Limitations

The test-runner infrastructure failure means named tests are evidence of test intent, not passing results. Hardware details were not collected because WMI access was denied. ESLint and full build outcomes remain unresolved. The working tree contained unrelated modifications and untracked files; they were preserved. No database mutation, credential access, dependency installation, commit, or push was performed.