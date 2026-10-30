# CommandFlow Live End-to-End QA Report

## Scope and safety

This was a local-only QA run against the existing repository. No application code, security policy, database schema, dependencies, credentials, production service, external API, destructive operation, approval, or MFA bypass was used. The server was stopped after probing. Secrets were not printed; only environment variable names were inspected.

Test timestamp: 2026-10-15 18:29:30 +05:30 (Asia/Calcutta)
Revision: `a3ae2a7`; branch `feature/mcp-runtime`
Runtime: Windows, Node.js `v24.8.0`, npm `11.6.0`, Next.js `16.2.6`

## Verified startup path

`package.json` defines `npm run dev` as `next dev` and `npm run start` as `next start`. `npm run dev` was attempted first and failed before serving with Windows `spawn EPERM`. The existing production-style `npm run start` command then launched successfully and reported:

```text
Next.js 16.2.6
Local: http://localhost:3000
Ready in 5.3s
```

The application was tested only at `localhost:3000` and then terminated cleanly with Ctrl+C.

## Routes tested

| Request | Expected | Observed | Duration/evidence |
|---|---|---|---|
| `GET /` | Unauthenticated user redirected to login | 307 redirect; followed response 200 | 0.702s initial; 0.232s followed |
| `GET /api/auth/me` | Reject missing authentication | 401, `Authentication required.` | 0.187s; JSON body contained no secret |
| `POST /api/auth/login` with fake non-existent account | Reject credentials safely | 401, but leaked internal Prisma/TLS error | Database-backed; exact sanitized body below |
| `POST /api/auth/register` with `{}` in production mode | Registration disabled | 404 | No account created |
| `POST /api/auth/logout` without cookie | Safe idempotent logout | 200 | No authenticated session existed |
| `GET /api/chat` without cookie | Protected | 307 to `/login`; followed response was login HTML | 0.013s initial; 0.012s followed |
| `GET /api/logs` without cookie | Protected | 307 to `/login` | 0.005s |
| `GET /api/connected-clients` without cookie | Protected | 307 to `/login` | 0.007s |
| `GET /api/approvals` without cookie | Protected | 307 to `/login` | 0.007s |
| `GET /api/not-a-route` | 404 | 404 | 0.181s |

Response examples, with no credentials or tokens:

```json
GET /api/auth/me
{"success":false,"message":"Authentication required."}
```

```json
POST /api/auth/register
{"success":false,"message":"Public registration is disabled."}
```

The fake login used an invented `.invalid` email and a non-secret test string. The response was:

```json
{"success":false,"message":"<internal Prisma/TLS connection error>"}
```

The server log showed PostgreSQL TLS failure: `Error opening a TLS connection: No credentials are available in the security package`. The complete internal error is intentionally not reproduced here.

## Live findings

### D-001 — Internal database error exposed by login endpoint

- Severity: Medium security/reliability defect.
- Reproduction: with the local server running, `POST /api/auth/login` with syntactically valid fake JSON credentials while the configured database is unavailable.
- Expected: a generic authentication failure or service-unavailable response that does not expose ORM, database, TLS, filesystem, or provider details.
- Actual: HTTP 401 with the Prisma/TLS error message in `message`.
- Evidence: `app/api/auth/login/route.ts` returns `error.message` for every caught error; live response exposed the database connection failure.
- Recommended fix: distinguish invalid credentials from infrastructure failures and return a generic client-safe message; log detailed diagnostics only through sanitized server-side logging. Do not treat this report as approval to implement the fix.

No other live defect was asserted. Redirect behavior for protected API routes is recorded as observed; whether JSON 401 responses are preferred for API clients requires a product decision.

## Separation of evidence types

- Live API tests: local `next start` route probes listed above.
- Live UI test: only HTTP frontend/login reachability; no browser interaction.
- Local deterministic harness: `metrics-report/benchmark-harness.mjs`; schema, authorization, MCP UI dispatch, and SSRF rejection.
- Automated tests: existing Node test suite was previously blocked by Windows `spawn EPERM` before test bodies.
- Real sandbox integration: not run; no designated sandbox endpoint was configured.
- LLM evaluation: not run; provider key/model calls were not used.

## Not verified

Valid login, authenticated chat, Gemini-to-MCP selection, live result rendering, MFA setup/verification, approval lifecycle, cross-company data access, connected-client success, redirect behavior against a reachable sandbox, timeout distribution, browser console output, and authenticated end-to-end performance remain unverified.

## Commands executed

```powershell
Get-Content -Raw package.json
Get-Content .env | ForEach-Object { if ($_ -match '^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=') { $matches[1] } }
rg --files app/api -g route.ts
npm run dev
npm run start
curl.exe ... localhost probes
Invoke-WebRequest ... fake login
npm run typecheck
node --import tsx metrics-report/benchmark-harness.mjs
git diff --check
```

The exact safe benchmark reproduction remains in `metrics-report/reproduce.md`. The full status checklist is in `live-e2e-checklist.md`.
## Reproducible live probe commands

Start and probe from PowerShell:

```powershell
npm run start
curl.exe -sS -o NUL -w "frontend status=%{http_code} time=%{time_total}s" http://localhost:3000/
curl.exe -sS -w "`nstatus=%{http_code}`n" http://localhost:3000/api/auth/me
curl.exe -sS -o NUL -w "register status=%{http_code} time=%{time_total}s" -X POST -H "Content-Type: application/json" --data-raw "{}" http://localhost:3000/api/auth/register
curl.exe -sS -o NUL -w "logout status=%{http_code} time=%{time_total}s" -X POST http://localhost:3000/api/auth/logout
curl.exe -sS -o NUL -w "connected-clients status=%{http_code} time=%{time_total}s" http://localhost:3000/api/connected-clients
curl.exe -sS -o NUL -w "approvals status=%{http_code} time=%{time_total}s" http://localhost:3000/api/approvals
```

For the database-backed negative login probe, the request body was created without printing credentials:

```powershell
$body = @{ email = 'qa-invalid@example.invalid'; password = 'invalid-test-only' } | ConvertTo-Json -Compress
Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://localhost:3000/api/auth/login' -ContentType 'application/json' -Body $body
```

The expected database blocker is documented rather than bypassed. Stop the server with Ctrl+C after the probes.