# Operations

## Processes
| Process | Command | Needs |
|---|---|---|
| API | `npm start -w server` | MongoDB, `JWT_ACCESS_SECRET`, `SMTP_URL` (prod) |
| Worker | `npm run worker -w server` | MongoDB, shared upload storage, `NVIDIA_API_KEY` (optional) |
| Web | static `client/dist` behind `deploy/nginx.conf` | — |

`docker compose up --build` runs api, worker, web (http://localhost:8080), Prometheus (:9090) and
Grafana (:3000, dashboard "DocDoc"), with MongoDB from `server/.env`.
Multiple API instances need shared upload storage (S3 adapter in `lib/storage.js`) and a Redis rate-limit store.

## Health & monitoring
* `GET /health/live` — process up. `GET /health/ready` — database reachable (503 otherwise).
* Metrics: API `/metrics` (blocked at the gateway), worker `:9464/metrics`. Key series:
  `http_request_duration_seconds`, `pipeline_sources_total`, `pipeline_stage_duration_seconds`,
  `llm_request_duration_seconds`, `llm_tokens_total`, `agent_tool_calls_total`, `agent_runs_total`, Node defaults.
* Database: `mongodb_command_duration_seconds{command,outcome}`, `mongodb_pool_connections_in_use`,
  `mongodb_pool_checkout_failures_total`, `mongodb_heartbeat_failures_total` (API and worker).
* Real users (from `/api/v1/telemetry`): `frontend_web_vital_seconds`, `frontend_cls`,
  `frontend_web_vital_ratings_total`, `frontend_navigation_phase_seconds`, `frontend_api_request_duration_seconds`,
  `frontend_errors_total`, `frontend_workflows_total`, `frontend_csp_violations_total`.
* Logs: JSON (pino) with `requestId`, `userId`, route, status, latency. The browser sends a fresh
  `X-Request-Id` with every call and shows its first 8 characters on server errors, so a user's
  "reference" finds the log line. Frontend errors are logged as `frontend error` with the same id.

## Feature flags
Declared in `server/src/modules/flags/flags.js` with a default rollout. Override with
`FEATURE_FLAGS="record-contents=100,intent-prefetch=25,keyboard-shortcuts=off"` and restart the API;
the API refuses to start on an unknown flag or a bad percentage. Roll out in steps (5 → 25 → 100) while
watching the *Frontend: real users* row in Grafana.

## Performance budgets
Frontend budgets (Core Web Vitals, bundle size) are in [frontend engineering](frontend.md#3-performance)
and enforced in CI. API budgets (p95, excluding network):
| Endpoint | Budget |
|---|---|
| auth login/refresh | 400 ms (argon2 dominates by design) |
| case list, source list | 150 ms |
| compiled record (≤ 2 000 facts) | 500 ms |
| PDF export | 10 s |
| document processing, per page | OCR ≤ 5 s; AI structuring tracked via `llm_request_duration_seconds` |

## Backups & recovery
* **Atlas M0 (free) has no backups.** Before real data: move to M10+ with Cloud Backup and
  point-in-time recovery, or at minimum run scheduled `mongodump` to encrypted storage.
* Uploaded files are not in MongoDB: back up the upload volume / bucket on the same schedule.
* A backup counts only once a restore has been tested: restore into a scratch cluster quarterly and
  open a known case's compiled record.
* Use separate clusters and credentials for development, staging and production; the app's DB user
  needs `readWrite` on its database only (and `insert`/`find` only on `audit_logs`).

## Secrets
All secrets come from the environment (`server/.env` locally, a secret manager in production); `.env` is
git-ignored and CI runs gitleaks. Rotate `JWT_ACCESS_SECRET` (signs everyone out), SMTP and NVIDIA keys
by replacing the value and restarting.
