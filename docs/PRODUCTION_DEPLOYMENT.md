# Production Deployment

This document defines the committed production baseline for `enterprise-wb-analytics`.

**Primary hosting target: bare-metal `metric-pulse-app-01` under `systemd`.** `Dockerfile` and `render.yaml` were removed (P3-42, commit `eecb23d`) — the project does not ship a container image or a managed-PaaS recipe. Keep the operational runbook authoritative:

- [docs/operations/SERVER_PRODUCTION.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/SERVER_PRODUCTION.md)
- [docs/operations/DEPLOY_PROCEDURE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/DEPLOY_PROCEDURE.md)
- [docs/operations/BACKUP_POLICY.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/BACKUP_POLICY.md)

## Runtime Topology (production)

- web app: `Next.js` standalone (`.next/standalone/server.js`) under `systemd` unit `enterprise-wb-analytics.service`, listening on **port 3457** (override in unit, not 3000);
- background jobs: split self-hosted Inngest runtimes plus local Next worker apps: sync/core (`3458` + `8288`), redistribution (`3459` + `8290`), advertising/bidder (`3460` + `8292`), reviews/questions (`3461` + `8294`);
- database: local `postgresql@17-main.service`, database `enterprise_wb_analytics_prod`, role `enterprise_wb_analytics_user` (BYPASSRLS=false, RLS enforced app-wide);
- auth: self-hosted Supabase (`gotrue` + `kong`) in Docker, exposed via `https://про-цифры.рф/supabase`;
- Telegram webhook: `https://про-цифры.рф/api/bot`, secret-protected, update_id replay-protected;
- ingress: `nginx` on `:80/:443` (Let's Encrypt), proxying public traffic to `127.0.0.1:3457`.

## Live Server Snapshot

Live server contour on `ssh metric-pulse-app-01` (`202.181.148.140`) with exact paths, service names, pre-deploy backup location, deployed units, log locations and post-deploy health checks is documented in:

- [docs/operations/SERVER_PRODUCTION.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/SERVER_PRODUCTION.md)

## Environment Contract

Required for the app to boot correctly:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Required or strongly recommended for production:

- `ENCRYPTION_KEY` (64-char hex preferred; legacy UTF-8 supported with warning)
- `APP_BASE_URL`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY` (mandatory when `INNGEST_DEV` is unset — route returns 503 otherwise)
- `INNGEST_BASE_URL` (`http://127.0.0.1:8288` for the signed self-hosted runtime)
- `SUPABASE_URL_INTERNAL` (recommended for self-hosted split-url setup)
- `APP_RESET_URL` (recommended for self-hosted Supabase config `additional_redirect_urls`)
- `ALLOWED_HOSTS` (comma-separated; used to validate `x-forwarded-host` when constructing password reset redirect URLs — prevents host-header open redirect)

Optional integrations:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (min 32 chars; `/api/bot` returns 503 in production if missing/short)
- `TELEGRAM_OPS_CHAT_ID` (recommended if you want ops-watchdog alerts in Telegram; without it watchdog stays log-only)
- `WB_SYNC_FAST_CRON`
- `WB_SYNC_MEDIUM_CRON`
- `WB_SYNC_NIGHTLY_CRON`
- `WB_AD_API_MIN_INTERVAL_MS` (default 1100; global pacing for WB advertising endpoints except fullstats)
- `WB_FEEDBACK_ANSWER_MIN_INTERVAL_MS` (default 1500; pacing for WB review/question answer publishing)
- `SIGNAL_SLA_SWEEP_CRON`
- `SIGNAL_SLA_FOLLOW_UP_CRON`
- `REDISTRIBUTION_DIGEST_CRON`
- `REDISTRIBUTION_WINDOW_DAYS`
- `REDISTRIBUTION_OUTPUT_DIR`
- `REDISTRIBUTION_RPA_AUTO_QUEUE`
- `SYNC_STALE_ALERT_HOURS` (default 6)
- `SYNC_DORMANT_DAYS` (default 14 — tenants inactive this long are silenced to cut stale-sync-alert noise)
- `WB_RPA_DRY_RUN`
- `WB_RPA_HEADLESS`
- `WB_RPA_TIMEOUT_MS`
- `WB_RPA_SMS_CODE_SELECTOR`
- `WB_RPA_SMS_SUBMIT_SELECTOR`
- `WB_RPA_LOGIN_SUCCESS_SELECTOR`

Optional ops guardrails:

- `OPS_WATCHDOG_HEALTH_URL`
- `OPS_WATCHDOG_SYSTEMD_UNITS`
- `OPS_WATCHDOG_SYNC_LOOKBACK_MINUTES`
- `OPS_WATCHDOG_SYNC_RUN_LIMIT`
- `OPS_WATCHDOG_MAX_SYNC_KEYS`
- `OPS_WATCHDOG_STATE_PATH`
- `BACKUP_DIR` (default `/srv/backups/enterprise-wb-analytics/nightly`)
- `BACKUP_RETENTION_DAYS` (default 7)
- `BACKUP_RESTORE_DATABASE_URL` **must** point to a separate database than `DATABASE_URL`; backup script refuses to run otherwise
- `BACKUP_DATABASE_URL` (optional; production installer defaults backup source to `postgresql:///enterprise_wb_analytics_prod` in `.env.backup`)
- `BACKUP_RESTORE_MIN_TABLES` (default 10)

Required for real WB redistribution auto-upload (Playwright RPA):

- `WB_RPA_LOGIN_URL`
- `WB_RPA_REDISTRIBUTION_URL`
- `WB_RPA_LOGIN`
- `WB_RPA_LOGIN_SELECTOR`
- `WB_RPA_SUBMIT_SELECTOR`

Recommended `WB_RPA_REDISTRIBUTION_URL` baseline:

- `https://seller.wildberries.ru/analytics-reports/warehouse-remains`

Optional legacy login/password fields, completion selectors etc. — see [.env.example](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/.env.example) for the full list (kept there, not duplicated here to avoid drift).

For self-hosted Supabase local stack, fetch keys from:

```bash
npx supabase status --output json
```

Recommended split-url pattern for self-hosted:

- `NEXT_PUBLIC_SUPABASE_URL=https://<public-supabase-endpoint>`
- `SUPABASE_URL_INTERNAL=http://127.0.0.1:54321`

Note: for WB redistribution upload there is no public write API in this contour, so full auto-upload is implemented via Playwright browser automation.

## First Deploy (bare-metal, metric-pulse-app-01 baseline)

1. Provision Postgres 17 and the `enterprise_wb_analytics_user` role (not superuser, BYPASSRLS=false).
2. Clone the repo into `/srv/projects/enterprise-wb-analytics` pinned to `origin/main`.
3. Fill `.env.production` and `.env.runtime` from [.env.example](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/.env.example).
4. Run database migrations before accepting traffic:
   ```bash
   npm ci
   npm run db:migrate
   ```
5. Build standalone artifact:
   ```bash
   npm run build
   ```
6. Install systemd units shipped under [ops/systemd/](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/ops/systemd/) and logrotate config shipped under [ops/logrotate/](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/ops/logrotate/):
   ```bash
   bash ops/install-on-production.sh
   ```
   This installs the logrotate config, always enables the 5-min ops-watchdog timer, writes `.env.backup` for the postgres-owned backup service, enables the nightly backup timer only when `BACKUP_RESTORE_DATABASE_URL` points to a separate restore database, moves stale `.env.*.bak*` into `/srv/backups/.../env/`, and vacuums journalctl to 500M.
7. Configure signed Inngest runtime keys in `.env.runtime`: `INNGEST_BASE_URL=http://127.0.0.1:8288`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`; do not set `INNGEST_DEV` in production.
8. Verify health:
   ```bash
   curl http://localhost:3457/api/health | jq .
   ```
9. Run the human verification path from [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md).

## Ongoing Release Flow

Use this order before every production rollout:

1. `npm run predeploy:gate` — strict check including `release-baseline + smoke:operator:runtime`.
2. Take a pre-deploy DB snapshot per [docs/operations/BACKUP_POLICY.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/BACKUP_POLICY.md).
3. `git push origin main` locally.
4. On metric-pulse-app-01: `git pull --ff-only && npm ci && npm run build && npm run db:migrate`.
5. `systemctl restart enterprise-wb-analytics enterprise-wb-analytics-inngest`.
6. `npm run postdeploy:production` — enforces SHA parity, checks core `systemd` services, requires `enterprise-wb-analytics-watchdog.timer` to be active, requires `enterprise-wb-analytics-backup.timer` to be active only when `BACKUP_RESTORE_DATABASE_URL` points to a separate restore DB (otherwise it must stay inactive), rejects `failed` ops guardrail services, verifies internal/external `/api/health`, and runs one UI smoke scenario.
   By default it uses strict `login` mode and requires `SMOKE_EMAIL` / `SMOKE_PASSWORD`.
   For first bring-up on a fresh server you can explicitly override:
   `POSTDEPLOY_SMOKE_AUTH_MODE=auto` to allow generated signup/login,
   or `POSTDEPLOY_SMOKE_AUTH_MODE=skip` when you intentionally want infra-only verification.

## Runtime Health

`/api/health` is the primary health endpoint for hosts and load balancers.

It checks:

- app boot;
- database connectivity (`SELECT 1`);
- Supabase GoTrue health;
- Inngest reachability;
- presence of the required environment variables.

Healthy response contract:

- HTTP `200`
- `ok: true`
- `checks.app === "ok"`, `checks.db === "ok"`, `checks.supabase === "ok"`, `checks.inngest === "ok"`, `checks.env === "ok"`

Soft-degraded (`supabase` or `inngest` unreachable): HTTP `207`.

Hard fail (DB down, required env missing): HTTP `503`.

In production the response includes `missingEnvCount` but not variable names (to avoid mapping secrets for attackers); in development the full `missingEnv` array is included.

## Ops Automation (installed via `ops/install-on-production.sh`)

- `enterprise-wb-analytics-backup.timer` runs `scripts/nightly-db-backup.mjs` nightly at 03:30 MSK (randomized delay 600s) only after `BACKUP_RESTORE_DATABASE_URL` is configured to a separate restore database. In production it runs as OS user `postgres` and reads `.env.backup`, so `pg_dump` is not blocked by RLS or app-role table grants. It performs `pg_dump` + gzip, retention cleanup, **mandatory restore-test**, and sanity checks (table count ≥ 10, `sync_runs` present).
- `enterprise-wb-analytics-watchdog.timer` runs `scripts/ops-watchdog.mjs` every 5 min. It alerts Telegram when `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OPS_CHAT_ID` are configured; otherwise it stays green and logs the alerts locally instead of crashing.
- `WB_RPA_FAILURE_RETENTION_DAYS` / `WB_RPA_FAILURE_MAX_FILES` cap `output/wb-rpa/failures` so RPA screenshots stop accumulating without bound.
- `PLAYWRIGHT_SMOKE_RETENTION_DAYS` / `PLAYWRIGHT_SMOKE_MAX_DIRS` cap `output/playwright/operator-smoke-*` so browser smoke traces/screenshots do not grow forever.
- `/etc/logrotate.d/enterprise-wb-analytics` rotates `/var/log/enterprise-wb-analytics*.log` daily with 7-day retention + gzip + `copytruncate`.

## Rollback

If a release is unhealthy:

1. `systemctl stop enterprise-wb-analytics enterprise-wb-analytics-inngest` on metric-pulse-app-01;
2. `git reset --hard <previous_sha>` in `/srv/projects/enterprise-wb-analytics`;
3. do **not** rollback the database blindly — only restore from the snapshot taken **before** this deploy if the failure is schema-related;
4. `npm ci && npm run build && systemctl start ...`;
5. re-run `/api/health`, login flow, and manual sync verification after rollback.

## Self-Hosted Supabase Caveat

`supabase start` currently injects `API_EXTERNAL_URL=http://127.0.0.1:54321` into `gotrue`, so recovery emails can contain localhost verify links even when `site_url` is external (known `supabase/cli` issue `#4006`).

Current workaround:

- expose Supabase API through a stable public endpoint behind server ingress;
- replace `http://127.0.0.1:54321` in the recovery link with the current public Supabase host (for this contour: `https://про-цифры.рф/supabase`);
- keep `/reset-password` route in the app and process the returned `code`/token there.
