# Enterprise WB Analytics: Project Guide

This document describes the repository as it actually exists on `2026-05-11`. It replaces generic or optimistic descriptions with the current implementation baseline.

## 1. Product Boundary

This repository is the `web/SaaS` implementation of the WB analytics product:

- multi-tenant operator UI;
- WB API ingestion and analytics processing;
- auth/session/cabinet management;
- dashboard views for current business metrics.
- platform admin backoffice for accounts, stores, subscriptions, payments, and operational health.

This repository is not the full Google Apps Script runtime described in some root prompt files. Those prompts are requirement sources and backlog inputs, not the literal architecture of this codebase.

## 2. Implemented Baseline

Completed implementation slices:

- `P0`: tenant isolation and route/server-action access checks
- `P1`: local user bootstrap and first-cabinet onboarding
- `P2`: Drizzle schema and migration reconciliation
- `P3`: WB ingestion hardening and `sync_runs` observability
- `P4`: operator-ready empty/error/no-tenant states across current screens
- `P9`: repeatable operator smoke path for `login -> settings -> manual sync -> overview -> economics`
- `P10`: team workflow finish for cabinet membership and invites
- `P11`: local DB migration repair path
- `P12`: local Inngest runtime baseline
- `P13`: sync diagnosis normalization and token feedback
- `P14`: WB token preflight and sync history UX in `settings`
- `P15`: guarded token save lifecycle and persisted last-known token health
- `P16`: guarded new-cabinet onboarding and sync token-health surfacing
- `P17`: token-health visibility in the cabinet list and global tenant switcher
- `P18`: chart container baseline for the overview Recharts runtime
- `P19`: smoke auth-navigation cleanup for false-positive dev abort noise
- `P20`: smoke auto-auth cleanup for generated-email login noise
- `P21`: dashboard data-freshness context across the main operator screens
- `P22`: actionable signal drill-down with product context and operator next steps
- `P23`: signal follow-up navigation into focused `economics` and `explorer` states
- `P24`: back-to-signal navigation from focused `economics` and `explorer`
- `P25`: operator memory context for signals with source-aware return markers and recent reviewed-signal history
- `P26`: server-side signal operator timeline shared across devices and users
- `P27`: signal collaboration workflow with notes, assignee, and handoff state
- `P28`: signal-list workflow filters plus in-app/Telegram collaboration notifications
- `P29`: persisted notification read/ack state and bulk signal triage
- `P32`: saved signal views and server-derived SLA aging in the working feed
- `P33`: saved-view editing/default presets and overview-level SLA summary
- `P34`: team/shared saved views with pinning and deterministic ordering
- `P35`: overdue-only queues, saved sort presets, and one-click SLA escalation actions
- `P36`: team-wide saved-view default fallback and pin-first quick access
- `P37`: SLA queue presets, server-side bulk automation, and explicit SLA notifications
- `P38`: scheduled SLA sweep through Inngest cron with overdue-only dedupe
- `P39`: shared queue ownership, automation run audit trail, and escalation outcomes
- `P40`: automation run drill-down with per-signal inspection from overview
- `P41`: queue owner workflow layer with owner filters, workload summary, and owner-grouped saved views
- `P42`: SLA pending follow-up reminders with manual run-log action and scheduled follow-up sweep
- `P43`: follow-up wave outcome tracking inside SLA automation runs
- `P44`: owner-level queue summary strip in the top-level overview KPI layer
- `P45`: explicit acknowledged/action/no-action capture on top of follow-up reminder waves
- `P46`: automation control plane with dry-run preview, health summary, and suppress/unsuppress controls
- `P47`: automation governance with suppress-until reason/audit trail and manual preview-to-execute history
- `P48`: explicit follow-up outcomes enforced in reminder scheduling with awaiting-outcome pauses and grace windows
- `P49`: dedicated automation notification preferences and routing for SLA-driven notes
- `P50`: escalation alerts for stale awaiting-outcome follow-ups with run-log visibility
- `P51`: owner-queue entry points with route-aware workload lanes from KPI strip and feed cards
- `P52`: owner-level shared defaults plus direct queue handoff and rebalance operations
- `P53`: production contour with health endpoint, Docker/Render artifacts, CI, tests, and pilot operating docs
- `P54`: WB advertising contour reconciliation for current promotion endpoints and normquery stats
- `P55`: WB ad-spend sync reconciliation for current `adv/v3/fullstats`
- `P56`: WB sync runtime reconciliation for funnel v3, paid-storage task flow, and stock snapshot dedupe
- `P57`: WB live-sync stabilization for `fullstats -> null`, paid-storage rate limiting, ad-cluster batch dedupe, and visible sync progress in settings
- `P58`: WB advertising window-limit compliance for `fullstats` and `normquery` on long manual sync ranges
- `P59`: WB advertising rate-limit hardening plus paid-storage dedupe before DB upsert
- `P60`: dashboard freshness repair, empty-group unblock, and honest conversion availability in overview
- `P61`: isolated metric-pulse-app-01 server deployment baseline with dedicated systemd services, DB contour, backup checkpoint, and external quick-tunnel access runbook
- `P62`: platform admin backoffice foundation with billing schema, read-only account/store view, Russian UI, and production owner access for `vitea_b@mail.ru`
- `P8`: release blocker cleanup for repo-wide lint, runtime baseline commit, and reproducible release checks

