# Enterprise WB Analytics

`enterprise-wb-analytics` is the `web/SaaS` implementation track of the Wildberries analytics product. This repository is not the same thing as the Google Apps Script concepts described in the root prompts. The code here is a Next.js application with Supabase auth, PostgreSQL/Drizzle data storage, Inngest-based sync jobs, and operator-facing analytics screens.

## Current Status

As of 2026-04-05, the repo has a working baseline for:

- authenticated access and tenant isolation;
- local user bootstrap and first-cabinet onboarding;
- Drizzle schema + migration consistency;
- resilient WB ingestion with per-source diagnostics for manual sync;
- explicit WB token preflight across the key API contours before full sync;
- guarded token save lifecycle with `save only if preflight passes` and explicit `save with warning`;
- persisted last-known health for the saved WB token in `settings`;
- WB advertising preflight now checks the current promotion campaign contour instead of the obsolete media-count endpoint, ad spend sync now uses the current `adv/v3/fullstats` contour, and ad-cluster sync resolves real `advertId + nmId` pairs before requesting normquery stats;
- WB funnel sync now uses the current Analytics v3 sales-funnel endpoint, paid-storage sync now uses the task-based reports flow, and stock sync deduplicates WB snapshot rows before DB upsert so one noisy source no longer poisons the full run with stale `404`/duplicate-key failures;
- manual sync now persists source-level progress in `sync_runs`, shows a live percentage/current-source bar in `settings`, treats WB `adv/v3/fullstats -> null` as an empty ads slice instead of a hard failure, spaces paid-storage downloads to reduce WB `429` noise on long ranges, and deduplicates ad-cluster rows before DB upsert;
- advertising sync now also respects WB range limits by splitting `adv/v3/fullstats` requests into `31`-day windows and `adv/v1/normquery/stats` requests into shorter windows, so long manual sync ranges stop failing with `WB API 400` just because the operator requested a month-plus interval;
- advertising sync now also respects the documented `adv/v3/fullstats` pacing contract (`1 request / 20 seconds`) instead of exhausting retries on WB `429`, and paid-storage rows are deduplicated before DB upsert so the last two live-sync error sources are no longer a rate-limit plus duplicate-batch combination;
- dashboard freshness now compares coverage on calendar-day granularity instead of false-positive timestamp drift, empty product groups can be populated directly from the synced product catalog, and overview shows `н/д` for conversion when the selected period has no funnel coverage instead of a misleading `0.0%`;
- guarded onboarding for a new cabinet with the same WB token warning flow as the main settings card;
- post-sync history, per-run source breakdown, and fast retry/refresh workflows in `settings`;
- real signals drill-down in `overview` with SKU context, warehouse breakdown, and next-step links instead of a decorative details button;
- contextual signal follow-up navigation: links from the signal drill-down now open `economics` or `explorer` already focused on the relevant SKU and raw tab;
- focused `economics` and `explorer` screens now expose a direct `back to signal` path to reopen the originating signal on `overview`;
- the signal drawer now uses a server-side operator timeline with `who / when / from where` context, recent reviewed signals, and source-aware return badges from `economics` and `explorer`;
- signal collaboration workflow now supports shared notes, assignee selection, and handoff/workflow state directly in the drawer so investigation context survives between operators and devices;
- the signals feed now supports operator filters by assignee and workflow state, and the header exposes an in-app notification center for new notes, reassignments, and blocked signals;
- collaboration events now also trigger Telegram notifications to the tenant chat when notifications are enabled;
- in-app collaboration notifications now have persisted `unread/read` and `acknowledged` state per user, and the signals feed supports bulk triage for assign/handoff/resolve/ignore flows;
- operators can now tune collaboration notification types separately for in-app and Telegram channels (`note`, `reassignment`, `blocked`, `automation`);
- the signals feed now supports bulk shared notes, comment templates, and one-click handoff presets for common operator workflows;
- the signal drawer now uses the same note templates and handoff presets as the bulk triage flow, so single-signal and batch workflows stay aligned;
- `overview` now exposes explicit working queues for `needs action`, `blocked`, and `awaiting owner`, not only raw assignee/workflow filters;
- operators can now persist saved signal views per cabinet/user, so queue presets survive reloads and device switches;
- saved signal views now support rename/edit and one per-user default preset that auto-applies on overview load;
- saved signal views now also support private vs team scope, pinning, and explicit ordering for shared operator queues;
- shared signal views now support a team-wide default fallback and pin-first quick access, so operators without a personal preset still land in the intended shared queue;
- shared signal views can now also persist an explicit queue owner, so team queues stop depending on the creator alone and can be assigned to the operator who actually owns the workload;
- `overview` now exposes an explicit `overdue only` queue plus saved sort presets for `severity`, `SLA pressure`, and `newest touched` workflows;
- signal cards now surface server-derived queue aging and SLA escalation state, including overdue `handoff` and `blocked` signals;
- signal cards and the signal drawer now both expose one-click escalation actions backed by shared workflow presets;
- `overview` now also exposes SLA queue presets with one-click save and server-side bulk SLA automation for overdue queues;
- scheduled SLA automation now also runs through an Inngest cron sweep with overdue-only targeting and repeat-escalation dedupe, so the operator workflow is not dependent on opening `overview`;
- `overview` now also exposes a server-backed SLA automation run log with source, saved-view context, queue owner snapshot, and current escalation outcomes;
- each SLA automation run can now be expanded in `overview` to inspect the concrete affected signals, note body, preset, and current per-signal outcome before reopening the signal drawer;
- `overview` now also exposes queue-owner filtering, owner workload summary cards, and owner-grouped team saved views so shared queues can be worked as accountable operator lanes;
- those owner workload cards are now actionable queue entry points: KPI strip and feed-level owner cards can open `needs action`, `awaiting owner`, `blocked`, or `overdue` lanes directly, and the owner filter now scopes the real signal feed instead of only the side panels;
- shared/team saved views now support owner-level defaults in addition to the global team fallback, so each owner queue can reopen in its own canonical preset without clobbering the tenant-wide shared default;
- owner workload cards now also expose direct team operations: managers can hand off the current selected batch straight into an owner queue and run a suggested workload rebalance from the busiest owner lane;
- SLA automation runs now also track follow-up reminders for pending outcomes, and the run log exposes one-click reminder actions before the operator has to reopen individual signals;
- follow-up reminders are now tracked as waves, so the run log shows the latest reminder wave outcome instead of only raw reminder counts;
- those reminder waves now also support explicit `acknowledged / action taken / no action` capture прямо из run drill-down, so operator feedback is visible even before the signal status changes;
- explicit follow-up outcomes now affect the reminder engine itself: unresolved waves pause further reminders until an explicit outcome is captured, `acknowledged` and `action taken` apply grace windows, and `no action` suppresses repeated follow-up on that signal;
- `overview` now surfaces owner-level workload already in the KPI area through a dedicated owner summary strip above the feed;
- scheduled SLA follow-up now runs through a second Inngest cron sweep, so stale pending outcomes can be reminded server-side even when nobody is watching the run log;
- the SLA automation area now also works as a control plane: it exposes dry-run preview, recent automation health, and suppress/unsuppress controls per saved view or queue owner;
- that control plane now also keeps governance history for manual `preview -> execute` chains and a persistent suppression audit trail with `reason`, `suppress until`, and `cleared by` lifecycle data;
- the notification center now marks SLA-driven escalation events explicitly instead of blending them into generic note traffic, and those events can now be muted independently through the dedicated `automation` preference;
- follow-up reminders that stay without explicit operator outcome long enough now trigger separate SLA escalation alerts with dedupe, and the run log surfaces both alert counts and the last escalation timestamp;
- `overview` now exposes an SLA summary strip for overdue `blocked`, overdue `handoff`, and aging `needs action` queues;
- the repo ships a committed production contour with `/api/health`, `.env.example`, and a GitHub CI workflow (`Dockerfile` и `render.yaml` удалены в P3-42 — deploy идёт через bare-metal `systemd` на `metric-pulse-app-01`, см. `docs/operations/DEPLOY_PROCEDURE.md`);
- automated verification is now wider than browser smoke: `vitest` covers core signal-queue and notification helper logic, and release baseline checks include unit tests;
- pilot/business operation is now documented explicitly with roles, queue policy, KPI definitions, and a daily/weekly operating cadence;
- operator-ready screens for `overview`, `economics`, `dynamics`, `explorer`, `settings`, and `team`.

