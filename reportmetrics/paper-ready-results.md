# Paper-ready quantitative results

## Experimental methodology

A new fixture-only local benchmark generated `benchmark-results.csv` using deterministic mocks, without importing the MCP server or executing tools. It used 1,000 warm-up iterations followed by 10,000 sequential measured iterations per operation and monotonic `performance.now()` timing. Percentiles use nearest rank: sorted index `ceil(p*n)-1`; standard deviation uses the population denominator. Throughput uses measured batch wall-clock time recorded in each row. No production data, credentials, provider call, database, MCP dispatch, or external API request was used.

The ground-truth fixture set contained eight explicit local control cases covering valid schema input, invalid/cancellation status, unauthorized role attempts, unknown tool selection, invalid UI arguments, and an unsafe loopback client. Each case specified expected tool, arguments, authorization, and outcome. The fixture set is not a substitute for live natural-language model evaluation.

## Results

| Operation | n | Mean (ms) | Median (ms) | p95 (ms) | p99 (ms) | Throughput (sâ»Â¹) |
|---|---:|---:|---:|---:|---:|---:|
| Fixture schema validation | 10,000 | 0.00077447 | 0.0004 | 0.0011 | 0.0015 | 913,834.5411 |
| Fixture authorization | 10,000 | 0.00045620 | 0.0004 | 0.0004 | 0.0024 | 1,698,167.6771 |
| Fixture direct UI baseline | 10,000 | 0.00058010 | 0.0004 | 0.0009 | 0.0013 | 1,325,012.2564 |
| Fixture mocked UI pipeline | 10,000 | 0.00047438 | 0.0004 | 0.0007 | 0.0010 | 1,601,717.0407 |

The fixture direct baseline and fixture mocked pipeline differ by `-0.00010572 ms`, or `-18.2244%`, with a baseline/pipeline ratio of `1.22285931`. These operations are deterministic mocks and are explicitly non-comparable to historical live-MCP-labelled measurements; this is not evidence of MCP or framework performance.

The local control fixture outcome rate was 8/8 (100%). Unauthorized execution prevention was 2/2 (100%), invalid/unsafe schema rejection was 3/3 (100%), unknown-tool rejection was 1/1 (100%), and loopback SSRF rejection was 1/1 (100%). These finite denominators should not be interpreted as complete security validation.

## Unmeasured model and external metrics

Live tool-selection accuracy, argument exact-match accuracy, intent precision/recall/F1, end-to-end execution success, timeout rate, external API latency, and provider cost were not measured. The LLM service required an unavailable `GEMINI_API_KEY`; no model requests were made. The local mock API attempt was rejected by the existing SSRF guard because loopback is blocked, so no mock request latency is reported. Test execution was blocked by Windows `spawn EPERM`, preventing empirical pass/fail results and confidence intervals from the application test suite.

The results establish a newly measured fixture-only baseline. They do not establish production availability, actual MCP-server performance, model accuracy, penetration resistance, or statistical superiority over another system. Historical live-MCP-labelled values remain in `paper-ready-results-historical.md` and `benchmark-results-canonical-historical.csv`.
