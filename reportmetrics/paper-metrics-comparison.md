# Paper-metrics comparison

This report keeps the paper’s historical figures separate from the current labelled dataset and deterministic local-control artifacts.

| Measurement | Source/provenance | Meaning | Current status |
|---|---|---|---|
| 60/60 automated tests | IEEE paper Section VII/Table V | Paper-reported automated-test result | Historical / superseded; not rerun here |
| 63/63 scenarios | IEEE paper Section VII/Table V/results | Paper-reported scenario result | Historical / superseded; not the new LLM dataset |
| 68/68 tests | Later project test run/report | Later reported project test result | Historical; provenance retained as distinct |
| 63 labelled cases | `reportmetrics/evaluation-dataset.json` | Gold-labelled LLM interpretation/safety cases | Prepared; no model run |
| 8/8 deterministic fixtures | `reportmetrics/benchmark-results.csv` | Local schema/authorization/SSRF control fixtures | Historical / superseded; not model accuracy |

The 63-case dataset does not mean 63 model successes. It is the denominator of a future experiment only after each case has an explicit successful, malformed, provider-failure, or missing/unrun prediction record. Provider failures and missing records are handled separately by the current evaluator.

The paper artifact located during audit was `C:\Users\Nisarg\Downloads\CommandFlow_IEEE_Journal_Paper_Final.pdf`; it is outside the repository and is not copied into this bundle. The numeric distinctions above are recorded from the paper/report context supplied for this audit and the existing historical metrics artifacts. A PDF text-extraction tool was not available in the execution environment, so exact surrounding prose, table captions, confidence intervals, and any additional Section VII claims remain unverified.

Do not substitute any of these figures for tool-selection accuracy, exact-argument accuracy, per-tool precision/recall/F1, robustness, end-to-end latency, or throughput from the new Gemini experiment.
