# Current offline evaluator tests

Status: **Measured and passed**.

Command:

```text
node tests\evaluation-package.test.js
```

Observed result: 9 tests passed, 0 failed.

Coverage includes recursive JSON equality, schema audit, provider/malformed/missing accounting, action-category/tool-selection regressions, registered-tool TP/FP/FN and macro-F1, zero-denominator metrics, predicted-argument server-stage classification, and partial-run robustness eligibility.

`node --test tests\evaluation-package.test.js` was also attempted but the Windows sandbox returned `spawn EPERM` before test bodies. Direct execution with Node passed all nine tests and is the reproducible command used for this offline package.