Current product surfaces in the repository:

- auth flow in `src/app/(auth)/login`
- dashboard screens in `src/app/(dashboard)`
- data routes in `src/app/api/views`
- health route in `src/app/api/health/route.ts`
- manual sync trigger, WB token preflight, and sync history in settings
- platform admin pages in `src/app/(admin)/admin` (`/admin`, `/admin/customers`, `/admin/subscriptions`)
- Inngest endpoint in `src/app/api/inngest/route.ts`
- Telegram bot endpoint in `src/app/api/bot/route.ts`

## 3. Tech Stack

- `Next.js 16.2.2`
- `React 19.2.4`
- `Supabase SSR` and `@supabase/supabase-js`
- `PostgreSQL`
- `Drizzle ORM` + custom SQL migration runner
- `Inngest`
- `Zustand`
- `TanStack Query`
- `date-fns`
- `lucide-react`
- `recharts`

## 4. Auth, Access, And Tenant Model

The app is designed as a multi-tenant analytics platform. The effective security model currently implemented in the repo is:

- Supabase-based authenticated session handling;
- server-side session validation for dashboard access;
- explicit tenant membership checks through `src/lib/auth/tenant-access.ts`;
- tenant-scoped reads and writes in dashboard routes and server actions;
- denormalized active tenant stored on `users.tenant_id`;
- authoritative membership mapping in `user_tenants`.

Roles currently used in the app:

- `owner`
- `admin`
- `viewer`

Important clarification:

- the repo uses both application-level membership checks and database-enforced RLS;
- `requireTenantAccess` remains the canonical app-layer guard, while strict RLS is the canonical database backstop for tenant-scoped tables.
- platform admin access is separate from tenant roles and is checked through `platform_admins`;
- production currently has one platform owner: `vitea_b@mail.ru`; do not add other platform admins without explicit approval.

## 5. Data Model

The schema source of truth is `src/lib/db/schema.ts`. The baseline currently includes:

- `tenants`
- `users`
- `user_tenants`
- `platform_admins`
- `platform_audit_log`
- `plans`
- `subscriptions`
- `payments`
- `billing_events`
- `invitations`
- `sync_runs`
- `risk_signals`
- `signal_notification_receipts`
- `signal_operator_timeline`
- `products`
- `unit_economics_configs`
- `stock_planning_inputs`
- raw WB data tables for orders, sales, realization reports, stocks, paid storage, prices, ads, ad clusters, funnel stats, and content metadata
- product grouping tables used by `dynamics`

Migration history currently tracked in git spans `drizzle/0000_hard_snowbird.sql` through `drizzle/0072_sales_plan.sql`.

