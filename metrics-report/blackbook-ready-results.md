# Black-book-ready quantitative results

## Experimental setup

The evaluation ran against the existing CommandFlow repository without changing application source, security policies, database schema, dependencies, or production configuration. The machine exposed Node.js v24.8.0 and npm 11.6.0. WMI hardware inspection was denied, so CPU, RAM, and detailed OS build are not reported. The harness used a warm-up count of 1,000 and a measured count of 10,000 per local operation, sequential concurrency of one, and `performance.now()` for timing.

The ground-truth dataset has eight rows:

1. A valid order status command with expected `orders.updateOrderStatus` and `PROCESSING` arguments.
2. A cancellation value sent to the ordinary status tool, expected to be rejected.
3. An invalid status enum, expected to be rejected.
4. A Viewer order update, expected to be denied.
5. A Manager cancellation, expected to be denied because cancellation is Admin-only.
6. An unknown operation, expected to be rejected by the registry.
7. An invalid UI theme value, expected to be rejected by schema validation.
8. A loopback connected client, expected to be rejected by SSRF protection.

The raw dataset outcomes and measured trials are in `benchmark-results.csv`. The executable harness is `benchmark-harness.mjs`.

## Local latency results

| Stage | Trials | Successful | Failed | Mean ms | p50 ms | p95 ms | p99 ms | Min ms | Max ms | Std. dev. ms | Throughput/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Order schema validation | 10,000 | 10,000 | 0 | 0.00294858 | 0.0013 | 0.0047 | 0.0191 | 0.0007 | 4.5194 | 0.04839225 | 339,146.3009 |
| Manager authorization | 10,000 | 10,000 | 0 | 0.00146688 | 0.0004 | 0.0008 | 0.0013 | 0.0003 | 7.7370 | 0.07869460 | 681,719.0227 |
| Direct UI baseline | 10,000 | 10,000 | 0 | 0.00063720 | 0.0004 | 0.0011 | 0.0027 | 0.0002 | 0.5067 | 0.00735706 | 1,569,365.9761 |
| Full local MCP UI dispatch | 10,000 | 10,000 | 0 | 0.02730999 | 0.0104 | 0.0258 | 0.1348 | 0.0050 | 50.3922 | 0.63473418 | 36,616.6374 |

Mean is `sum(x)/n`; population standard deviation is `sqrt(sum((x-mean)^2)/n)`. Throughput is the number of measured trials divided by total measured seconds. Percentiles use the sorted sample at the stated percentile index.

## Derived overhead

For the equivalent local UI operation:

- Absolute overhead = `0.02730999 - 0.00063720 = 0.02667279 ms`.
- Relative overhead = `0.02667279 / 0.00063720 * 100 = 4,185.9369%`.
- Speedup ratio = `0.00063720 / 0.02730999 = 0.02333212`.

This comparison isolates CommandFlow's in-process validation, authorization, registry dispatch, risk handling, and audit path. It excludes LLM, database, browser rendering, and network latency. It must not be described as a comparison against a competing framework.

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

Run `node --import tsx metrics-report/benchmark-harness.mjs`. The command writes raw records to `metrics-report/benchmark-results.csv` and prints summary statistics. No external service is contacted. The harness intentionally attempts a loopback order client only to verify that SSRF protection rejects it; it does not bypass that protection.

The configured tests, typecheck, lint, and build outcomes are documented in `metrics-report.md` and `metrics-evidence.md`. No coverage percentage, production availability, hardware-normalized result, or statistical significance claim is made.
