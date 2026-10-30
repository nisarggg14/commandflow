# Paper-ready quantitative results

## Experimental methodology

A controlled local experiment evaluated CommandFlow revision `a3ae2a7` on Windows with Node.js `v24.8.0` and npm `11.6.0`. The harness used 1,000 warm-up iterations followed by 10,000 sequential measured iterations for each local operation. Durations were recorded with the monotonic `performance.now()` timer. Percentiles were calculated over sorted samples at `floor(0.50n)`, `floor(0.95n)`, and `floor(0.99n)`; standard deviation used the population denominator. No production data, credentials, database mutation, provider call, or external API request was used.

The ground-truth fixture set contained eight explicit local control cases covering valid schema input, invalid/cancellation status, unauthorized role attempts, unknown tool selection, invalid UI arguments, and an unsafe loopback client. Each case specified expected tool, arguments, authorization, and outcome. The fixture set is not a substitute for live natural-language model evaluation.

## Results

| Operation | n | Mean (ms) | Median (ms) | p95 (ms) | p99 (ms) | Throughput (sâ»Â¹) |
|---|---:|---:|---:|---:|---:|---:|
| Schema validation | 10,000 | 0.00294858 | 0.0013 | 0.0047 | 0.0191 | 339,146.3009 |
| Authorization | 10,000 | 0.00146688 | 0.0004 | 0.0008 | 0.0013 | 681,719.0227 |
| Direct local UI baseline | 10,000 | 0.00063720 | 0.0004 | 0.0011 | 0.0027 | 1,569,365.9761 |
| MCP UI dispatch | 10,000 | 0.02730999 | 0.0104 | 0.0258 | 0.1348 | 36,616.6374 |

The direct local UI baseline and MCP dispatch comparison yielded an absolute overhead of `0.02667279 ms`, relative overhead of `4,185.9369%`, and baseline/pipeline ratio of `0.02333212`. This is a controlled local comparison of an in-process UI operation; it is not evidence about third-party API performance or superiority over another framework.

The local control fixture outcome rate was 8/8 (100%). Unauthorized execution prevention was 2/2 (100%), invalid/unsafe schema rejection was 3/3 (100%), unknown-tool rejection was 1/1 (100%), and loopback SSRF rejection was 1/1 (100%). These finite denominators should not be interpreted as complete security validation.

## Unmeasured model and external metrics

Live tool-selection accuracy, argument exact-match accuracy, intent precision/recall/F1, end-to-end execution success, timeout rate, external API latency, and provider cost were not measured. The LLM service required an unavailable `GEMINI_API_KEY`; no model requests were made. The local mock API attempt was rejected by the existing SSRF guard because loopback is blocked, so no mock request latency is reported. Test execution was blocked by Windows `spawn EPERM`, preventing empirical pass/fail results and confidence intervals from the application test suite.

The results therefore establish a reproducible local-control baseline only. They do not establish production availability, model accuracy, penetration resistance, or statistical superiority over another system.