The project is not yet fully production-ready. The main known gaps are:

- strict production ingress/runtime (named tunnel or reverse proxy + non-dev Inngest cloud keys) is not finalized yet;
- automated test coverage is still minimal.

## Stack

- `Next.js 16` + `React 19`
- `Supabase` for authentication/session handling
- `PostgreSQL` + `Drizzle ORM`
- `Inngest` for sync jobs and event-driven ingestion
- `Zustand` for client session/store state
- `TanStack Query` for dashboard/server-action data flows
- `Lucide React`, custom CSS utilities, and chart/table dashboard components

## Main Product Surfaces

- `/login`: signup/login and invitation acceptance flow
- `/settings`: active cabinet settings, cabinet switching, first-cabinet onboarding, WB token preflight, last-known token health, manual sync trigger, and sync history
- `/cabinets/[tenantId]/team`: team access management and invitation flow per cabinet
- `/overview`: KPI summary, signal feed, and signal drill-down
- `/economics`: unit-economics analytics with optional signal-driven SKU focus
- `/dynamics`: grouped product dynamics
- `/explorer`: tabular product explorer with optional signal-driven SKU/tab focus
- `/reviews-qa`: unified queue for WB reviews/questions with Yandex GPT draft generation, WB publish actions, and an auto mode for reviews
- `/api/views/*`: server-backed data routes for dashboard screens
- `/api/agent/v1/report`: private service-to-service reporting API for Telegram bots and other agent clients
- `/api/inngest`: Inngest handler endpoint
- `/api/health`: production health endpoint for host/load-balancer checks

