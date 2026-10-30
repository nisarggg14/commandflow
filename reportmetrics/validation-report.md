# Current offline validation report

Status: **Measured and passed**.

Command, run from the repository root:

```text
node scripts\evaluate-commandflow-dataset.js --validate
```

Observed result:

```text
ok: true
cases: 63
toolBearingCases: 55
noToolCases: 8
registeredTools: 33
coveredRegisteredTools: 33
unknownGoldTools: made.up.tool
noLiveRequests: true
```

The unknown gold tool is the intentional `X-001` negative test. Validation also checks unique IDs, case structure, explicit tool/argument fields, source-derived schema expectations, role/risk-derived server labels, and registered-tool coverage.