For the exact current chain, consult both:

- `drizzle/`
- `drizzle/meta/_journal.json`

For the local development database in this workspace, use:

```bash
npm run db:repair-local
```

This helper repairs the known local drift pattern where `public` contains most of the schema but is missing `raw_api_prices`, `sync_runs`, `signal_operator_timeline`, `signal_notification_receipts`, `signal_saved_views`, the committed `tenant` token-health columns, the signal-collaboration columns added in `0005`, the signal notification preferences from `0007`, the saved-view default column from `0009`, the saved-view scope/sort/pin/order fields from `0010`, and the `drizzle.__drizzle_migrations` metadata schema.

## 6. Ingestion And Sync Runtime

There are two sync contours in the repo.

### Manual sync

Triggered from the settings screen and handled by `src/inngest/sync-wb.ts`.

Characteristics:

- emits a `wb/sync.requested` event;
- persists run metadata into `sync_runs`;
- tracks `pending`, `running`, `completed`, `completed_with_errors`, or `failed`;
- stores per-source summary and error context;
- isolates failures source-by-source instead of aborting the entire sync on the first failing API.

### Token preflight

The settings screen now exposes an explicit WB token preflight before a full sync.

Current behavior:

- can validate either the draft token from the input field or the stored encrypted token;
- checks `Statistics API`, `Content API`, `Prices API`, and `Advertising API`;
- classifies invalid token, auth failure, upstream failure, network failure, or missing-token cases into short operator feedback;
- renders per-contour results inline so the operator can see whether the token is fully valid or only partially usable before starting sync.

### Token save lifecycle

The settings screen no longer saves WB tokens blindly.

Current behavior:

- the primary save path runs a server-side preflight for the draft token and only persists the token immediately when preflight passes cleanly;
- if preflight reports a risky or invalid state, the first save attempt is stopped and turned into an explicit warning state in the UI;
- the operator may then choose a separate `save with warning` path when they want to persist a problematic token intentionally;
- the active tenant stores last-known token health so the saved-token state survives reloads and cabinet switches.

The same guarded lifecycle now applies to `new cabinet` onboarding from the settings modal:

- a new cabinet first attempts to connect through strict preflight;
- if the supplied token is risky or invalid, the modal exposes a separate `connect with warning` path instead of silently creating the cabinet;
- smoke verification now exercises this exact branch with a fake WB token.

### Cron jobs

Defined as Inngest functions in `src/server/jobs`.

Current schedules in code:

- orders sync: every 60 minutes via `0 * * * *`
- finance sync: daily at `02:00` via `0 2 * * *`
- SLA overdue sweep: hourly at `15 * * * *` unless overridden by `SIGNAL_SLA_SWEEP_CRON`
- SLA pending follow-up sweep: every 2 hours at `45 */2 * * *` unless overridden by `SIGNAL_SLA_FOLLOW_UP_CRON`

Current behavior:

- iterates through tenants with WB tokens;
- decrypts tokens before calling the WB API;
- logs tenant-scoped failures and continues.

### Local Inngest runtime baseline

For local development, manual sync is expected to run against the Inngest Dev Server, not against a missing background runtime.

Recommended commands:

```bash
npm run dev:runtime
npm run smoke:operator:runtime
```

Supporting commands:

```bash
npm run dev
npm run inngest:dev
```

Current baseline:

- `src/inngest/client.ts` reads `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, and optional `INNGEST_BASE_URL` from env;
- `/api/inngest` now registers both manual sync and scheduled job functions;
- manual sync surfaces a concrete operator error when the local Inngest Dev Server is not running;
- the runtime smoke can now verify that `sync_runs` moves beyond `pending` through the local worker path.

## 7. Dashboard Screens

Current screen set:

- `overview`
- `overview-test`
- `economics`
- `economics-template` (main unit-economics surface; `/economics` redirects here)
- `stocks`
- `redistribution`
- `dynamics`
- `explorer`
- `settings`

Operator-readiness changes already implemented:

- explicit empty states;
- explicit no-tenant states;
- explicit retryable error states;
- real sync status based on `sync_runs`, not fake progress;
- local manual sync baseline repaired so `sync_runs` records are written instead of failing on a missing table;
- sync diagnosis now collapses repeated invalid-token `401` failures into one operator-readable action message plus source-level breakdown;
- settings now exposes explicit WB token preflight with inline contour-level feedback;
- settings now persists last-known token health for the saved key and surfaces it as a dedicated operator card;
- token save is now a guarded lifecycle with a strict save path and a separate explicit warning override;
- new-cabinet onboarding now follows the same guarded token policy instead of bypassing it;
- sync controls now surface token-health risk before launch and change the primary action copy when the saved token is risky;
- cabinet cards in `settings` and the global tenant switcher now surface the last-known token state for each cabinet, not only the active token form;
- settings now shows recent sync history, expandable per-run source breakdown, quick retry, quick refresh, and an explicit empty-history state;
- the overview PnL chart now waits for a measured container size before mounting Recharts, removing the remaining local runtime console warning from the main smoke flow;
- the operator smoke harness now reuses the post-auth `/settings` redirect instead of forcing a second reload, so `ECONNRESET` noise in `next dev` is no longer mistaken for a product issue;
- the default smoke path now starts auto-auth with `signup` when it uses a fresh generated email, removing the predictable `Invalid login credentials` noise from runtime logs;
- the main dashboard screens now show a shared data-freshness banner based on `sync_runs`, including last usable sync and active-range coverage context;
- the signals feed now opens a real right-side drill-down panel with SKU context, warehouse breakdown, 14-day metrics, and next-step links instead of a decorative `Детали` button;
- those signal next-step links now open `economics` or `explorer` already focused on the relevant `nmId` and, for raw data, the most relevant source tab;
- `economics` and `explorer` now surface an explicit signal-focus banner so operators can see when they are in a narrowed workflow and clear that focus intentionally;
- focused `economics` and `explorer` screens now also carry the originating `signalId` and expose a direct return path to `/overview`, which reopens the signal drawer on arrival;
- that return path is now source-aware: `overview` shows whether the operator came back from `economics` or `explorer`, and the drawer now reads/writes a server-side timeline event with actor, source, and timestamp instead of relying on local browser memory;
- focused `explorer` state now preserves `signalId` while the operator switches raw tabs, so the return path does not disappear mid-investigation;
- the signal drawer now shows the last operator who reviewed the signal, a short timeline for this signal, and recent reviewed signals across the tenant, all backed by `signal_operator_timeline`;
- the signal drawer now also supports shared comments, explicit assignee selection, and workflow states (`new`, `in_progress`, `handoff`, `blocked`) stored on `risk_signals` and mirrored into the shared timeline;
- the signals feed now supports assignee/workflow filters and surfaces assignee/workflow chips directly on each card, so team triage works from the list view too;
- the dashboard header now shows an in-app collaboration notification center backed by `signal_operator_timeline`, and collaboration events also fan out to Telegram when tenant notifications are enabled;
- in-app collaboration notifications now persist `read` and `acknowledged` state per user through `signal_notification_receipts`, so the header badge is not just ephemeral client state;
- the signals feed now supports bulk triage actions for assign, workflow handoff, resolve, and ignore over the current visible selection;
- `settings` now persists per-channel signal notification preferences: tenant-wide Telegram event prefs plus per-user in-app prefs for `note`, `assignment/reassignment`, `blocked`, and a dedicated `automation` stream for SLA-driven notes;
- the signals feed now supports bulk shared notes, prefilled comment templates, and one-click handoff presets that apply assignee + workflow + note bundles over the current visible selection;
- the signal drawer now reuses the same note templates and handoff presets as the bulk feed, so operators do not maintain two different collaboration flows depending on where they open the signal;
- the signals list now also exposes queue-style working views for `needs action`, `blocked`, and `awaiting owner`, layered on top of the raw assignee/workflow filters;
- those queue/filter combinations can now be persisted as user-level saved views backed by `signal_saved_views`, so operators can reopen their working presets without rebuilding filters manually;
- saved views now support in-place rename/edit plus one default preset per user, which auto-applies when the operator opens `overview`;
- shared/team views now also support a manager-controlled team default fallback, so operators without a personal default still reopen `overview` in the intended shared queue;
- pinned saved views now surface as quick-access shortcuts ahead of the longer view lists, making the most important queues one click away;
- saved views now also support private vs team scope, pinning, and explicit move up/down ordering, with edit rights constrained to the owner or a tenant manager for shared presets;
- shared/team saved views can now also declare an explicit queue owner separate from the creator, so ownership of a working queue persists even when the preset is edited or reused by other operators;
- operators can now open an `overdue only` queue and switch between `severity`, `sla_pressure`, and `newest` sorting, and the selected sort can be persisted inside a saved view;
- the feed now shows server-derived queue aging and SLA state per signal, including overdue handoff and blocked escalation chips based on `workflow_updated_at` or signal creation time;
- signal cards and the signal drawer now both expose one-click escalation actions derived from shared workflow presets, so overdue `needs action`, `handoff`, and `blocked` work can be advanced without a manual multi-step update;
- `overview` now also ships explicit SLA queue presets (`all overdue`, `blocked overdue`, `handoff overdue`) that can be opened or saved as views with one click;
- those presets can trigger server-side bulk SLA automation, which groups overdue signals by escalation preset and writes SLA-marked notes into the shared timeline instead of requiring card-by-card escalation;
- the same SLA automation path is now also wired into `signalSlaSweepJob`, a scheduled Inngest cron function that scans tenants server-side, targets only overdue signals, and suppresses repeated scheduled escalations within the dedupe window;
- every recorded SLA automation run now persists into `signal_automation_runs` with actor/source/view ownership context, and `overview` shows the latest run log together with outcome counts (`pending`, `progressed`, `resolved`, `ignored`);
- each automation run can now be expanded in `overview` to fetch and inspect the exact signals touched by that run, including note text, preset id, current workflow/SLA state, and a direct jump back into the signal drawer;
- `overview` now also exposes a queue-owner filter and compact owner workload summary, so team queues can be sliced by accountable operator before opening the shared view list;
- team views are now grouped by queue owner and can seed a new owner-specific team preset directly from the owner block instead of relying on the creator to rebuild the queue manually;
- those owner workload summaries are now also direct queue entry points: both the top KPI strip and the feed-level owner cards can open an owner-scoped `needs action`, `awaiting owner`, `blocked`, or `overdue` lane via route state, and the owner filter now scopes the actual signal feed rather than only the shared-view/automation sections;
- shared defaults are now split into a global `team default` fallback plus per-owner `owner default` presets, so one owner lane can have a canonical reopen preset without wiping the rest of the shared queue model;
- feed-level owner cards now also act as queue operations: managers can send the current selected batch straight into an owner queue or apply a suggested workload rebalance from the busiest owner lane without rebuilding the action in bulk triage manually;
- SLA automation runs now also surface follow-up history (`followUpCount`, `lastFollowUpAt`) and allow one-click reminder over the still-pending subset of the run;
- follow-up reminders are now grouped into explicit waves, so the run log can show not just that a reminder happened, but what the latest reminder wave actually achieved (`pending`, `progressed`, `resolved`, `ignored`);
- those reminder waves now also support explicit operator outcomes (`acknowledged`, `action taken`, `no action`), captured as dedicated timeline notes and surfaced directly in the run drill-down;
- those explicit outcomes now also change reminder behavior itself: a wave without explicit outcome blocks repeat reminders, `acknowledged` and `action taken` apply reminder grace windows, and `no action` stops repeat follow-up for that signal until state changes elsewhere;
- a second cron path, `signalSlaFollowUpJob`, now scans recent completed automation runs and can emit scheduled follow-up reminders for pending outcomes without waiting for a human to reopen `overview`;
- the same automation area now also exposes a dry-run preview panel, recent automation health, and suppress/unsuppress controls per queue owner or saved view, so operators can govern the automation path from `overview` itself;
- that governance layer now also persists manual `preview -> execute` history in a dedicated control-event log and keeps suppression lifecycle audit (`reason`, `suppress until`, `cleared by`) instead of deleting context on unsuppress;
- `overview` now also renders an owner summary strip above the SLA strip, so the busiest shared queues are visible in the KPI layer before the operator opens the feed;
- active signals now also surface the latest escalation outcome chip, so an operator can see whether the last escalation is still pending or already moved after handoff;
- in-app notifications now tag those SLA automation notes explicitly, so the header menu separates SLA-driven escalations from ordinary collaboration comments, and both in-app and Telegram channels now route them through a dedicated `automation` preference instead of the generic `note` toggle;
- follow-up sweeps now also emit `sla_follow_up_escalation` alerts when a reminder wave sits too long without explicit outcome, with dedupe plus per-run / per-wave / per-signal alert counters in the automation log;
- `overview` now also renders a compact SLA summary strip for `blocked overdue`, `handoff overdue`, and aging `needs action`, so escalation pressure is visible before the operator scrolls into the feed;
- viewer-safe behavior in signals actions.

The goal of the current UI is operational clarity, not final visual polish.

## 8. Environment Variables

Core variables:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Optional or path-specific variables:

- `ENCRYPTION_KEY`
- `TELEGRAM_BOT_TOKEN`
- `APP_BASE_URL`
- `APP_RESET_URL`
- `INNGEST_BASE_URL`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `SUPABASE_URL_INTERNAL`
- `SUPABASE_ANON_KEY_INTERNAL`
- `WB_SYNC_FAST_CRON`
- `WB_SYNC_MEDIUM_CRON`
- `WB_SYNC_NIGHTLY_CRON`
- `WB_SYNC_ACTIVE_LOCK_MINUTES`
- `WB_SYNC_STALE_TIMEOUT_MINUTES`
- `WB_SUPPLY_WRITEOFF_CRON`
- `WB_SUPPLY_WRITEOFF_LOOKBACK_DAYS`
- `SIGNAL_SLA_SWEEP_CRON`
- `SIGNAL_SLA_FOLLOW_UP_CRON`
- `REDISTRIBUTION_DIGEST_CRON`
- `REDISTRIBUTION_WINDOW_DAYS`
- `REDISTRIBUTION_OUTPUT_DIR`
- `REDISTRIBUTION_RPA_AUTO_QUEUE`
- `WB_RPA_DRY_RUN`
- `WB_RPA_HEADLESS`
- `WB_RPA_TIMEOUT_MS`
- `WB_RPA_SMS_CODE_SELECTOR`
- `WB_RPA_SMS_SUBMIT_SELECTOR`
- `WB_RPA_LOGIN_SUCCESS_SELECTOR`
- `WB_RPA_LOGIN_URL`
- `WB_RPA_REDISTRIBUTION_URL`
- `WB_RPA_LOGIN`
- `WB_RPA_LOGIN_SELECTOR`
- `WB_RPA_SUBMIT_SELECTOR`
- `WB_RPA_REDISTRIBUTION_TRIGGER_SELECTOR`
- `WB_RPA_REDISTRIBUTION_DIALOG_SELECTOR`
- `WB_RPA_ARTICLE_SELECTOR`
- `WB_RPA_WAREHOUSE_INPUT_SELECTOR`
- `WB_RPA_FROM_WAREHOUSE_SELECTOR`
- `WB_RPA_TO_WAREHOUSE_SELECTOR`
- `WB_RPA_REDISTRIBUTION_SUBMIT_SELECTOR`
- `WB_RPA_SIZE_SELECTOR`
- `WB_RPA_TRANSFER_UNITS_SELECTOR`
- `WB_RPA_FILE_INPUT_SELECTOR`
- `WB_RPA_UPLOAD_SUBMIT_SELECTOR`
- `WB_RPA_SUCCESS_SELECTOR`
- `WB_RPA_SUCCESS_TEXT`
- `WB_RPA_PASSWORD` (optional legacy)
- `WB_RPA_PASSWORD_SELECTOR` (optional legacy)

The repo assumes a local `.env` exists for development. Baseline keys and defaults are documented in [.env.example](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/.env.example).

For WB redistribution RPA, use `WB_RPA_REDISTRIBUTION_URL=https://seller.wildberries.ru/analytics-reports/warehouse-remains` as the baseline target.