## Required Environment

Minimum environment variables expected by the app/runtime:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Additional variables used by specific paths:

- `ENCRYPTION_KEY`: recommended for WB token encryption/decryption
- `TELEGRAM_BOT_TOKEN`: required only for Telegram bot notifications/integration
- `TELEGRAM_WEBHOOK_SECRET`: optional shared secret header (`x-telegram-bot-api-secret-token`) for webhook endpoint hardening
- `TELEGRAM_OPS_CHAT_ID`: optional Telegram destination for ops-watchdog alerts; if unset, watchdog stays in local log-only mode
- `AGENT_API_KEY`: optional single-client secret for the private agent/reporting API
- `AGENT_API_CLIENT_ID`: optional label for the single-client agent key (default `default`)
- `AGENT_API_ALLOWED_REPORTS`: optional comma-separated allowlist for the single-client key; defaults to all built-in agent reports
- `AGENT_API_ALLOWED_TENANT_IDS`: optional comma-separated tenant UUID allowlist for the single-client key; defaults to all tenants
- `AGENT_API_ALLOWED_CABINET_OIDS`, `AGENT_API_WORKER_ID`, `AGENT_API_ROLES`: optional Procifry RBAC fields for single-client mode
- `AGENT_API_CLIENTS`: optional JSON array for multi-client agent API config; when set, it overrides the simple single-client agent vars
- `YANDEX_GPT_API_KEY`: required for AI draft generation in `/reviews-qa`
- `YANDEX_GPT_FOLDER_ID`: required Yandex Cloud folder for `/reviews-qa` generation requests
- `YANDEX_GPT_MODEL_NAME`: optional model suffix for Yandex GPT (defaults to `yandexgpt/latest`)
- `APP_BASE_URL`: optional public app URL used in Telegram deep-links for collaboration alerts
- `APP_RESET_URL`: optional explicit reset-password URL (used by self-hosted Supabase auth redirect allow-list)
- `INNGEST_EVENT_KEY`: required for production event delivery to Inngest outside local dev runtime
- `INNGEST_SIGNING_KEY`: required so `/api/inngest` can verify production requests from Inngest
- `WB_SYNC_FAST_CRON`: optional cron override for fast WB sync profile (default `0 * * * *`)
- `WB_SYNC_MEDIUM_CRON`: optional cron override for medium WB sync profile (default `15 */2 * * *`)
- `WB_SYNC_NIGHTLY_CRON`: optional cron override for nightly WB sync profile (default `10 2 * * *`)
- `WB_SYNC_ACTIVE_LOCK_MINUTES`: lock window for considering `pending/running` sync runs as active in scheduled/retry jobs (default `60`)
- `WB_SYNC_STALE_TIMEOUT_MINUTES`: auto-timeout for stale `pending/running` runs during settings/overview sync history reads (default `60`)
- `REVIEWS_QA_AUTO_REPLY_CRON`: optional cron override for automatic review replies (default `*/15 * * * *`)
- `REVIEWS_QA_AUTO_BATCH_SIZE`: optional max unanswered reviews processed per tenant on each auto run (default `15`, max `50`)
- `REVIEWS_QA_AUTO_TONE`: optional Yandex GPT tone for auto replies (`friendly|neutral|formal`, default `friendly`)
- `SIGNAL_SLA_SWEEP_CRON`: optional cron override for the scheduled SLA sweep; defaults to `15 * * * *`
- `SIGNAL_SLA_FOLLOW_UP_CRON`: optional cron override for the scheduled SLA pending follow-up sweep; defaults to `45 */2 * * *`
- `REDISTRIBUTION_DIGEST_CRON`: optional cron override for daily redistribution digest (default `30 3 * * *`)
- `REDISTRIBUTION_WINDOW_DAYS`: optional historical window for redistribution model (default `30`)
- `REDISTRIBUTION_OUTPUT_DIR`: optional folder for persisted redistribution CSV files (default `output/redistribution`)
- `REDISTRIBUTION_RPA_AUTO_QUEUE`: enable automatic queueing of Playwright upload job after CSV export (`true|false`, default `false`)
- `REDISTRIBUTION_ROUTE_SCAN_CRON`: daily cron for warehouse/route scan registry refresh (default `35 6 * * *`)
- `REDISTRIBUTION_ROUTE_WAREHOUSE_LOOKBACK_DAYS`: lookback for warehouse discovery from stock snapshots (default `60`)
- `REDISTRIBUTION_ROUTE_LIMIT_TTL_HOURS`: how long a `limit_exhausted` route stays blocked in planning (default `20`)
- `REDISTRIBUTION_ROUTE_UNAVAILABLE_TTL_DAYS`: TTL for routes marked unavailable by RPA (default `14`)
- `REDISTRIBUTION_ROUTE_AVAILABLE_TTL_DAYS`: freshness TTL for routes confirmed as available (default `21`)
- `REDISTRIBUTION_SLOT_MONITOR_TICK_CRON`: cron tick for slot monitor dispatcher (default `* * * * *`)
- `REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_WINDOWS_MSK`: comma-separated aggressive monitor windows in Moscow time `HH:MM-HH:MM` (default `08:40-10:30,11:55-12:20,15:55-16:20,17:55-18:20`)
- `REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_START_MSK` / `REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_END_MSK`: legacy single aggressive window fallback when `REDISTRIBUTION_SLOT_MONITOR_AGGRESSIVE_WINDOWS_MSK` is unset
- `REDISTRIBUTION_SLOT_MONITOR_BACKGROUND_INTERVAL_MIN`: outside aggressive window monitor runs every N minutes (default `3`)
- `REDISTRIBUTION_SLOT_MONITOR_MAX_ROUTES_PER_TENANT`: default per-tenant route probe cap used by manual monitor/API (default `8`)
- `REDISTRIBUTION_SLOT_MONITOR_MAX_ROUTES_PER_TENANT_AGGRESSIVE`: per-tenant route probe cap during aggressive window (default `24`)
- `REDISTRIBUTION_SLOT_MONITOR_MAX_ROUTES_PER_TENANT_BACKGROUND`: per-tenant route probe cap in background mode (default `8`)
- `REDISTRIBUTION_SLOT_MONITOR_RECENT_HOURS`: horizon for “recently opened slots” UI block (default `24`)
- `REDISTRIBUTION_SLOT_MONITOR_AUTO_SUBMIT`: if `true`, slot monitor immediately submits transfer when route becomes available (`true` by default, set `false` for observation-only mode)
- `REDISTRIBUTION_SLOT_MONITOR_MATRIX`: if not `false`, slot monitor also records observation-only WB route-matrix events for all official source/destination warehouses returned by WB for sampled SKUs
- `REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT`: per-tenant SKU sample size for route-matrix monitoring (default `5`)
- `REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT`: per-tenant route-matrix event cap per monitor run (default `300`)
- `REDISTRIBUTION_SLOT_MONITOR_HTTP_429_BACKOFF_MIN`: scheduler cooldown after WB LK returns HTTP 429 (default `6`; manual UI runs are not blocked)
- `WB_RPA_DRY_RUN`, `WB_RPA_HEADLESS`, `WB_RPA_TIMEOUT_MS`: optional runtime tuning for WB redistribution upload script
- `WB_RPA_LOGIN_URL`, `WB_RPA_REDISTRIBUTION_URL`, `WB_RPA_LOGIN`, `WB_RPA_LOGIN_SELECTOR`, `WB_RPA_SUBMIT_SELECTOR`: required for real WB cabinet upload via Playwright RPA (phone/SMS flow)
- recommended `WB_RPA_REDISTRIBUTION_URL`: `https://seller.wildberries.ru/analytics-reports/warehouse-remains` (the app also probes known fallback routes if WB changes navigation)
- `WB_RPA_SMS_CODE_SELECTOR`, `WB_RPA_SMS_SUBMIT_SELECTOR`, `WB_RPA_LOGIN_SUCCESS_SELECTOR`: optional selectors for explicit SMS confirmation/login-success checks
- `WB_RPA_PASSWORD`, `WB_RPA_PASSWORD_SELECTOR`: optional legacy selectors if your WB login form still has password step
- `WB_RPA_REDISTRIBUTION_TRIGGER_SELECTOR`, `WB_RPA_REDISTRIBUTION_DIALOG_SELECTOR`, `WB_RPA_ARTICLE_SELECTOR`, `WB_RPA_WAREHOUSE_INPUT_SELECTOR`, `WB_RPA_FROM_WAREHOUSE_SELECTOR`, `WB_RPA_TO_WAREHOUSE_SELECTOR`, `WB_RPA_REDISTRIBUTION_SUBMIT_SELECTOR`, `WB_RPA_SIZE_SELECTOR`, `WB_RPA_TRANSFER_UNITS_SELECTOR`: optional selectors for modal flow on `warehouse-remains`
- `WB_RPA_FILE_INPUT_SELECTOR`, `WB_RPA_UPLOAD_SUBMIT_SELECTOR`, `WB_RPA_SUCCESS_SELECTOR`, `WB_RPA_SUCCESS_TEXT`: optional legacy completion/wait selectors for CSV upload flow
- `SUPABASE_URL_INTERNAL`: optional server-only override for Supabase API URL (recommended for self-hosted setups where browser should use a public URL but server should stay on private localhost/network)
- `SUPABASE_ANON_KEY_INTERNAL`: optional server-only override for anon key (defaults to `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `BACKUP_RESTORE_DATABASE_URL`: required before enabling the nightly backup timer; must point to a different database than `DATABASE_URL`

Notes:

- `drizzle.config.ts` has a local fallback Postgres URL for tooling, but application runtime should still be configured explicitly via `.env`.
- copy from [.env.example](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/.env.example) when bootstrapping a new environment;
- a local `.env` file exists in this workspace and is intentionally not documented here line-by-line.
- for self-hosted Supabase local stack, pull keys/URLs from `npx supabase status --output json` and align `NEXT_PUBLIC_SUPABASE_URL` with the externally reachable Supabase endpoint.
- WB does not provide a public write API for this redistribution upload contour at the time of this document; full auto-upload therefore uses browser RPA (Playwright) with explicit selectors and saved browser session (phone/SMS login).
- WB LK storage state is persisted encrypted in the database; the runtime only materializes short-lived temp files during active RPA runs.

## Private Agent API

For Telegram assistants and other automation clients, the app now exposes a private reporting endpoint:

- `POST /api/agent/v1/report`
- auth: `Authorization: Bearer <AGENT_API_KEY>` or `X-Agent-Api-Key: <AGENT_API_KEY>`
- tenant isolation: request must include a `tenantId`, and the key can be tenant-scoped via `AGENT_API_ALLOWED_TENANT_IDS` / `AGENT_API_CLIENTS`
- built-in reports in `v1`: `dashboard_summary`, `unit_economics_summary`, `sync_status`

Example:

```bash
curl -X POST https://про-цифры.рф/api/agent/v1/report \
  -H 'Authorization: Bearer replace-with-agent-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "00000000-0000-0000-0000-000000000000",
    "report": "unit_economics_summary",
    "params": { "days": 7, "nmId": 12345678 }
  }'
