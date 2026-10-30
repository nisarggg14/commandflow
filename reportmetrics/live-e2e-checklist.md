# CommandFlow live E2E QA checklist

Test date/time: 2026-10-15, Asia/Calcutta (+05:30)
Repository: `a3ae2a7`, branch `feature/mcp-runtime`
Environment: Windows, Node.js v24.8.0, npm 11.6.0, Next.js 16.2.6

Status meanings: PASS = directly observed; FAIL = observed behavior contradicts expected behavior; BLOCKED = required dependency/tool unavailable; NOT TESTED = intentionally not run or unsupported.

| Area | Scenario | Status | Evidence |
|---|---|---|---|
| Startup | Verified start command | PASS | `npm run start` launched Next.js and reported `http://localhost:3000`; ready in 5.3s |
| Startup | Development server | BLOCKED | `npm run dev` failed with Windows `spawn EPERM` in Next child process |
| Startup | Frontend route | PASS | `GET /` returned 307 to `/login`; followed response returned 200 |
| Startup | Required backend route reachability | PASS | Auth and protected routes responded; database-backed login blocked |
| Startup | TypeScript errors | PASS | Prior `npm run typecheck` exited 0 |
| Startup | Browser console errors | NOT TESTED | No browser automation/console tool available |
| Startup | Database connectivity | BLOCKED | PostgreSQL TLS error: no credentials available in Windows security package |
| Authentication | Valid login | BLOCKED | No usable test account/database connection; no credentials exposed or created |
| Authentication | Incorrect credentials | FAIL | Safe fake credentials reached route but response exposed internal Prisma/TLS error; see defect D-001 |
| Authentication | Missing token protected endpoint | PASS | `GET /api/auth/me` returned 401 `Authentication required.` |
| Authentication | Malformed/expired/invalidated token | NOT TESTED | No valid test session could be established; no forged token generated |
| Authentication | Protected API without cookie | PASS | Middleware redirected `/api/chat`, `/api/logs`, `/api/approvals`, and `/api/connected-clients` to `/login` with 307 |
| LLM/MCP | Read-only natural-language request | BLOCKED | Requires authenticated conversation, database, and Gemini key/provider |
| LLM/MCP | Tool/argument accuracy | NOT TESTED | No live model call; no accuracy claim |
| LLM/MCP | Unsupported/malformed tool request | NOT TESTED live | Deterministic controls covered by local harness and source tests; Node test runner previously hit `spawn EPERM` |
| Validation | Ordinary status update accepts permitted status | PASS local fixture | Harness accepted `PROCESSING` schema |
| Validation | Ordinary status update cannot request cancellation | PASS local fixture | Harness rejected `CANCELLED` |
| Authorization | Viewer Manager-only order update | PASS local fixture | Harness rejected Viewer authorization |
| Authorization | Manager Admin-only cancellation | PASS local fixture | Harness rejected Manager authorization |
| Risk | HIGH approval/MFA absence | NOT TESTED live | Requires database-backed approval/MFA fixture; no approval granted |
| Risk | Approval tampering/replay/duplicate execution | NOT TESTED live | Existing automated cases are present but test runner blocked |
| Connected API | Approved sandbox endpoint | NOT TESTED | No designated sandbox endpoint available |
| Connected API | Loopback/private destination | PASS | Local harness/order attempt rejected by SSRF guard before request |
| Connected API | Redirect bypass | NOT TESTED live | Source uses manual redirects and SSRF validation; no sandbox request available |
| Connected API | Timeout/error handling | NOT TESTED live | No safe reachable mock client through configured connector |
| Audit/tenant | Successful/rejected audit events | BLOCKED | Requires database connectivity and authenticated execution |
| Audit/tenant | Secret redaction | PASS source/local evidence | Existing redaction implementation and local tests; live DB log inspection not performed |
| Audit/tenant | Cross-company isolation | NOT TESTED live | Requires two connected test companies/database access |
| Performance | Frontend/login routing | PASS | Local curl timings recorded in report |
| Performance | Authenticated E2E request | BLOCKED | Database and Gemini unavailable |
| Performance | LLM/application/mock API separation | NOT TESTED | No live provider/sandbox request made |