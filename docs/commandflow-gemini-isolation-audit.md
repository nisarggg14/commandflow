# CommandFlow isolated Gemini evaluation audit

Status: **Checkpoint A blocked pending operator configuration**.

This audit covers the model-only runner at `scripts/run-gemini-evaluation.js`. It does not authorize or perform a live request.

## Reviewed paths

- Gemini SDK and configuration: `services/llm.service.ts`, `@google/genai`, `GEMINI_MODEL`, and `GEMINI_API_KEY`.
- Offline evaluator contract: `scripts/evaluate-commandflow-dataset.js`.
- Gold dataset: `evaluation/commandflow-eval-dataset.json`.
- MCP registry and execution boundary: `mcp/tools/index.ts`, `mcp/server.ts`, and the client policy.
- Database and security paths: Prisma access, authorization, approval, and MFA modules were inspected to confirm they are not imported by the runner.
- Offline tests: `tests/evaluation-package.test.js` and `tests/gemini-evaluation-runner.test.js`.

## Isolation findings

The runner:

- Imports only Node filesystem/path modules, `@google/genai`, and the offline parser-classification helper.
- Does not import MCP registries, tool dispatchers, Prisma, database services, authentication, approval workflows, or MFA verification.
- Does not provide Gemini function declarations or tool-calling configuration.
- Captures responses as data and never dispatches the predicted tool.
- Performs no automatic retries; one request attempt is recorded per case by default.
- Requires `--live` before constructing the live client or making a request.
- Redacts API-key, bearer-token, authorization, token, secret, and password-like values in saved artifacts.
- Writes live-run artifacts only under the Git-ignored `evaluation-results/` directory.

## Dataset and run policy

The runner reads the existing 63 cases without changing IDs, roles, utterances, or labels. The default plan is 63 recorded attempts, one per case. Provider failures and malformed responses are retained explicitly; no response is silently repaired. Predictions are saved in the `{runs:[{runId,predictions}]}` format consumed by the existing evaluator.

## Checkpoint result

Offline preflight passed dataset structure, unique IDs, import isolation, absent dispatch calls, absent function calling, API-key non-printing, no-retry policy, ignored output directory, model normalization, and one-attempt policy. API-key presence is **BLOCKED** because the offline shell does not expose `GEMINI_API_KEY`; its value was not displayed. No live request should be made until the operator reviews this report and supplies configuration through the existing environment only.

## Limitations

- Static import/call scanning is not a substitute for a production sandbox.
- No live provider response, latency, throughput, accuracy, robustness, or cost measurement exists.
- The runner uses the standalone evaluation prompt rather than the application execution prompt by design.
- A future live run must be separately authorized after the API key is configured and the preflight is rerun.