## 9. Development Commands

Main commands:

```bash
npm run dev
npm run dev:runtime
npm run inngest:dev
npm run build
npm run lint
npm run test
npm run test:coverage
npm run db:migrate
npm run db:migration:check
npm run db:repair-local
npm run smoke:operator
npm run smoke:operator:runtime
```

Verification policy in practice:

- `npm run build` is currently the strongest whole-app integration check;
- `npm run lint` now passes on the committed baseline;
- `npm run test` now covers the core signal queue and notification helper layer, so the repo no longer depends only on browser smoke for regression signal;
- `npm run db:repair-local` is the first recovery command when local runtime errors point to missing committed tables;
- `npm run smoke:operator:runtime` is the preferred end-to-end local runtime check for manual sync;
- `npm run smoke:operator` now conditionally opens the signal drill-down when the overview contains at least one active signal;
- when a signal exists, smoke now also follows the first recommendation link and verifies the focused target screen if it lands on `economics` or `explorer`;
- targeted `npx eslint ...` remains useful for faster focused slices.

## 10. Documentation And Process

Canonical repo docs:

- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [AGENTS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/AGENTS.md)
- [docs/IMPLEMENTATION_BACKLOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/IMPLEMENTATION_BACKLOG.md)
- [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)
- [docs/PRODUCTION_DEPLOYMENT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PRODUCTION_DEPLOYMENT.md)
- [docs/operations/SERVER_PRODUCTION.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/operations/SERVER_PRODUCTION.md)
- [docs/PILOT_OPERATIONS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PILOT_OPERATIONS.md)