```

The endpoint returns structured JSON plus `summaryText`, so a Telegram bot can either show the short text as-is or reformat the numeric payload.

Procifry workers use the same key registry, but every key should be bound to a concrete `workerId`, tenant allowlist, optional `cabinetOids`, and RBAC roles:

- roles: `read_all_wb_digitization`, `write_analysis`, `write_tasks`, `write_drafts`, `write_scenarios`, `request_approval`, `execute_approved_actions`, `admin_methodology`
- worker-scopes are enforced server-side for the configured worker ids (`wb-data-integrator`, `wb-economics-analyst`, `wb-ads-analyst`, etc.)
- `POST /api/agent/v1/procifry` records safe artifacts/tasks/drafts/scenarios/approval requests plus audit rows
- `GET /api/agent/v1/procifry` reads stored Procifry artifacts, approvals, or audit rows
- `GET /api/agent/v1/catalog` returns the report catalog with params, fields, freshness sources, and date coverage when `tenantId` is supplied
- `POST /api/agent/v1/report` now includes read-only worker reports such as `stocks_summary`, `stock_history`, `oos_history`, `reviews_summary`, `questions_summary`, `card_content_summary`, `card_group_summary`, `price_history`, `advertising_campaigns`, `advertising_campaign_stats`, `search_positions_summary`, `competitor_cards_summary`, `ab_tests_summary`, and `finance_realization_detail`
- empty read-only report ranges return `ok=true` with `items=[]`, `sourceUpdatedAt` and `dateCoverage`; `available=false` is reserved for truly missing sources
- direct WB-changing actions are not executed here; `external_action` only records an execution and requires `execute_approved_actions` plus an approved `approval_id`
- multi-cabinet calculations must pass `multi_tenant: true` when more than one `tenant_id` is present

Procifry write example:

```bash
curl -X POST https://про-цифры.рф/api/agent/v1/procifry \
  -H 'Authorization: Bearer replace-with-worker-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "worker_id": "wb-economics-analyst",
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "cabinet_oid": "lavrov-main",
    "period_from": "2026-05-01",
    "period_to": "2026-05-07",
    "source": "procifry-worker",
    "source_updated_at": "2026-05-07T09:00:00Z",
    "confidence": "confirmed",
    "access_mode": "draft",
    "resource_type": "scenario",
    "title": "Минимальная безопасная цена",
    "payload": { "nmId": 12345678, "minSafePrice": 890 }
  }'
