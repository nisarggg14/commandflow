# Runtime configuration

## Gemini intent analysis

The running application uses `@google/genai` 2.12.0's Interactions API. In this SDK version, the Interactions API has a separate retry policy and does not inherit the constructor-level HTTP timeout. CommandFlow therefore sets `timeout` and `maxRetries: 0` on each interaction call, then applies its own bounded retry policy; permanent provider errors are not retried.

| Variable | Default | Accepted values |
|---|---:|---|
| `GEMINI_REQUEST_TIMEOUT_MS` | `4000` | Integer from `500` to `30000` |
| `GEMINI_MAX_ELAPSED_MS` | `15000` | Integer from `1000` to `60000`, and no less than the request timeout |
| `GEMINI_MAX_ATTEMPTS` | `3` | Integer from `1` to `5` |
| `GEMINI_RETRY_BASE_DELAY_MS` | `250` | Integer from `0` to `2500` |
| `GEMINI_RETRY_MAX_DELAY_MS` | `2500` | Integer from `0` to `10000` |

Set `GEMINI_API_KEY=<server-side API key>` and `GEMINI_MODEL=<model available to the API key>` separately. Do not expose the API key to the browser. Invalid timeout/retry configuration fails explicitly at service startup.

The intent-analysis stage measures the model request, including any bounded retries. MCP plan preparation is separately timed for response parsing and schema/authorization validation. The complete chat handler duration is returned in the `X-Request-Duration-Ms` response header and logged with the request ID.

## Inventory Backend

Set `INVENTORY_API_BASE_URL=<Inventory Backend base URL>`. The development-only loopback exception applies only when the requested origin exactly matches this configured origin, for example `http://localhost:5000`. It is never enabled in production.

Connected Inventory clients use the backend source contract: `POST /auth/login` with `{ "username": "...", "password": "..." }`, which returns a JWT in the `token` field; CommandFlow then sends that token as a Bearer token to `GET /products`. The backend currently declares product GET routes public, so its source does not enforce authentication on that read endpoint; the connection test verifies login and sends the obtained token with the real read request. The JWT is not persisted, and a fresh login is performed for connected-client API requests. The external password is AES-GCM encrypted in the existing `ConnectedClient.authConfig` using `MFA_ENCRYPTION_KEY`.

Authenticated Inventory client URLs must use HTTPS except for the configured development loopback URL. The `20261023110000_connected_client_test_status` migration adds last-test metadata without deleting or rewriting existing client records.

The migration `20261023095950_company_invitation_code` adds storage for a hash of the company invitation code. Apply it with the existing database migration workflow (`npm run db:migrate`) before deploying the updated application. Invitation codes are created or rotated by an authorized company Admin in the Users administration page; the raw code is returned once and only its SHA-256 hash is stored.

The migration `20261023110000_connected_client_test_status` adds nullable last-connection-test metadata to existing clients. Apply it with `npm run db:migrate`; existing clients are preserved and are not assumed to be live merely because they are configured.