Source-of-truth rule:

1. deployed server snapshot on `metric-pulse-app-01` (`/srv/projects/enterprise-wb-analytics`)
2. local repository working copy
3. backlog/changelog inside this repo
4. root project passport
5. external WB docs and release notes

Working contract:

- develop and validate locally first;
- merge/push into `origin/main`;
- deploy on `metric-pulse-app-01` via `git pull --ff-only` in `/srv/projects/enterprise-wb-analytics`;
- after deploy, always run parity check by local/server `main` commit SHA (or file checksums when needed).

## 11. Known Gaps

Still unfinished at the repo level:

- direct production ingress is on nginx `:80/:443`; internal Docker/Inngest/noVNC ports rely on `enterprise-wb-network-hardening.service`
- non-dev Inngest cloud runtime wiring (`INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`)
- production migration automation beyond manual `npm run db:migrate`
- deeper integration/e2e coverage after the new unit-test baseline
- final release hardening for `v1`

## 12. Tax Modes And Profit Report

Tax modes available in tenant settings UI for WB sellers:

- `usn_income`
- `usn_income_expenses`
- `ausn_income`
- `ausn_income_expenses`
- `osn_ip`
- `osn_company`

Compatibility note:

- historical/legacy values can still exist in DB (`npd_individual`, `npd_company`, `esxn`, `patent`) and remain supported by backend formula code for safe reads;
- UI intentionally hides them because this product contour is WB-focused.

Tax defaults and aliases are centralized in [src/lib/tax/regimes.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/tax/regimes.ts).
Legacy `ausn` is normalized to `ausn_income`.

Profit decomposition endpoint:

- `GET /api/views/profit-report?tenantId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD`
- optional: `nmId=<WB nmId>`
- optional: `format=csv`

Response is Russian-structured and includes formula + totals + per-SKU decomposition:

- revenue
- WB commission
- logistics
- other fees
- COGS
- storage
- ads
- profit before tax
- tax amount
- net profit