```

The built-in Telegram bot in this repo now also reuses the same report builder for linked tenant chats:

- `/dashboard [days]`
- `/unit <nmId> [days]`
- `/economics <nmId> [days]`
- `/stock <nmId>`
- `/ads <nmId> [days]`
- `/reviews [limit]`
- `/sync`
- `/support <text>`

Report commands with cabinet data are private-chat only by default. Groups can
receive notifications, but group report commands require an explicit
`TELEGRAM_ALLOW_GROUP_REPORT_COMMANDS=true` override for trusted chats.

The chat must be linked to exactly one tenant. The canonical link table is
`telegram_chat_links`; legacy `tenants.telegram_chat_id` remains a fallback
during migration from the older Settings flow. New links should be created from
Settings through a one-time `t.me/<bot>?start=<token>` URL backed by
`telegram_link_tokens`.

## Local Development

```bash
npm install
npm run dev:runtime
```

Useful additional commands:

```bash
npm run dev
npm run inngest:dev
npm run build
npm run test
npm run test:coverage
npm run db:migrate
npm run db:repair-local
npm run smoke:operator
npm run smoke:operator:runtime
npm exec drizzle-kit check -- --config=drizzle.config.ts
```

## Verification Baseline

What currently gives reliable signal:

- `npm run build`
- `npm run test`
- `npm run db:repair-local` if the local Postgres baseline is behind the committed migrations
- `npm run lint`
- `npm run smoke:operator` for the main operator path
- `npm run smoke:operator:runtime` for a self-contained local `Next + Inngest` runtime check
- `npm exec drizzle-kit check -- --config=drizzle.config.ts` for schema drift checks

## Repo Map

- [AGENTS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/AGENTS.md): repo operating rules
- [docs/IMPLEMENTATION_BACKLOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/IMPLEMENTATION_BACKLOG.md): phased delivery plan and current status
- [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md): implementation log
- [docs/PROJECT_GUIDE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PROJECT_GUIDE.md): repo-accurate technical guide
- [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md): current release/test baseline
- [docs/PRODUCTION_DEPLOYMENT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PRODUCTION_DEPLOYMENT.md): production topology, env contract, health, and rollout flow
- [docs/operations/SERVER_PRODUCTION.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/SERVER_PRODUCTION.md): live metric-pulse-app-01 server runbook, service map, and post-deploy checks
- [docs/PILOT_OPERATIONS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PILOT_OPERATIONS.md): roles, queues, KPIs, and pilot cadence
- [docs/SMOKE_OPERATOR_FLOW.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SMOKE_OPERATOR_FLOW.md): repeatable browser smoke path
- [PROJECT_PASSPORT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/PROJECT_PASSPORT.md): cross-project strategic passport in the root workspace
