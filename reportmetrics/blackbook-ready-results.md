# Black-book-ready quantitative results

## Experimental setup

The current evidence uses the newly generated fixture-only `benchmark-results.csv` without changing application source, security policies, database schema, dependencies, or production configuration. The dedicated harness uses 1,000 warm-up iterations and 10,000 measured sequential iterations per deterministic mock, with `performance.now()` timing and batch wall-clock throughput. It does not import the MCP server or execute tools. Historical live-MCP-labelled records remain separately preserved.

The ground-truth dataset has eight rows:

1. A valid order status command with expected `orders.updateOrderStatus` and `PROCESSING` arguments.
2. A cancellation value sent to the ordinary status tool, expected to be rejected.
3. An invalid status enum, expected to be rejected.
4. A Viewer order update, expected to be denied.
5. A Manager cancellation, expected to be denied because cancellation is Admin-only.
6. An unknown operation, expected to be rejected by the registry.
7. An invalid UI theme value, expected to be rejected by schema validation.
8. A loopback connected client, expected to be rejected by SSRF protection.

The raw dataset outcomes and measured trials are in `benchmark-results.csv`. The safe executable harness is `scripts/run-commandflow-fixture-benchmark.mjs`; the historical `benchmark-harness.mjs` is preserved but not used because it executes MCP dispatch.

## Local latency results

| Stage | Trials | Successful | Failed | Mean ms | p50 ms | p95 ms | p99 ms | Min ms | Max ms | Std. dev. ms | Throughput/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Fixture order schema validation | 10,000 | 10,000 | 0 | 0.00077447 | 0.0004 | 0.0011 | 0.0015 | 0.0002 | 0.8289 | 0.01164674 | 913,834.5411 |
| Fixture manager authorization | 10,000 | 10,000 | 0 | 0.00045620 | 0.0004 | 0.0004 | 0.0024 | 0.0003 | 0.2047 | 0.00328740 | 1,698,167.6771 |
| Fixture direct UI baseline | 10,000 | 10,000 | 0 | 0.00058010 | 0.0004 | 0.0009 | 0.0013 | 0.0003 | 0.2238 | 0.00323137 | 1,325,012.2564 |
| Fixture mocked UI pipeline | 10,000 | 10,000 | 0 | 0.00047438 | 0.0004 | 0.0007 | 0.0010 | 0.0003 | 0.2523 | 0.00277277 | 1,601,717.0407 |

Mean is `sum(x)/n`; population standard deviation is `sqrt(sum((x-mean)^2)/n)`. Throughput is the number of measured trials divided by total measured seconds, including all measured samples. Percentiles use nearest rank: the sorted sample at zero-based index `ceil(p*n)-1`. No outliers were removed or winsorized; maxima and population standard deviations are reported.

## Derived overhead

For the equivalent local UI operation:

- Fixture-only absolute difference = `0.00047438 - 0.00058010 = -0.00010572 ms`.
- Fixture-only relative difference = `-0.00010572 / 0.00058010 * 100 = -18.2244%`.
- Fixture-only baseline/pipeline ratio = `0.00058010 / 0.00047438 = 1.22285931`.

This fixture comparison measures deterministic local mock functions only. It excludes the actual MCP registry/server, LLM, database, browser rendering, and network latency. It must not be described as a CommandFlow MCP performance or competing-framework comparison.

## Reliability and security-control outcomes

The eight local fixture cases were all classified as expected: 8/8 (100%). Specific prevention rates were:

| Metric | Numerator / denominator | Result |
|---|---:|---:|
| Unauthorized execution prevention | 2 / 2 | 100% |
| Invalid/unsafe schema rejection | 3 / 3 | 100% |
| Unknown-tool rejection | 1 / 1 | 100% |
| Loopback SSRF rejection | 1 / 1 | 100% |

These rates are finite fixture observations. High-risk approval/MFA enforcement was not run in this harness because it requires database-backed approval and MFA records. The application test suite contains corresponding named cases, but Windows Node test execution failed with `spawn EPERM` before assertions.

## Accuracy and unavailable measurements

The harness does not claim command interpretation accuracy. Live Gemini requests were not made because the provider key was unavailable and repeated calls could incur cost. Therefore tool-selection accuracy, exact argument accuracy, intent accuracy, precision, recall, macro-F1, live execution success, API timeout rate, and external API latency are marked NOT MEASURED. The eight local fixture cases evaluate deterministic controls after a tool/argument representation is already available.

## Reproduction and limitations

Run `node scripts/run-commandflow-fixture-benchmark.mjs --output reportmetrics/benchmark-results.csv --metadata reportmetrics/benchmark-generation-metadata.json`, then validate with `node scripts/validate-commandflow-benchmark.mjs reportmetrics/benchmark-results.csv`. The historical `metrics-report/benchmark-harness.mjs` remains preserved but is not the safe current generator.

The configured tests, typecheck, lint, and build outcomes are documented in `metrics-report.md` and `metrics-evidence.md`. No coverage percentage, production availability, hardware-normalized result, or statistical significance claim is made.
