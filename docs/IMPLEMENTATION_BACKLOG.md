# Implementation Backlog

Last updated: 2026-05-19

## Active multi-stage tracks (2026-05-19)

- **Telegram bot / Procifry assistant** —
  [`TELEGRAM_BOT_PRODUCT_PLAN.md`](./TELEGRAM_BOT_PRODUCT_PLAN.md).
  Цель — один безопасный бот для быстрых отчетов, уведомлений, поддержки и
  approval-заявок без риска cross-tenant выдачи. Stage 1 done:
  `telegram_chat_links`, private-only report commands by default, legacy
  fallback from `tenants.telegram_chat_id`. Stage 2 done: one-time
  `telegram_link_tokens` deep-link binding from Settings to `/start <token>`.
  Stage 3 done: `/stock`, `/ads`, `/reviews`, `/support`. Frozen for current
  release; further commands are parked until separate approval.

- **SEO карточек WB** —
  Stage 1 done: `/seo` scans cached WB cards, prioritizes
  content/media/characteristic/funnel/stock issues, shows recommendations and
  lets an operator apply title/description changes from the selected card.
  Next: richer SEO draft generation from semantic clusters/search queries,
  characteristic suggestions by subject, and post-apply WB error-list polling.

- **Marketplace expansion: WB + Ozon + Яндекс Маркет** —
  [`OZON_INTEGRATION_PLAN.md`](./OZON_INTEGRATION_PLAN.md),
  [`YANDEX_MARKET_INTEGRATION_PLAN.md`](./YANDEX_MARKET_INTEGRATION_PLAN.md).
  Цель — один личный кабинет селлера с общим auth/billing/team/admin слоем и
  разными рабочими интерфейсами под WB, Ozon и Яндекс Маркет. Ozon и Яндекс
  Маркет не внедряются как поля в текущий WB-tenant; нужен слой marketplace
  accounts, shop/campaign слой для Яндекс Маркета, отдельные sync-процессы,
  отдельные pages и последующий нормализованный слой для общей аналитики.

- **Redistribution rewrite + WB ЛК Auth v2** —
  [`REDISTRIBUTION_REWRITE_PLAN.md`](./REDISTRIBUTION_REWRITE_PLAN.md).
  Этап 1 (Auth v2) на 90% in progress, Этап 2 (HTTP вместо Playwright) —
  TODO, Этап 3 (новый UI `/redistribution`) — done без backend auto-submit.
  Контекст, решения, SHA коммитов, селекторы и edge cases — в плане.

- **Platform admin + billing backoffice** —
  [`ADMIN_PANEL_PLAN.md`](./ADMIN_PANEL_PLAN.md).
  Status: A0/A1/A2 done, A3 manual billing operations next. Цель — отдельный
  `/admin` для platform admins, billing/subscription model, ручные оплаты на MVP и
  последующая YooKassa integration без смешивания с tenant-level ролями
  `owner/admin/viewer`.

- **Финансовый контур** —
  Статус: первый рабочий срез готов. `/finance` хранит счета/кассы, ручные
  операции, долги и план-факт. Дальше: импорт банка/таблиц, связь платежей с
  партиями `production_orders`, автоподтягивание выплат Вайлдберриз и сверка
  движения денег с отчетом о прибыли.

- **Рекламный автопилот** —
  [`advertising/ADVERTISING_AUTOPILOT_MINIMAL_UX.md`](./advertising/ADVERTISING_AUTOPILOT_MINIMAL_UX.md).
  P92-P102 закрывают минимальный первый экран, склейки, advisor-confirm flow,
  режимы автопилота, проверки карточки, heatmap, profit-aware решения и
  background executor карточек, генерацию правил расписания из heatmap и
  campaign/SKU/group hourly attribution. Дальше: тестирование цены + ставки как
  единой бизнес-гипотезы.

Status legend:

- `todo`
- `in_progress`
- `blocked`
- `done`

## Current Delivery Rule

Work in small slices. One closed item should normally end with:

1. relevant code or doc changes;
2. verification;
3. changelog update;
4. one focused git commit.

## Enterprise Launch Track (2026-04-15 audit)

> Полный отчёт: [`ENTERPRISE_AUDIT_2026-04-15.md`](./ENTERPRISE_AUDIT_2026-04-15.md).
> Чек-лист со статусами: [`ENTERPRISE_LAUNCH_CHECKLIST.md`](./ENTERPRISE_LAUNCH_CHECKLIST.md).
> Threat model: [`THREAT_MODEL.md`](./THREAT_MODEL.md).
> Incident runbook: [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md).

Enterprise-запуск больше не блокируется исходным P0-аудитом; актуальный статус readiness см. в чек-листе и live postdeploy/smoke проверках.

### P0 — Blockers (до первого платящего клиента)

- `done` **P0-01** · Telegram webhook fail-closed (commit `bd31cd3`): POST returns 503 in prod without secret, `isWebhookSecretValid` never returns true without configured secret, health check includes `TELEGRAM_WEBHOOK_SECRET`
- `done` **P0-02** · Error scrubbing in `/api/bot/route.ts` (commit `bd31cd3`): catch returns "Internal Server Error", no leak of err.message
- `done` **P0-03** · Row-Level Security policies on tenant-scoped tables + strict runtime enforcement; prod verify: 50 policies, no null-bypass
- `done` **P0-04** · Composite indexes on raw WB tables (commit `7e750e6`, migration `0029_left_maria_hill`, 6 indexes live on prod, verified via EXPLAIN ANALYZE)
- `done` **P0-05** · Postgres pool config (commit `847f5cc`): max=15, idle_timeout=20, max_lifetime=1800, connect_timeout=10 + ALTER SYSTEM statement_timeout=30s, idle_in_transaction_session_timeout=60s, pg_reload_conf() applied
- `done` **P0-06** · Production moved to `metric-pulse-app-01`; nginx/noVNC and internal-port firewall guardrails are documented in production ops docs
- `done` **P0-07** · GitHub Actions CI (commit `401ac40`): lint/test/build on push+PR. Branch protection remains plan-dependent; deploy stays manual by design.
- `in_progress` **P0-08** · Observability stack: pino + watchdog/stale-sync are live; Sentry/Prometheus remain follow-ups

### P1 — High (first 2 weeks of pilot)

- `in_progress` **P1-09** · `ENCRYPTION_KEY` hex-64 format + legacy fallback (commit `47ba6b1`); pending: rotate-script + AppError on decrypt failure + unit tests
- `done` **P1-10** · Inngest signing key enforced in prod; production unit uses signed self-hosted runtime, not `INNGEST_DEV`
- `todo` **P1-11** · Rate limiting (`@upstash/ratelimit`) on webhooks and mutation routes
- `todo` **P1-12** · Fix user enumeration on login + zod on FormData
- `todo` **P1-13** · Active tenant via signed cookie (drop `?tenantId=` from GETs)
- `todo` **P1-14** · `Idempotency-Key` header for mutation POST
- `done` **P1-15** · Atomic `INSERT ... WHERE NOT EXISTS` for sync_runs race (commit `01a3ba9`). Follow-up: add partial unique index as defence-in-depth.
- `todo` **P1-16** · Inngest concurrency limits per function
- `todo` **P1-17** · `onFailure` handlers + Telegram alerts on final retry exhaustion
- `todo` **P1-18** · Error response scrubbing across all `/api/views/**`
- `todo` **P1-19** · Encrypt RPA storage state, move to DB column with 7d TTL
- `todo` **P1-20** · Audit `lucide-react@1.7.0` (likely legacy) and migrate
- `todo` **P1-21** · Decide on `xlsx@0.18.5` supply-chain risk (migrate / pay / accept)
- `done` **P1-43** · Atomic `acceptInvitation` via `UPDATE ... WHERE status='pending' RETURNING *`
- `done` **P1-44** · Wrap stocks and products sync in `db.transaction` (commit `01a3ba9`)
- `done` **P1-45** · Propagate ads retry `step.run` errors; exponential backoff with 429 multiplier (commit `01a3ba9`)
- `done` **P1-45b** · Added proactive WB advertising API pacing and WB feedback answer pacing to reduce sustained 429s before retries are needed
- `done` **P1-46** · `roundFinancial` + `safeNumber` guards in analytics engine (commit `a32550d`)
- `done` **P1-47** · Remove `any` typing from `src/server/analytics/engine.ts` (commit `a32550d`)
- `done` **P1-48** · Sync progress summary persistence, abortable `stock_sizes` timeout (`WB_STOCK_SIZES_SOURCE_TIMEOUT_MS`), and `wb-sync-recovery` job for stale sync runs
- `done` **P1-49** · Settings minimal control plane, immediate WB API key apply + async preflight UI, password change, feature-level manager RBAC, and WB LK `active -> healthy` fix

### P2 — Medium

- `todo` **P2-22** · Migrate dashboard pages to Server Components
- `todo` **P2-23** · Table virtualization for heavy views
- `todo` **P2-24** · Expand vitest coverage to auth/tenant/encryption/autopilot
- `todo` **P2-25** · `error.tsx` + `global-error.tsx`
- `todo` **P2-26** · CSV/Excel export to object storage (S3/R2)
- `todo` **P2-27** · Split web and rpa-worker deployments; remove Playwright from web bundle
- `todo` **P2-28** · Audit FK `onDelete` policies for tenant cascade consistency
- `todo` **P2-29** · `DATABASE_URL` SSL requirement
- `todo` **P2-30** · Security headers in `next.config.ts`
- `todo` **P2-31** · Unified `parseRequestQuery` / `parseRequestBody` with zod everywhere
- `todo` **P2-32** · `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` in tsconfig
- `todo` **P2-33** · Fix `.env.production:25` quoting to allow bash `source`
- `done` **P2-51** · Load testing harness: `docs/LOAD_TESTING.md`, `npm run load:http`, `npm run load:browser`, `npm run load:watch`, reports in `output/load/*`

### P3 — Low / nice-to-have

- `todo` **P3-34** · Extended `/api/health` checks (Supabase, Inngest, disk)
- `in_progress` **P3-35** · `scripts/nightly-db-backup.mjs` + `npm run db:backup:nightly` ready (commit `aaa1a9f`); pending: wire up systemd timer on server
- `todo` **P2-48** · Next 16 standalone `client-reference-manifest` missing for `/overview`, `/login`, `/advertising`, `/explorer` (pre-existing, log noise, not a regression)
- `todo` **P2-49** · Rotate multiple `.env.production.bak-*` files on server into `/srv/backups/.../env/` with age/sops encryption
- `blocked` **P2-50** · `/srv` disk at 82% used — blocked on P0-06 infra decision
- `todo` **P3-36** · i18n framework readiness
- `todo` **P3-37** · A11y fixes (aria-labels, scope, focus trap)
- `todo` **P3-38** · Dependabot / Renovate config
- `todo` **P3-39** · Telegram `update_id` dedupe against replay
- `todo` **P3-40** · ESLint zero-warning baseline
- `todo` **P3-41** · Verify no `next-themes` hydration flash
- `todo` **P3-42** · Reconcile `render.yaml` / `Dockerfile` vs real bare-metal deploy

## P61. WB Snapshot Retention Fallback And Timeout Hardening

Priority: `P1`

Status: `done`

Goal:

- keep manual sync operational when WB temporarily fails on volatile contours (`paid_storage`, `ads`, `ad_clusters`) by retaining the previously synced snapshot for the selected date range;
- reduce avoidable advertising/payout transport failures through stricter timeout and batching defaults.

Primary files:

- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/app/(dashboard)/settings/SyncButton.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/SyncButton.tsx)

Expected output:

- recoverable WB/network failures for `paid_storage`, `ads`, and `ad_clusters` should degrade to `skipped` with retained snapshot metadata when data for the selected period already exists;
- the sync UI should distinguish retained-snapshot fallback from ordinary empty/no-report skips;
- advertising sync should reuse one campaign fetch across dependent sources and use tighter API timeouts/default chunking for unstable WB calls.

Result:

- `sync-wb` now classifies recoverable source failures (`timeout`, transient network errors, `408/425/429/5xx`) and, when prior rows exist for the active period, returns `skipped` with `reason: retained_previous_snapshot` instead of failing the whole source;
- snapshot retention fallback is wired for `paid_storage`, `ads`, and `ad_clusters`, including the case where all ad-cluster batches fail in one run;
- ad campaigns are now cached once per run and reused between `ads` and `ad_clusters`, and `wbApi.getAdSpend(...)` accepts preloaded campaign data to avoid duplicate campaign-detail calls;
- WB API hardening now includes `60s` ad API timeout, `120s` paid-storage download timeout, and a lower ad-campaign detail batch size (`20`) for more stable detail expansion;
- settings sync badges now show `Сохранён прошлый снимок` for retained-snapshot fallback cases.

Checks:

- `npx eslint src/lib/wb-api/index.ts src/inngest/sync-wb.ts src/app/\(dashboard\)/settings/SyncButton.tsx`
- `npm run test -- src/lib/wb-api/index.test.ts src/lib/wb-sync-utils.test.ts`

## P62. Advertising Self-learning Autopilot And Position-Economy Transparency

Priority: `P1`

Status: `done`

Goal:

- add a strategy mode that can keep a target position corridor while continuously searching for cheaper bid levels and learning which corridor is the most cost-effective;
- make auto-bid decisions and outcomes transparent in workspace UI (target position, observed position, savings, and retest lifecycle).

Primary files:

- [src/server/advertising/workspace.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/advertising/workspace.ts)
- [src/components/advertising/AdvertisingWorkspace.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/advertising/AdvertisingWorkspace.tsx)
- [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)

Expected output:

- autobid strategy should support `self_learning` mode with configurable position corridor, exploration rate, and retest policy for excluded clusters;
- strategy runner should persist learning state and run-level economics snapshots instead of acting as a blind bid mutator;
- advertising workspace should expose understandable run/change telemetry: what position was targeted, what was observed, and where estimated savings came from.

Result:

- `saveAdvertisingAutoBidStrategy(...)` now persists `autopilotConfig` in strategy summary and exposes self-learning controls in strategy records (`mode`, position corridor, exploration and retest settings);
- auto-run execution now supports position-aware bid decisions (`probe_down`, `raise_to_target`, ДРР/CPC guardrails), deterministic explore/exploit target selection across position arms, run reward computation, and learning-state accumulation;
- self-learning runs can re-include a portion of excluded clusters after cooldown (`auto_retest`) with action logging and error capture;
- run summary now stores mode, selected target corridor, observed average position, estimated savings, retest counters, and updated learning state;
- workspace strategy tab now includes self-learning controls and transparency UX:
  - strategy cards show mode/position/retest settings,
  - insight KPIs aggregate reward, in-target rate, observed position, and estimated savings,
  - auto-change journal and run history include position and savings columns.
- workspace context panel now also shows a selected SKU card with product preview (`photo_url`), brand/vendor code, nmId, cluster, and currently selected campaign id, so campaign edits are visually grounded.

Checks:

- `npx eslint src/server/advertising/workspace.ts src/components/advertising/AdvertisingWorkspace.tsx`
- `node scripts/release-baseline.mjs`

## P77. Advertising Operations Center And WB Action Verification

Priority: `P1`

Status: `done` — 2026-05-12

Goal:

- close the remaining safety gap in the advertising workspace: every WB mutation that changes campaign availability should be verifiable, and the operator should see one action center instead of hunting through separate tabs/logs;
- preserve the existing advertising architecture (`workspace.ts`, audit log, bid changes, cluster actions) without adding duplicate docs or parallel processes.

Research notes:

- WB promotion API docs: `GET /adv/v0/start` starts campaigns in statuses `4`/`11` and should result in active status `9`; `GET /adv/v0/pause` applies to active status `9` and should result in paused status `11`; `422` means the status was not changed.
- Current GitHub/open-source WB SDK examples still expose the same `adv/v0/start` and `adv/v0/pause` operations, but many examples are older and do not verify final campaign status. We treat those repos as endpoint confirmation only, not as runtime-quality practice.
- Community reports around WB advertising endpoints show successful HTTP responses can still require read-after-write verification, which matches the existing project approach for bids and minus phrases.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/server/jobs/advertising-dayparting-scheduler.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/advertising-dayparting-scheduler.ts)
- [src/server/advertising/workspace.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/advertising/workspace.ts)
- [src/app/api/views/advertising/workspace/operations/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/advertising/workspace/operations/route.ts)
- [src/components/advertising/workspace/tabs/OperationsTab.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/advertising/workspace/tabs/OperationsTab.tsx)

Result:

- `wbApi.pauseAdvert(...)` and `wbApi.resumeAdvert(...)` now perform read-after-write verification through campaign details unless `verify: false` is passed explicitly;
- `WbAdActionVerificationError` now carries expected/actual campaign status, so scheduler/audit/UI can distinguish transport errors from unconfirmed WB state;
- dayparting cron writes audit metadata for verified and failed pause/resume attempts;
- added `/api/views/advertising/workspace/operations`, aggregating alerts, bid-change failures, cluster-action failures, campaign status verification failures and strategy-run failures;
- `AdvertisingBidWorkspace` now shows a compact health strip and a new `Операции` sub-tab with incidents and a unified action queue.

Checks:

- `npm test -- src/lib/wb-api/index.test.ts` ✅
- `npx eslint src/lib/wb-api/index.ts src/lib/wb-api/index.test.ts src/server/jobs/advertising-dayparting-scheduler.ts src/server/advertising/workspace.ts src/app/api/views/advertising/workspace/operations/route.ts src/components/advertising/workspace/AdvertisingBidWorkspace.tsx src/components/advertising/workspace/tabs/OperationsTab.tsx` ✅
- `npm run typecheck` ✅
- `npm run build` ✅
- `git diff --check` ✅
- Browser smoke: `/advertising` returns `307 -> /login`; current local `/login` hangs before DOM load, so authenticated UI smoke is deferred until dev auth page is healthy.

## P54. WB Advertising API Reconciliation

Priority: `P1`

Status: `done`

Goal:

- align advertising preflight and ad-cluster sync with the current Wildberries promotion API instead of the obsolete media-count/search-stat path.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/lib/wb-api/index.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.test.ts)
- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [docs/PROJECT_GUIDE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PROJECT_GUIDE.md)

Expected output:

- advertising preflight should validate a real promotion endpoint instead of failing on the obsolete `/adv/v1/count` host/path combination;
- ad-cluster sync should resolve campaign details and real `nmId` bindings before loading normquery stats;
- the repo should have regression tests around the new advertising endpoint mapping.

Result:

- `wbApi.getAdCampaigns(...)` now reads campaign ids from `GET /adv/v1/promotion/count` and expands them through `GET /api/advert/v2/adverts`;
- advertising preflight in settings now passes against the current WB promotion contour when the token is valid, instead of hard-failing on the obsolete media-count endpoint;
- ad-cluster sync now requests `POST /adv/v1/normquery/stats` with concrete `advertId + nmId` pairs and writes cluster rows keyed by the real WB article instead of reusing `advertId` as a fake `nmId`;
- added `src/lib/wb-api/index.test.ts` covering campaign discovery and normquery response flattening.

Checks:

- `npm run lint`
- `npm run test`
- `npm run build`
- `SMOKE_EXPECT_INNGEST_RUNTIME=1 npm run smoke:operator`

## P59. March Bundle Reconciliation And Stock Source Repair

Priority: `P1`

Status: `done`

Goal:

- reconcile the March WB export bundle against the local app facts and remove the remaining stock-contour mismatch caused by the wrong WB stock fallback path.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/lib/wb-api/index.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.test.ts)
- [scripts/reconcile_wb_bundle.py](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/reconcile_wb_bundle.py)
- [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)

Expected output:

- the repo should be able to compare March WB exports against app facts through one committed script instead of manual spreadsheet checking;
- `raw_api_stocks` should stop depending on the broken legacy stock fallback when the tenant uses a base WB token;
- current stock, in-way-to-client, and in-way-from-client totals should match the downloaded WB stock report materially better after a fresh local refresh.

Result:

- added `scripts/reconcile_wb_bundle.py`, which produces a Markdown summary for the March bundle and highlights remaining fact mismatches by source;
- confirmed from the bundle that the main live mismatch was the stock contour, not the period funnel aggregates;
- `wbApi.getStocks(...)` now falls back to `api/v2/stocks-report/products/products` when `stocks-report/wb-warehouses` is forbidden for a base token, and only then falls back to the old supplier path;
- `sync-wb` now clears the tenant stock snapshot before inserting the current stock result, so stale warehouse rows no longer survive between syncs;
- direct live verification against the stored tenant token now writes a `7045 / 60 / 51` stock contour into `raw_api_stocks`, which aligns with the downloaded WB stock workbook.

Checks:

- `npx vitest run src/lib/wb-api/index.test.ts`
- `npx eslint src/lib/wb-api/index.ts src/lib/wb-api/index.test.ts src/inngest/sync-wb.ts`

## P57. WB Sync Runtime Stabilization And Progress UX

Priority: `P1`

Status: `done`

Goal:

- remove the last live-sync failures caused by WB `null` ad-stat payloads, paid-storage rate limiting, and duplicate ad-cluster rows while surfacing real progress during long manual sync runs.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/server/jobs/sync-runtime.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/sync-runtime.ts)
- [src/app/(dashboard)/settings/SyncButton.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/SyncButton.tsx)
- [src/lib/wb-api/index.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.test.ts)

Expected output:

- `Ads` should stop failing when WB returns `200 null` from `adv/v3/fullstats`;
- long paid-storage syncs should stop tripping over back-to-back report downloads on long manual ranges;
- ad-cluster sync should stop hitting duplicate-row upsert failures inside one chunk;
- the settings sync card should show real source-level progress instead of a static `Выполняется`.

Result:

- `wbApi.getAdSpend(...)` now treats `null` fullstats payloads as empty ad spend instead of throwing `response is not iterable`;
- `wbApi.getPaidStorage(...)` now spaces report downloads and retries `429` download responses explicitly, matching the long-window task flow better;
- `sync-wb` now deduplicates ad-cluster rows inside a single insert batch before `onConflictDoUpdate`;
- `sync_runs.summary` now persists progress metadata (`completed / total / running source`), and `settings` renders a live percentage bar plus current source label during manual sync;
- regression coverage now includes the live `fullstats -> null` case.

Checks:

- `npm run lint`
- `npm run test -- src/lib/wb-api/index.test.ts`
- `npm run build`
- `SMOKE_EXPECT_INNGEST_RUNTIME=1 npm run smoke:operator`

## P58. WB Advertising Window-Limit Compliance

Priority: `P1`

Status: `done`

Goal:

- bring the advertising sync path into line with the current WB promotion limits, so long manual ranges stop failing with `WB API 400` on `fullstats` and `normquery`.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/lib/wb-api/index.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.test.ts)
- [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)
- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)

Expected output:

- `Ads` should stop failing on long manual ranges where `GET /adv/v3/fullstats` rejects intervals longer than `31` days;
- `ad_clusters` should stop failing on long manual ranges where `POST /adv/v1/normquery/stats` rejects the current whole-range payload;
- the repo should have regression tests that lock these advertising window limits into code.

Result:

- `wbApi.getAdSpend(...)` now splits long date ranges into documented `31`-day windows before calling `GET /adv/v3/fullstats`;
- `wbApi.getSearchClusterStats(...)` now splits long date ranges into `30`-day windows before calling `POST /adv/v1/normquery/stats`, matching the actual WB runtime behavior seen in live sync errors;
- unit coverage now includes both long-range split scenarios so future advertising refactors do not reintroduce the same `400` failures.

Checks:

- `npm run test -- src/lib/wb-api/index.test.ts`
- `npm run build`

## P59. WB Advertising Rate-Limit Hardening And Paid-Storage Dedupe

Priority: `P1`

Status: `done`

Goal:

- remove the remaining live-sync failures where `ads` still exhausts retries against WB `429` limits and `paid_storage` still dies on duplicate rows inside one insert batch.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/lib/wb-sync-utils.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-sync-utils.ts)
- [src/lib/wb-api/index.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.test.ts)
- [src/lib/wb-sync-utils.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-sync-utils.test.ts)

Expected output:

- `Ads` should stop burning its retry budget on sequential `adv/v3/fullstats` calls that violate the WB `1 request / 20 seconds` limit;
- `paid_storage` should stop failing locally when one WB report contains duplicate `(nmId, warehouse, date)` rows;
- the repo should have regression tests for both the new pacing rule and the paid-storage dedupe logic.

Result:

- `wbApi.getAdSpend(...)` now paces sequential `adv/v3/fullstats` calls to the documented `20`-second interval before each request instead of waiting for `429` and exponential backoff to do damage control;
- `sync-wb` now deduplicates paid-storage rows before `raw_api_paid_storage` upsert, normalizing warehouse names and day keys so one noisy report does not blow up the whole manual sync run;
- added `src/lib/wb-sync-utils.ts` plus focused regression tests for both `fullstats` pacing and paid-storage dedupe.

Checks:

- `npm run test -- src/lib/wb-api/index.test.ts src/lib/wb-sync-utils.test.ts`

## P60. Dashboard Freshness And Dynamics Group-Builder Repair

Priority: `P1`

Status: `done`

Goal:

- remove the false stale-data warning on covered days, unblock product-group assembly for empty groups, and stop showing fake conversion values when there is no funnel coverage for the selected range.

Primary files:

- [src/components/dashboard/DataFreshnessBanner.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/DataFreshnessBanner.tsx)
- [src/components/dashboard/DynamicsTable.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/DynamicsTable.tsx)
- [src/app/(dashboard)/dynamics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/dynamics/page.tsx)
- [src/app/api/views/products/options/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/products/options/route.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/components/dashboard/KPICards.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/KPICards.tsx)

Expected output:

- the freshness banner should stop warning when sync and selected range cover the same calendar day but different timestamps;
- operators should be able to add SKU to an empty group without first manufacturing fake dynamics rows;
- the group-builder modal should use the synced catalog, not a period-bound economics response;
- overview should stop rendering `0.0%` conversion when the period has no funnel rows at all.

Result:

- `DataFreshnessBanner` now compares sync coverage and active period on local calendar-day keys, removing the false partial-coverage state for fully covered days;
- `DynamicsTable` now opens the add-products flow even for empty groups and loads candidates from a dedicated `/api/views/products/options` catalog endpoint;
- the group-builder excludes already added SKU, supports title search, and renders a meaningful empty state when no candidates remain;
- overview now marks conversion as unavailable (`н/д`) when the selected period has no funnel coverage rows.

Checks:

- `npm run test -- src/lib/wb-api/index.test.ts src/lib/wb-sync-utils.test.ts`
- `npm run build`

## P56. WB Sync Runtime Reconciliation

Priority: `P1`

Status: `done`

Goal:

- remove the remaining stale WB endpoints and runtime-side data-shape issues that still left manual sync in `completed_with_errors` even after the advertising contour was corrected.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/types/wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/types/wb.ts)
- [src/lib/wb-api/index.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.test.ts)
- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [docs/PROJECT_GUIDE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PROJECT_GUIDE.md)

Expected output:

- funnel sync should stop calling the obsolete `nm-reports/v1/nm-report/detail` endpoint and use the current Analytics v3 sales-funnel API;
- paid-storage sync should stop calling the removed `api/v1/analytics/paid-storage` endpoint and use the documented task-based report flow;
- stock sync should stop failing on duplicate `(tenant, nmId, warehouse)` rows within one upsert batch;
- the corrected runtime path should be covered by regression tests and a fresh local `dev:runtime` restart.

Result:

- `wbApi.getNomenclatureReport(...)` now reads `POST /api/analytics/v3/sales-funnel/products`, paginates with `limit/offset`, and maps selected-period metrics into the existing funnel model;
- funnel sync now writes real `orderCount` instead of incorrectly reusing `buyoutsCount`;
- `wbApi.getPaidStorage(...)` now creates report tasks through `GET /api/v1/paid_storage`, polls task status, downloads the report, and chunks longer date ranges into compliant windows;
- stock sync now deduplicates WB snapshot rows by `(nmId, warehouseName)` before `onConflictDoUpdate`, removing the duplicate-row runtime failure;
- unit coverage now includes funnel v3 mapping and paid-storage task flow, and the local `dev:runtime` was restarted so Inngest no longer serves the stale worker code.

Checks:

- `npm run test -- src/lib/wb-api/index.test.ts`
- `npm run test`
- `npm run build`
- `SMOKE_EXPECT_INNGEST_RUNTIME=1 npm run smoke:operator`

## P55. WB Advertising Spend Sync Reconciliation

Priority: `P1`

Status: `done`

Goal:

- move the ad-spend sync path off the obsolete `GET /adv/v2/full/stat` endpoint and onto the current WB campaign statistics contour.

Primary files:

- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/lib/wb-api/index.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.test.ts)
- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [docs/PROJECT_GUIDE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PROJECT_GUIDE.md)

Expected output:

- the `Ads` source should no longer fail with `WB API 404` just because sync still uses an obsolete ad-statistics endpoint;
- ad spend should be flattened from current campaign `fullstats` into `nmId + date` rows that fit the existing analytics model;
- the new mapping should be protected by regression tests.

Result:

- `wbApi.getAdSpend(...)` now resolves eligible campaign ids and reads stats through `GET /adv/v3/fullstats`;
- the `fullstats` response is flattened and aggregated by `nmId + date`, preserving the existing `raw_api_ad_costs` storage model instead of requiring a schema rewrite;
- added a unit test that covers campaign discovery plus `fullstats` aggregation into ad-spend rows.

Checks:

- `npm run test`
- `npm run build`
- `SMOKE_EXPECT_INNGEST_RUNTIME=1 npm run smoke:operator`

## B0. Project Operations Foundation

Status: `done`

Goal:

- establish the repo-level operating system for future implementation.

Files:

- [AGENTS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/AGENTS.md)
- [docs/IMPLEMENTATION_BACKLOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/IMPLEMENTATION_BACKLOG.md)
- [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)

Checks:

- `git diff --check`

Notes:

- GitHub authentication exists via `gh`, private remote `origin` is configured, and the working branch is handled through draft PR flow.

## P0. Tenant Isolation And Security Baseline

Priority: `P0`

Status: `done`

Goal:

- make auth and tenant access rules consistent across routes and server actions.

Primary files:

- [src/proxy.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/proxy.ts)
- [src/lib/supabase/middleware.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/supabase/middleware.ts)
- [src/app/api/views/dashboard/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/route.ts)
- [src/app/api/views/economics/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/economics/route.ts)
- [src/app/api/views/dynamics/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dynamics/route.ts)
- [src/app/api/views/explorer/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/explorer/route.ts)
- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/app/(dashboard)/cabinets/user-actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/cabinets/user-actions.ts)

Expected output:

- one shared access helper;
- no route trusts client `tenantId` without membership validation;
- invitation acceptance verifies identity properly;
- read actions do not bypass tenant checks.

Result:

- shared tenant access helper added in `src/lib/auth/tenant-access.ts`
- dashboard, economics, dynamics, explorer, and signals routes now validate tenant access through one path
- server actions for settings, overview signals, economics, dynamics, team, bulk cost upload, and sync trigger now enforce auth/tenant membership
- invitation acceptance now validates the current authenticated email against the invited email
- `proxy` now documents why API is intentionally protected per-endpoint instead of through global middleware

Checks:

- `npm run build`
- `npm run lint`

## P1. User Bootstrap And Session Integrity

Priority: `P0`

Status: `done`

Goal:

- guarantee that every authenticated user has a valid local profile and active tenant state.

Primary files:

- [src/app/(auth)/login/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(auth)/login/actions.ts)
- [src/app/actions/session.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/actions/session.ts)
- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)

Expected output:

- signup/login flow cannot leave the app in a half-initialized state;
- first tenant creation and active tenant selection are deterministic;
- session bootstrap recovers safely when tenant or membership is missing.

Result:

- added user bootstrap helper in `src/lib/auth/user-bootstrap.ts`
- login now restores or initializes the local `users` profile and redirects users without a cabinet to `/settings`
- signup now initializes the local profile and routes fresh accounts into onboarding instead of an empty dashboard
- session hydration now reconciles local `users` state with `user_tenants`
- store state now tracks `needsTenantSetup`
- dashboard bootstrap redirects authenticated users without any cabinet to `/settings`
- settings/onboarding UI now opens on the cabinet management tab and shows a first-cabinet setup hint
- active tenant switching and cabinet creation now synchronize the denormalized `users.role` and local client store state

Checks:

- `npm run build`
- `npm run lint`

## P2. Schema And Migration Reconciliation

Priority: `P0`

Status: `done`

Goal:

- eliminate drift between Drizzle schema and migrations.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0000_hard_snowbird.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0000_hard_snowbird.sql)
- [drizzle/meta/0000_snapshot.json](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/meta/0000_snapshot.json)
- [drizzle.config.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle.config.ts)
- [seed-mock-data.js](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/seed-mock-data.js)

Expected output:

- schema and migration history describe the same database;
- seed path is aligned with the actual schema;
- future DB work has a stable base.

Result:

- generated reconcile migration `drizzle/0001_swift_the_stranger.sql` and snapshot `drizzle/meta/0001_snapshot.json` to close the gap between the original minimal baseline and the actual 19-table schema
- migration history now records the `users.tenant_id` nullable change, tenant metadata fields, product visibility flag, finance columns, invitation and user-tenant tables, analytics raw tables, and product grouping tables
- `drizzle.config.ts` now pins the migration output directory explicitly to `./drizzle`
- `seed-mock-data.js` now creates or refreshes a demo tenant before inserting child rows, so the seed path matches current foreign keys instead of assuming pre-existing tenant data

Checks:

- schema review against migrations;
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run build`

## P3. WB Ingestion Reliability

Priority: `P1`

Status: `done`

Goal:

- make data synchronization resilient, version-aware, and observable.

Primary files:

- [src/lib/wb-api/client.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/client.ts)
- [src/lib/wb-api/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-api/index.ts)
- [src/server/jobs/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/index.ts)
- [src/server/jobs/sync-orders.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/sync-orders.ts)
- [src/server/jobs/sync-finances.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/sync-finances.ts)
- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/app/(dashboard)/settings/sync-action.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/sync-action.ts)

Expected output:

- retry/backoff and batching rules are explicit;
- source freshness is visible;
- partial failures are diagnosable;
- WB API caveats are documented close to the code or in docs.

Result:

- `src/lib/wb-api/client.ts` now enforces timeout-aware retry logic with retryable status handling for `408/425/429/5xx`, richer WB API errors, and response payload excerpts for diagnostics
- `src/lib/wb-api/index.ts` now centralizes JSON request handling and adds `getAllRealizationReports()` so finance sync no longer duplicates pagination logic
- manual sync now creates `sync_runs` records and writes per-source status, counts, and error summaries into the DB via new migration `drizzle/0002_simple_lightspeed.sql`
- `src/inngest/sync-wb.ts` now isolates failures per source instead of aborting the whole run on the first failing API, while still marking the final run as `completed`, `completed_with_errors`, or `failed`
- cron finance and order jobs now decrypt stored WB tokens correctly and continue safely on tenant-specific errors instead of risking a full job abort
- funnel and ad-cluster daily snapshots now use stable day buckets, reducing duplicate rows caused by unique indexes on timestamp fields

Checks:

- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run build`
- targeted runtime review of sync paths
- targeted `npx eslint ...` on `P3` files

## P4. Product Finish For Current Screens

Priority: `P1`

Status: `done`

Goal:

- make the existing screens trustworthy and operator-friendly.

Primary files:

- [src/app/(dashboard)/overview/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/page.tsx)
- [src/app/(dashboard)/economics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/economics/page.tsx)
- [src/app/(dashboard)/dynamics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/dynamics/page.tsx)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)
- [src/app/(dashboard)/explorer/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/explorer/page.tsx)
- [src/components/dashboard](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard)

Expected output:

- empty states, errors, loading, and refresh behavior are coherent;
- views match actual server capabilities;
- operator actions are understandable.

Result:

- added reusable operator-state surface in `src/components/dashboard/OperatorState.tsx` and moved dashboard screens away from silent `null` returns
- `overview`, `economics`, `dynamics`, and `explorer` now show explicit no-tenant, no-data, and retryable error states instead of appearing broken or blank
- `SignalsFeed` now surfaces load failures, shows a healthy empty-state when there are no active alerts, and disables management actions for viewers
- `SyncButton` now uses real `sync_runs` history instead of fake local progress, including latest status, date range, source counts, and error summary
- browser verification confirmed the new operator states render correctly for an authenticated account without an active cabinet

Checks:

- `npm run build`
- browser verification
- targeted `npx eslint ...` on `P4` files

## P12. Local Inngest Runtime Baseline

Priority: `P1`

Status: `done`

Goal:

- make local manual sync use a real Inngest runtime path instead of failing on missing dev infrastructure.

Primary files:

- [src/inngest/client.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/client.ts)
- [src/app/api/inngest/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/inngest/route.ts)
- [src/app/(dashboard)/settings/sync-action.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/sync-action.ts)
- [scripts/dev-runtime.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/dev-runtime.mjs)
- [scripts/smoke-operator-runtime.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-runtime.mjs)
- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)

Expected output:

- one documented local command starts `Next + Inngest Dev Server`;
- manual sync produces a helpful operator error if the dev server is missing;
- runtime smoke proves event pickup instead of only UI enqueue.

Result:

- `src/inngest/client.ts` now configures a dummy local event key in dev mode and respects `INNGEST_BASE_URL` when explicitly provided
- `/api/inngest` now registers both the manual sync function and the scheduled job functions from `src/server/jobs`
- `triggerWbSync()` now converts local `ECONNREFUSED/fetch failed` delivery errors into a concrete operator instruction about starting the Inngest dev runtime
- added `npm run dev:runtime`, `npm run inngest:dev`, and `npm run smoke:operator:runtime`
- added runtime orchestration scripts so local verification no longer depends on manually juggling two terminals
- runtime smoke now fails if manual sync never leaves the enqueue/error stage and is not picked up by the worker path

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P32. Saved Signal Views And SLA Aging

Priority: `P2`

Status: `done`

Goal:

- persist operator queue presets between sessions and surface signal aging directly in the working feed so overdue handoff/blocked items are visible without opening each card.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0008_mysterious_marrow.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0008_mysterious_marrow.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/api/views/dashboard/signals/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signals/route.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- operators can save and restore queue presets built from `queue view + assignee + workflow` filters;
- the signal feed shows `time in queue` and SLA escalation, with overdue handling especially visible for `handoff` and `blocked`;
- these two features are server-backed and survive reloads, not only local client state.

Result:

- added `signal_saved_views` plus migration `0008_mysterious_marrow.sql` for per-user/per-tenant saved queue presets
- `AnalyticsEngine.getSignalsFeed(...)` now returns saved views and a server-derived aging summary per signal based on `workflow_updated_at` or initial signal creation time
- the feed now lets operators save the current queue preset, reapply it later, and delete obsolete presets directly from `overview`
- signal cards now show queue age plus SLA chips, and same-severity signals are sorted by SLA pressure and aging rather than only by creation time
- `db:repair-local` now repairs and records migration `0008` for existing local workspaces

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

## P33. Saved View Defaults And Overview SLA Summary

Priority: `P2`

Status: `done`

Goal:

- make saved signal views editable/defaultable per operator and surface queue-SLA pressure at the overview-summary level, not only inside individual cards.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0009_daffy_peter_parker.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0009_daffy_peter_parker.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/lib/signal-queue-utils.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-queue-utils.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/dashboard/SignalSlaSummaryStrip.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalSlaSummaryStrip.tsx)
- [src/app/(dashboard)/overview/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/page.tsx)

Expected output:

- operators can edit/rename an existing saved view instead of only recreating it;
- one saved view can be marked as the default working preset per user and auto-applies on overview load;
- the overview screen surfaces queue-SLA pressure as summary counts for overdue blocked, overdue handoff, and aging needs-action work.

Result:

- extended `signal_saved_views` with `is_default` through migration `0009_daffy_peter_parker.sql`
- added engine/server-action support for updating an existing saved view and toggling default state per user
- `SignalsFeed` now lets operators rename a selected saved view, mark any saved view as default, and reopens overview with the default preset already applied
- extracted shared queue helpers into `src/lib/signal-queue-utils.ts` so feed filtering and overview SLA summary use the same logic
- added `SignalSlaSummaryStrip` to `overview`, showing counts for overdue `blocked`, overdue `handoff`, and aging `needs action`
- `db:repair-local` now repairs and records migration `0009` for existing local workspaces

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

## P34. Shared Saved Views, Pinning, And Ordering

Priority: `P2`

Status: `done`

Goal:

- extend saved signal views from private presets into reusable team queues with deterministic ordering and clear ownership rules.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0010_silly_vance_astro.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0010_silly_vance_astro.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/api/views/dashboard/signals/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signals/route.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- operators can create private or team-scoped saved views with role-aware edit rules;
- saved views can be pinned and reordered so important queues stay on top;
- saved views persist their sort preset together with filters so reopened queues keep the intended order.

Result:

- extended `signal_saved_views` with `scope`, `sort_preset`, `is_pinned`, and `position` via `0010_silly_vance_astro.sql`
- `AnalyticsEngine` now returns both personal and team views with owner identity plus capability flags, and only the owner or a tenant manager can edit shared presets
- `SignalsFeed` now separates `My views` and `Team views`, supports pin/unpin and move up/down, and falls back to `save as new view` when the active team preset is read-only
- `db:repair-local` now repairs and records migration `0010` for existing local workspaces

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

## P35. SLA Queue Presets And Escalation Actions

Priority: `P2`

Status: `done`

Goal:

- turn SLA state from passive chips into an actionable operator workflow.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/lib/signal-workflow-config.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-workflow-config.ts)
- [src/lib/signal-queue-utils.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-queue-utils.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/dashboard/SignalDetailsPanel.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalDetailsPanel.tsx)

Expected output:

- operators can open an overdue-only queue and switch between urgency-oriented sort presets;
- signal cards and the signal drawer expose one-click escalation actions using shared workflow presets;
- escalation and sorting logic stays shared so list and detail workflows do not drift.

Result:

- added `overdue_only` queue filtering together with `severity`, `sla_pressure`, and `newest` sort presets through shared helpers in `src/lib/signal-queue-utils.ts`
- extracted `SIGNAL_ESCALATION_PRESETS` into `src/lib/signal-workflow-config.ts`, so SLA escalation copy and target workflow bundles come from one place
- `SignalsFeed` now exposes overdue-only queue selection, sort selection, and one-click escalation actions directly from the list
- `SignalDetailsPanel` now surfaces the same escalation action next to queue age and SLA state, using per-signal aging returned by `AnalyticsEngine.getSignalDetails(...)`

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

## P36. Team Default Fallback And Pin-First Saved Views

Priority: `P2`

Status: `done`

Goal:

- turn shared saved views into a real team queue entry point instead of a secondary list that still depends on each operator creating a personal default.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- team views can provide a tenant-wide default fallback for operators without a personal default;
- shared preset names stop colliding with private presets just because the creator reused the same label;
- pinned views become a first-class quick-access surface, not just a small badge inside the saved-view lists.

Result:

- `SignalSavedView` now distinguishes `My default` from `Team default`, and `AnalyticsEngine` applies team-scoped defaults as a fallback only when the operator has no private default
- save/update logic now validates duplicates by scope, so team presets are unique in the shared namespace while private presets remain user-scoped
- `SignalsFeed` now exposes pinned saved views as a dedicated shortcut strip and separates personal default controls from team-default controls to keep ownership semantics clear

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P37. SLA Queue Presets, Automation, And Notifications

Priority: `P2`

Status: `done`

Goal:

- turn SLA pressure into an operator control loop with preset queues, one-click bulk automation, and explicit notification surfacing.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/lib/signal-workflow-config.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-workflow-config.ts)
- [src/lib/signal-queue-utils.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-queue-utils.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/layout/SignalNotificationsMenu.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/layout/SignalNotificationsMenu.tsx)

Expected output:

- overdue queues become reusable operational presets instead of ad hoc filter combinations;
- operators can trigger SLA escalation in bulk from the server side, not only card-by-card from the feed;
- the notification center distinguishes SLA escalation traffic from ordinary collaboration comments.

Result:

- added SLA queue presets for `all overdue`, `blocked overdue`, and `handoff overdue`, with one-click apply and one-click save to `signal_saved_views`
- `AnalyticsEngine.runSignalSlaAutomation(...)` now groups eligible overdue signals by escalation preset and writes SLA-marked note events through the existing collaboration timeline
- notification payloads now mark SLA automation explicitly, and the header notification center shows those events with a dedicated SLA visual treatment

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P38. Scheduled SLA Sweep Through Inngest

Priority: `P2`

Status: `done`

Goal:

- make SLA automation run on a real schedule through Inngest/cron, not only when an operator explicitly clicks from `overview`.

Primary files:

- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/server/jobs/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/index.ts)
- [src/server/jobs/signal-sla-sweep.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/signal-sla-sweep.ts)

Expected output:

- scheduled SLA automation scans tenants without requiring an open dashboard session;
- only overdue signals are eligible for scheduled escalation;
- repeated scheduled sweeps do not spam the shared timeline with duplicate escalation notes.

Result:

- added `signalSlaSweepJob` and registered it in `src/server/jobs/index.ts`, so `/api/inngest` now exposes a real scheduled SLA sweep with default cron `15 * * * *` and optional `SIGNAL_SLA_SWEEP_CRON` override
- `AnalyticsEngine.runSignalSlaAutomation(...)` now supports `automationSource`, `dryRun`, and dedupe-window control, and reports `eligible` plus `skippedAlreadyEscalated` counts in addition to applied presets
- scheduled SLA notes now persist `automationSource: "scheduled"` and `presetId` in timeline payloads, while the sweep suppresses recently repeated scheduled escalations inside the dedupe window

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`
- `npx tsx --require dotenv/config --eval "(async () => { const imported = await import('./src/server/jobs/signal-sla-sweep.ts'); const mod = typeof imported.runScheduledSignalSlaSweep === 'function' ? imported : imported.default; const result = await mod.runScheduledSignalSlaSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"`

## P39. Shared Queue Ownership And SLA Run Audit

Priority: `P2`

Status: `done`

Goal:

- move saved-view/SLA operations from creator-centric presets to a team-operable workload layer with explicit queue owner, server-side automation audit, and visible escalation outcomes.

Primary files:

- [drizzle/0011_hesitant_rictor.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0011_hesitant_rictor.sql)
- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- shared saved views can declare who actually owns the team queue, not only who created the preset;
- every SLA automation run is persisted as a server-side audit record with source and queue context;
- operators can see whether the last escalation is still pending or already moved/resolved.

Result:

- added `drizzle/0011_hesitant_rictor.sql`, extending `signal_saved_views` with shared queue owner fields and introducing `signal_automation_runs` for audit-grade SLA automation history
- `AnalyticsEngine.runSignalSlaAutomation(...)` now writes audit runs with trigger/source/view context, attaches `automationRunId` to timeline note payloads, and updates each run with applied/skipped counts plus failure status when needed
- `SignalsFeed` now lets managers assign a `queue owner` to team saved views, shows that owner on shared/pinned presets, renders the latest SLA automation runs in `overview`, and surfaces the latest escalation outcome directly on active signal cards
- `db:repair-local` now repairs and records migration `0011`, bringing the local baseline to 24 public tables / 12 recorded migrations

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

## P40. Automation Run Drill-Down

Priority: `P2`

Status: `done`

Goal:

- turn the automation run log from a summary strip into an actionable investigation surface where the operator can inspect the concrete affected signals for any run.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/api/views/dashboard/signals/automation-runs/[runId]/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signals/automation-runs/[runId]/route.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- each automation run can be opened to inspect the exact signals attached to that run;
- the operator can see per-signal preset/note/outcome state without reverse-engineering timeline rows manually;
- run detail offers a direct jump back into the signal drawer for follow-up.

Result:

- added `SignalAutomationRunDetail` types plus `AnalyticsEngine.getSignalAutomationRunDetails(...)`, which resolves automation-run-linked note events into current signal state, preset id, SLA aging, and escalation outcome
- added `GET /api/views/dashboard/signals/automation-runs/[runId]`, so run drill-down uses the same tenant-guarded server path as the rest of the dashboard
- `SignalsFeed` now lets the operator expand any automation run, inspect the touched signals inline, and jump directly into the signal drawer from the run log

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P41. Queue Owner Workflow Layer

Priority: `P2`

Status: `done`

Goal:

- turn queue ownership from a passive saved-view attribute into a real operator workflow layer with owner filtering, workload visibility, and owner-specific queue presets.

Primary files:

- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)

Expected output:

- `overview` can filter shared queue context by queue owner, not only by raw signal assignee/workflow;
- owner workload is visible as a compact summary before the operator dives into individual saved views or automation runs;
- team saved views are grouped and created in an owner-aware way instead of living in one undifferentiated shared list.

Result:

- added an explicit queue-owner filter over team saved views and automation runs, including `unassigned` owner queues;
- `SignalsFeed` now shows owner workload summary cards with team-view count, recent runs, pending escalations, assigned signals, overdue pressure, and team-default context;
- team views are now grouped by queue owner, and managers can seed a new owner-specific team view directly from the owner group instead of rebuilding owner context manually;
- team view save/edit flow now reuses the active owner context, so owner-specific presets do not drift from the currently inspected queue.

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P42. SLA Pending Follow-Up Automation

Priority: `P2`

Status: `done`

Goal:

- close the loop after SLA escalation by surfacing pending outcomes, enabling reminder actions from the run log, and scheduling server-side follow-up sweeps.

Primary files:

- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/server/jobs/signal-sla-follow-up.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/signal-sla-follow-up.ts)
- [src/server/jobs/index.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/index.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)

Expected output:

- pending escalation outcomes are visible directly in the automation run log with reminder history;
- an operator can trigger follow-up on the pending subset of a run without reopening each signal manually;
- a scheduled server-side sweep can remind stale pending runs even if nobody opens `overview`.

Result:

- added `runSignalSlaPendingFollowUp(...)` and `runSignalSlaPendingFollowUpSweep(...)`, both built on top of timeline note payloads instead of a second reminder table;
- automation runs now expose `followUpCount` and `lastFollowUpAt`, and run drill-down shows per-signal follow-up history alongside current pending/resolved/progressed state;
- `overview` now supports one-click `Напомнить pending` from the run log, wired through a tenant-guarded server action;
- added `signalSlaFollowUpJob`, a scheduled Inngest cron sweep with dry-run-friendly aggregation for tenant-level pending follow-up coverage;
- SLA reminder notes are now classified separately from the original escalation in summaries/notifications, while still remaining inside the shared collaboration timeline.

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/tsx -e "import { runScheduledSignalSlaFollowUpSweep } from './src/server/jobs/signal-sla-follow-up.ts'; (async () => { const result = await runScheduledSignalSlaFollowUpSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"`

## P43. Follow-Up Wave Outcome Tracking

Priority: `P2`

Status: `done`

Goal:

- make SLA follow-up reminders inspectable as waves, so the operator can see the result of each reminder batch instead of only total reminder counts.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- every follow-up action is grouped into a reminder wave with its own outcome counts;
- automation run cards expose the latest wave result, not only `last reminder` metadata;
- drill-down shows a wave history the operator can compare against current per-signal outcome.

Result:

- follow-up reminders now persist a shared `followUpBatchId`, so one reminder action becomes a server-derived wave instead of disconnected note rows;
- automation run summaries now expose `followUpWaveCount` and `latestFollowUpWave`, with current outcome counts for the latest reminder wave;
- run drill-down now renders a follow-up wave history section above the touched-signal list, including batch size, actor, source, and current outcome mix per wave.

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P44. Overview Owner Summary Strip

Priority: `P2`

Status: `done`

Goal:

- lift owner-level queue pressure out of the feed and into the overview summary area so shared workload is visible before the operator scrolls into the queue list.

Primary files:

- [src/lib/signal-queue-utils.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-queue-utils.ts)
- [src/components/dashboard/SignalQueueOwnerSummaryStrip.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalQueueOwnerSummaryStrip.tsx)
- [src/app/(dashboard)/overview/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/page.tsx)

Expected output:

- `overview` header area shows owner queue pressure alongside the existing SLA summary strip;
- the owner summary is derived from the same shared saved views / automation runs / assigned signals model as the feed;
- team workload becomes visible from the first screen, not only after opening `SignalsFeed`.

Result:

- extracted a shared owner-summary builder into `signal-queue-utils`, so both top-level overview and feed-level workflow can reason over the same owner workload model;
- added `SignalQueueOwnerSummaryStrip`, which highlights pending follow-ups, overdue assigned signals, shared-view count, recent runs, and team-default context for the busiest owner queues;
- `overview/page.tsx` now renders that owner strip above the SLA strip, effectively turning shared/team workload into a first-class dashboard KPI layer.

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P45. Follow-Up Resolution Capture

Priority: `P2`

Status: `done`

Goal:

- add explicit operator outcomes on top of reminder waves, so a follow-up can be marked as acknowledged, action taken, or no action without waiting for derived workflow/status changes alone.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- follow-up waves carry explicit operator outcomes in addition to derived `pending / progressed / resolved / ignored`;
- run drill-down lets the operator record that explicit outcome directly from the affected signal row;
- the latest explicit outcome is visible both per wave and per signal, so reminder waves become auditable team workflow rather than passive notes.

Result:

- added `sla_follow_up_resolution` timeline notes with explicit `acknowledged / action_taken / no_action` payloads tied to `sourceAutomationRunId` and `followUpBatchId`;
- automation runs and follow-up waves now aggregate explicit resolution counts and `latestFollowUpResolutionAt` alongside the existing derived escalation outcome counts;
- expanded run drill-down now shows one-click explicit outcome actions on each reminded signal and surfaces the latest captured resolution in the row itself.

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P46. Automation Control Plane

Priority: `P2`

Status: `done`

Goal:

- give operators a real automation control plane in `overview`, including dry-run preview, recent automation health, and suppression controls per saved view or queue owner.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0012_public_brood.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0012_public_brood.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/server/jobs/signal-sla-follow-up.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/signal-sla-follow-up.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- `overview` can preview a manual SLA automation run without writing a real automation-run record;
- operators can see recent automation health from the same control plane where they launch or inspect runs;
- team workflow owners and saved views can be suppressed or unsuppressed without editing code or turning off the whole automation path.

Result:

- added `signal_automation_suppressions` plus migration `0012_public_brood.sql`, and `db:repair-local` now repairs and records that baseline for existing local databases;
- `overview` now exposes a dry-run preview panel and recent automation-health summary directly inside the SLA automation block;
- saved views and queue-owner cards now support one-click suppress/unsuppress controls, and scheduled follow-up sweep skips suppressed owner/view contexts instead of reminding them blindly.

Checks:

- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/tsx -e "import { runScheduledSignalSlaFollowUpSweep } from './src/server/jobs/signal-sla-follow-up.ts'; (async () => { const result = await runScheduledSignalSlaFollowUpSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"`

## P13. Sync Result UX And Token Diagnostics

Priority: `P1`

Status: `done`

Goal:

- turn noisy sync failure output into operator-usable diagnostics inside `settings`.

Primary files:

- [src/server/jobs/sync-runtime.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/sync-runtime.ts)
- [src/inngest/sync-wb.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts)
- [src/app/(dashboard)/settings/SyncButton.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/SyncButton.tsx)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)

Expected output:

- repeated WB `401` auth failures no longer flood `sync_runs.error_message`;
- settings shows a concise diagnosis plus source-level breakdown;
- operator can jump directly to the token update block after an auth failure.

Result:

- sync runtime now classifies source errors into token/auth/upstream/network categories and stores concise per-source metadata in `summary`
- final `sync_runs.error_message` is now built from a normalized diagnosis instead of raw concatenation of every failing source payload
- settings sync UI now renders diagnosis banners, source-level status cards, and a direct jump to the `Wildberries Token` card
- invalid-token runs now end with a short actionable operator message instead of a multi-screen wall of `401 Unauthorized` details

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P14. Token Preflight And Sync History UX

Priority: `P1`

Status: `done`

Goal:

- make the WB token state explicit before sync starts and improve the post-sync operator loop in `settings`.

Primary files:

- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/app/(dashboard)/settings/sync-action.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/sync-action.ts)
- [src/app/(dashboard)/settings/SyncButton.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/SyncButton.tsx)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)

Expected output:

- `settings` can run an explicit WB token preflight before a full sync;
- preflight reports which WB API contours accept or reject the token;
- post-sync UX shows recent run history, per-run source breakdown, fast retry, and an explicit empty-history state.

Result:

- `validateWbToken()` now checks four WB contours (`statistics`, `content`, `prices`, `ads`) against either the draft token input or the stored encrypted token
- preflight classifies invalid token, auth, upstream, network, and missing-token cases into operator-readable feedback instead of raw exception text
- the `Wildberries Token` card now supports both save and preflight actions with inline result banners and per-contour status cards
- `settings` now reads recent `sync_runs` history, not only the latest run, and offers quick retry for the last range or any previous range
- history details now expose per-source breakdown and an explicit empty-history placeholder when only one run exists so the block never disappears unexpectedly

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P15. Guarded Token Save Lifecycle

Priority: `P1`

Status: `done`

Goal:

- finish the WB token lifecycle so saving is explicit, guarded, and backed by a persisted last-known health state.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0003_condemned_vermin.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0003_condemned_vermin.sql)
- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)

Expected output:

- the primary save path persists only a token that passes preflight cleanly;
- a risky token can still be stored, but only through a separate explicit `save with warning` step;
- settings shows the last-known health of the saved token even before the next sync;
- local DB repair knows how to restore the new tenant token-health columns.

Result:

- `tenants` now stores `wb_token_health_status`, `wb_token_checked_at`, and `wb_token_health_summary`
- `saveApiToken()` now runs a server-side draft-token preflight and blocks the first save when the token needs operator acknowledgement
- the settings card now exposes two distinct paths: strict save for a passing token and explicit `save with warning` for a risky token
- `getTenantSettings()` no longer returns the encrypted WB token to the client and now returns only safe settings data plus persisted token-health state
- `db:repair-local` now repairs the `tenant` token-health columns and records the new migration metadata locally

Checks:

- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run db:repair-local`
- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`
- browser verification of `strict save blocked -> save with warning -> stored health updated`

## P16. Guarded Cabinet Onboarding And Sync Risk Surfacing

Priority: `P1`

Status: `done`

Goal:

- remove the remaining onboarding bypass around WB token policy and surface saved token risk directly in the sync controls.

Primary files:

- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)
- [src/app/(dashboard)/settings/SyncButton.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/SyncButton.tsx)
- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)

Expected output:

- new-cabinet onboarding obeys the same strict-save / warning-override WB token policy as the main token card;
- fake or risky tokens no longer create a cabinet silently on the first attempt;
- sync controls surface the saved token risk before launch instead of looking neutral.

Result:

- `addCabinet()` now runs server-side draft-token preflight and returns a blocked warning response before cabinet creation when the token is risky
- the onboarding modal now shows inline preflight feedback and a separate `Подключить кабинет с предупреждением` path
- `SyncButton` now reads saved token health, disables sync when the cabinet still has no token or no stored preflight state, and changes launch copy when the saved token is risky
- the operator smoke flow now explicitly follows the new onboarding warning-confirmation branch when a fake WB token is used

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P17. Cabinet Token Health Visibility

Priority: `P2`

Status: `done`

Goal:

- make the last-known WB token state visible not only inside the active token card, but also where operators browse and switch cabinets.

Primary files:

- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)
- [src/components/layout/TenantSwitcher.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/layout/TenantSwitcher.tsx)

Expected output:

- the cabinet list in `settings` shows whether each cabinet has no token, an unverified token, a healthy token, or a risky token;
- the global tenant switcher exposes the same signal for the active cabinet and every switch target;
- token save and stored-token preflight invalidate the relevant queries so these badges refresh immediately.

Result:

- `getAvailableTenants()` now returns `hasStoredToken`, `wbTokenHealthStatus`, and `wbTokenCheckedAt` for each accessible cabinet
- the `Все магазины` cards in `settings` now show a compact token-health badge instead of hiding token state until the operator opens each cabinet separately
- the global `TenantSwitcher` now shows the active cabinet token state and the same badge inside the dropdown list for every tenant option
- token save and stored-token validation now invalidate both `tenant` and `available-tenants` queries so cabinet badges update right after the health state changes

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P18. Chart Container Runtime Baseline

Priority: `P2`

Status: `done`

Goal:

- remove the remaining Recharts console noise from the operator runtime so smoke runs reflect real failures instead of chart mount warnings.

Primary files:

- [src/components/dashboard/PnLChart.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/PnLChart.tsx)

Expected output:

- the overview chart no longer mounts through a zero-sized container;
- local runtime smoke does not emit the `width(-1)` / `height(-1)` Recharts warning during the main operator path.

Result:

- `PnLChart` now measures its actual chart area through `ResizeObserver` and only mounts the Recharts canvas once width and height are known
- the chart keeps a stable `352px` measured drawing area inside the existing `400px` card footprint, so the layout stays visually unchanged while removing zero-size mount races
- the initial render now shows a lightweight in-card skeleton instead of mounting Recharts against an unresolved container size

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P19. Smoke Auth Navigation Abort Cleanup

Priority: `P2`

Status: `done`

Goal:

- determine whether the remaining `ECONNRESET` / `aborted` logs around signup-login smoke are a product bug or a harness artifact, and remove the artifact if confirmed.

Primary files:

- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)

Expected output:

- the runtime smoke no longer forces a redundant `/settings` reload immediately after the auth redirect has already landed there;
- `next dev` does not emit the old `ECONNRESET` / `aborted` noise during the auth-to-settings part of the operator smoke flow;
- the conclusion is explicit: this was harness-level dev noise, not a product runtime failure.

Result:

- investigated the auth flow and confirmed the noise was caused by the smoke harness reloading `/settings` even when auth had already redirected there successfully
- `ensureCabinet()` now reuses the current `settings` page after auth and only navigates to `/settings` when the smoke run is actually on another route
- after the change, runtime smoke completes without the previous `ECONNRESET` / `aborted` dev-server noise in the auth-to-settings window, so this item is classified as a harness cleanup rather than an app bug

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P20. Smoke Auto-Auth Noise Cleanup

Priority: `P2`

Status: `done`

Goal:

- remove the remaining predictable auth noise from smoke logs when the harness uses a freshly generated email.

Primary files:

- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)

Expected output:

- `SMOKE_AUTH_MODE=auto` no longer starts with a guaranteed failing login when the smoke run uses the default generated email;
- runtime smoke logs stop emitting the expected `Invalid login credentials` message for that default path;
- explicit smoke credentials still preserve the old login-first fallback behavior.

Result:

- the smoke harness now detects whether it is using the default generated email
- for generated credentials, auto-auth now starts with `signup` instead of a guaranteed failed `login`
- explicit `SMOKE_EMAIL` still keeps the previous auto-auth strategy where login is attempted first and signup is used only as fallback

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P21. Dashboard Data Freshness Context

Priority: `P1`

Status: `done`

Goal:

- surface last sync freshness and usable coverage directly on the main operator screens so data can be interpreted in context, not only from settings.

Primary files:

- [src/components/dashboard/DataFreshnessBanner.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/DataFreshnessBanner.tsx)
- [src/app/(dashboard)/overview/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/page.tsx)
- [src/app/(dashboard)/economics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/economics/page.tsx)
- [src/app/(dashboard)/dynamics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/dynamics/page.tsx)
- [src/app/(dashboard)/explorer/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/explorer/page.tsx)
- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)

Expected output:

- `overview`, `economics`, `dynamics`, and `explorer` show the latest sync result and the last usable sync directly on the page;
- analytics screens show whether the active date range is fully covered by the last usable sync;
- the operator smoke path explicitly checks that the freshness banner renders on the main data pages.

Result:

- added reusable `DataFreshnessBanner` based on `sync_runs` history with states for no sync, running sync, failed latest run, partial sync, and healthy usable sync
- `overview` and `economics` now keep their freshness context visible even on loading, empty, and error states instead of only on successful data renders
- `dynamics` and `explorer` now surface the same sync context, while `explorer` no longer carries its own duplicated latest-sync widget
- the banner links back to `/settings`, shows the last attempt, last usable sync, sync coverage range, and the active analytics range when relevant
- runtime smoke now waits for `data-freshness-banner` on `/overview` and `/economics`, so the new product surface is covered by the existing path

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P5. Documentation Baseline Inside Repo

Priority: `P1`

Status: `done`

Goal:

- replace stale or generic docs with repo-accurate ones.

Primary files:

- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [docs/PROJECT_GUIDE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PROJECT_GUIDE.md)
- [AGENTS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/AGENTS.md)

Expected output:

- anyone opening the repo understands what it is, how to run it, and what is unfinished;
- stale generic Next.js boilerplate is removed;
- technical guide reflects the actual runtime, schedules, and known gaps instead of wishful descriptions.

Result:

- `README.md` now explains the repo boundary, current implementation status, main screens, required environment variables, useful commands, and the current verification baseline
- `docs/PROJECT_GUIDE.md` now reflects the actual stack, tenant model, ingestion runtime, current routes/screens, migration baseline, and known gaps as of `2026-04-03`
- `AGENTS.md` now explicitly treats `README.md` as a required maintained document alongside backlog/changelog/project guide
- stale note in `B0` about the missing GitHub remote was corrected so the backlog no longer lies about repository operations

Checks:

- manual path/link review
- `git diff --check`
- docs stop overstating completeness;
- repo docs align with the root passport.

Checks:

- manual doc review;
- `git diff --check`

## P6. Testing And Release Baseline

Priority: `P2`

Status: `done`

Goal:

- establish a reproducible quality bar before broader feature work.

Primary files:

- [package.json](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/package.json)
- [eslint.config.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/eslint.config.mjs)
- [test.js](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/test.js)
- [test-query.js](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/test-query.js)

Expected output:

- project has a known verification path;
- baseline lint/test failures are enumerated or reduced;
- release checks are documented.

Result:

- added `scripts/release-baseline.mjs` as one reproducible repo-level audit path for worktree cleanliness, drizzle drift, build, and lint
- added [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md) to document the release gate, current blockers, and required human review
- reduced non-signal lint noise by excluding local scratch/root utility scripts from `eslint.config.mjs`
- documented the current hard blockers explicitly: repository-wide lint failures and the presence of dirty/untracked runtime files that can hide release risk

Checks:

- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run build`
- `npm run lint`
- `node scripts/release-baseline.mjs --report-only`

Checks:

- `npm run build`
- `npm run lint`

## P7. GitHub Remote And PR Workflow

Priority: `P2`

Status: `done`

Goal:

- connect this local repo to a real GitHub repository and enable PR-based progress.

Result:

- private GitHub repository created: `viteab-source/enterprise-wb-analytics`
- `origin` configured for fetch/push over SSH
- repo is ready for branch pushes and PR-based workflow

Checks:

- `git remote -v`
- `gh repo view`

## P8. Release Blocker Cleanup

Priority: `P2`

Status: `done`

Goal:

- remove the remaining blockers that prevented the branch from being honestly described as release-ready.

Primary files:

- [src/app/(auth)/invite/[token]/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(auth)/invite/[token]/page.tsx)
- [src/app/(dashboard)/cabinets/[tenantId]/team/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/cabinets/[tenantId]/team/page.tsx)
- [src/app/api/bot/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/bot/route.ts)
- [src/components/dashboard](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard)
- [src/components/layout](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/layout)
- [src/lib/supabase](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/supabase)
- [src/app/layout.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/layout.tsx)
- [src/app/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/page.tsx)
- [package.json](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/package.json)
- [package-lock.json](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/package-lock.json)
- [.gitignore](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/.gitignore)

Expected output:

- repo-wide lint no longer fails;
- runtime files used by the current build are committed instead of living only in a dirty worktree;
- release baseline can pass from a clean checkout.

Result:

- removed all repo-wide lint errors by replacing `any` with typed structures, fixing the invite/team/bot flows, and removing the `setState`-inside-effect issue in the date picker
- committed the current runtime baseline for auth pages, dashboard layout/provider setup, dashboard tables, theme support, Supabase helpers, and package manifests so the branch no longer depends on hidden untracked source files
- updated `.gitignore` so local scratch scripts and Supabase temp artifacts do not pollute the release baseline
- release baseline now passes with warnings only, which means the branch can be described as release-ready at the current quality bar

Checks:

- `npm run lint`
- `npm run build`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `node scripts/release-baseline.mjs`

## P9. Operator Smoke Flow

Priority: `P2`

Status: `done`

Goal:

- establish one repeatable browser smoke flow for the main operator journey.

Primary files:

- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)
- [docs/SMOKE_OPERATOR_FLOW.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SMOKE_OPERATOR_FLOW.md)
- [src/app/(auth)/login/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(auth)/login/page.tsx)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)
- [src/app/(dashboard)/settings/SyncButton.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/SyncButton.tsx)
- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md)

Expected output:

- operator flow `login -> settings -> manual sync -> overview -> economics` is reproducible from one command;
- smoke artifacts are saved for debugging;
- release docs point to a real browser verification path instead of ad-hoc manual clicks.

Result:

- added `npm run smoke:operator` backed by `scripts/smoke-operator-flow.mjs`
- smoke flow now covers auto auth, first-cabinet creation from `/settings`, manual sync trigger, and validation of `/overview` plus `/economics`
- smoke artifacts are written to `output/playwright/operator-smoke-<timestamp>/` with screenshots, JSON report, and Playwright trace
- login/settings/sync UI now exposes stable `data-testid` hooks so browser checks do not depend on fragile decorative selectors
- local verification confirmed the flow passes end-to-end against `next dev` when the smoke uses `http://localhost:3000` as the default base URL

Checks:

- `npm run smoke:operator`
- `npm run lint`
- `npm run build`

## P10. Team Workflow Finish

Priority: `P2`

Status: `done`

Goal:

- make the team/cabinet management flow trustworthy for real operators instead of leaving it as a rough admin screen.

Primary files:

- [src/app/(dashboard)/cabinets/[tenantId]/team/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/cabinets/[tenantId]/team/page.tsx)
- [src/app/(dashboard)/cabinets/user-actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/cabinets/user-actions.ts)
- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)

Expected output:

- the team page shows correct cabinet context and usable feedback;
- destructive actions are visible only to roles that can actually execute them;
- invite flow validates input and no longer relies on browser `alert()` popups;
- navigation back to cabinet settings is valid.

Result:

- the team screen now unwraps dynamic `params` correctly for Next 16 client routes and no longer trips runtime errors in dev
- back navigation now returns to `/settings` instead of a non-existent `/cabinets` route
- team data now returns cabinet metadata plus current user role so the UI can show the real cabinet name and role-aware controls
- owner/admin responsibilities are separated in the UI: admins can invite, but only owners see revoke/remove controls that the server will actually accept
- invitation creation now validates email format, blocks self-invites, and surfaces success/error feedback inline instead of via `alert()`
- browser verification confirmed the flow `settings -> все магазины -> команда`, invite button visibility for the owner, and the corrected back link to `/settings`

Checks:

- `npm run lint`
- `npm run build`
- browser verification of the team route

## P11. Local DB Migration Repair

Priority: `P1`

Status: `done`

Goal:

- bring the local Postgres runtime to the committed migration baseline so operator flows stop failing on missing tables like `sync_runs`.

Primary files:

- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [package.json](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/package.json)
- [README.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/README.md)
- [docs/PROJECT_GUIDE.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PROJECT_GUIDE.md)
- [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md)

Expected output:

- local DB has all current public tables from the committed schema;
- `drizzle.__drizzle_migrations` exists and reflects `0000..0002`;
- manual sync no longer crashes on missing `sync_runs`, and instead records a normal runtime status/error.

Result:

- added `npm run db:repair-local` backed by `scripts/repair-local-db-baseline.mjs`
- the helper detects the known local drift pattern, repairs missing `raw_api_prices` and `sync_runs`, creates `drizzle.__drizzle_migrations`, and records committed migration metadata with real SHA-256 hashes
- local DB moved from 18 to 20 public tables and now records all three committed migrations
- browser smoke confirmed that manual sync now writes a real `failed` record into `sync_runs` with `error_message='fetch failed'` instead of crashing on `relation "sync_runs" does not exist`

Checks:

- `npm run db:repair-local`
- `npm run smoke:operator`
- `npm run lint`
- `npm run build`

## P22. Signals Drill-Down Workflow

Priority: `P2`

Status: `done`

Goal:

- turn the signals feed into an actionable operator workflow instead of leaving `Детали` as a decorative button.

Primary files:

- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/dashboard/SignalDetailsPanel.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalDetailsPanel.tsx)
- [src/app/api/views/dashboard/signals/[signalId]/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signals/[signalId]/route.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)

Expected output:

- the overview signal cards open a real detail workflow;
- signal detail is assembled from the existing tenant-scoped product, metadata, stock, and economics data;
- operators get concrete next steps instead of a dead-end CTA;
- smoke can verify the drill-down when active signals exist.

Result:

- added a tenant-safe signal detail API endpoint and a new analytics-engine detail aggregator without introducing another migration
- the signal detail panel now shows SKU context, 14-day metrics, warehouse breakdown, content metadata, derived insights, and role-aware resolve/ignore actions
- the feed now sorts active signals by severity and recency, and the old decorative `Детали` button is replaced with a real right-side drill-down
- operator next-step links now route directly to `economics`, `dynamics`, `explorer`, or `settings` depending on signal type
- smoke now conditionally opens the drill-down and fails if the detail panel renders an error state when a signal is present

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P23. Signal Follow-Up Focus States

Priority: `P2`

Status: `done`

Goal:

- turn signal recommendation links into direct operator workflows that land on the relevant SKU and data source instead of just opening a generic screen.

Primary files:

- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/economics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/economics/page.tsx)
- [src/components/dashboard/EconomicsTable.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/EconomicsTable.tsx)
- [src/app/(dashboard)/explorer/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/explorer/page.tsx)
- [src/app/api/views/explorer/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/explorer/route.ts)
- [scripts/smoke-operator-flow.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/smoke-operator-flow.mjs)

Expected output:

- signal recommendation links lead into contextual `economics` or `explorer` states;
- target screens clearly show that they are filtered to a signal-driven SKU focus;
- operators can clear the focus explicitly and return to the generic screen;
- smoke knows how to validate this follow-up path when a signal is present.

Result:

- signal recommendations now carry `focusNmId`, `focusSignalType`, `focusTitle`, and, for explorer, the relevant raw tab in the URL
- economics now narrows the table to the focused SKU when it exists, highlights that row, and shows a clear signal-focus banner
- explorer now filters raw data by `nmId`, preselects the relevant tab, keeps that focus while switching tabs, and surfaces an explicit reset action
- smoke now follows the first recommendation link from the signal drill-down and verifies `signal-focus-banner` when the target is `economics` or `explorer`

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P24. Back To Signal Workflow

Priority: `P2`

Status: `done`

Goal:

- let operators return from focused `economics` or `explorer` directly to the originating signal, reopening the same drill-down on `overview` without manual searching.

Primary files:

- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/overview/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/page.tsx)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/app/(dashboard)/economics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/economics/page.tsx)
- [src/app/(dashboard)/explorer/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/explorer/page.tsx)

Expected output:

- focused follow-up links carry enough context to restore the original signal;
- focused operator screens expose an explicit return path back to the signal;
- `overview` automatically reopens the target signal drawer when the operator comes back with a `signalId`.

Result:

- signal follow-up URLs now carry `signalId` alongside the focus context
- focused `economics` and `explorer` banners now show a `Вернуться к сигналу` action that routes back to `/overview?signalId=...`
- `overview` now wraps `SignalsFeed` in `Suspense`, and `SignalsFeed` restores the selected signal from `signalId` on mount so the same drawer reopens immediately after the return
- the signal feed also surfaces a small `Возврат к сигналу` chip so the operator can see why that signal opened automatically

Checks:

- `npm run lint`
- `npm run build`

## P25. Signal Operator Memory Context

Priority: `P2`

Status: `done`

Goal:

- preserve operator memory around signal investigation so the drawer remembers where the operator came from and what signals were reviewed recently.

Primary files:

- [src/lib/operator-signal-memory.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-memory.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/dashboard/SignalDetailsPanel.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalDetailsPanel.tsx)
- [src/app/(dashboard)/economics/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/economics/page.tsx)
- [src/app/(dashboard)/explorer/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/explorer/page.tsx)

Expected output:

- `overview` distinguishes whether the operator returned from `economics` or `explorer`;
- signal detail exposes the last-opened source and a quick history of recently reviewed signals;
- operators can reopen still-active reviewed signals directly from the drawer;
- focused explorer tabs preserve `signalId`, so the return path survives tab switches.

Result:

- added a client-side operator memory store in `src/lib/operator-signal-memory.ts` backed by `localStorage` and `useSyncExternalStore`
- `SignalsFeed` now records the last-opened source for each reviewed signal, restores source-aware return badges, and keeps a recent-signal history available to the drawer
- `SignalDetailsPanel` now shows operator context with the last-opened source/time plus a quick list of recently reviewed signals that can be reopened when still active
- focused `economics` and `explorer` screens now return with `signalReturnFrom=economics|explorer`, and explorer keeps `signalId` while switching raw tabs so the back-to-signal workflow remains intact

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P26. Server-Side Signal Operator Timeline

Priority: `P2`

Status: `done`

Goal:

- move signal investigation context out of browser-local memory into a shared server-side timeline so `who / when / from where` survives devices and team members.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0004_overjoyed_lionheart.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0004_overjoyed_lionheart.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/app/api/views/dashboard/signals/[signalId]/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signals/[signalId]/route.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/dashboard/SignalDetailsPanel.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalDetailsPanel.tsx)

Expected output:

- signal detail records review events on the server with actor, role, source, and timestamp;
- the drawer shows a shared timeline for the current signal and recent reviewed signals across the tenant;
- the return path from focused screens still works, but its context is now persisted in DB instead of local browser state;
- local DB repair knows how to bootstrap the new timeline table on an existing workspace database.

Result:

- added `signal_operator_timeline` plus migration `0004_overjoyed_lionheart.sql`
- `GET /api/views/dashboard/signals/[signalId]` now validates `openedFrom`, records a timeline event with the authenticated user, and returns timeline data together with signal detail
- `AnalyticsEngine` now deduplicates repeated short-window opens, assembles per-signal history, and derives recent reviewed signals across the tenant
- the drawer now shows `кто / когда / откуда` for the current signal and no longer depends on browser-local `localStorage` to preserve operator context
- `db:repair-local` now repairs and records the new timeline migration for existing local databases

Checks:

- `npm run db:repair-local`
- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`
- direct server-side check through `AnalyticsEngine.getSignalDetails(...)` with a real active signal

## P27. Signal Collaboration Workflow

Priority: `P2`

Status: `done`

Goal:

- turn the shared signal timeline into a real team workflow with notes, assignee ownership, and explicit handoff/status tracking.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0005_volatile_vin_gonzales.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0005_volatile_vin_gonzales.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/lib/auth/user-bootstrap.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/auth/user-bootstrap.ts)
- [src/app/(auth)/login/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(auth)/login/actions.ts)
- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/app/(dashboard)/cabinets/user-actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/cabinets/user-actions.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/dashboard/SignalDetailsPanel.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalDetailsPanel.tsx)

Expected output:

- each signal can carry a shared assignee and workflow state visible to the whole team;
- operators can leave notes on a signal without leaving the drawer;
- collaboration metadata survives device changes and is tied to the real authenticated user identity;
- local DB repair can bootstrap the new collaboration columns on an existing workspace.

Result:

- added migration `0005_volatile_vin_gonzales.sql` with `risk_signals` workflow fields, richer `signal_operator_timeline` event metadata, and `users.email`
- `user-bootstrap`, login, cabinet onboarding, and invitation acceptance now persist the authenticated email into the local `users` table so collaboration actions can show stable actor labels
- added server actions and engine methods for `assignSignalOwner`, `updateSignalWorkflowState`, and `addSignalNote`
- the signal drawer now exposes team workflow UI with assignee selection, workflow status updates, shared notes, and a richer event history for the current signal
- `db:repair-local` now repairs the `0005` collaboration columns and verifies them before recording the migration metadata baseline

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm run smoke:operator:runtime`

## P28. Signal Workflow Filters And Collaboration Alerts

Priority: `P2`

Status: `done`

Goal:

- expose team workflow directly in the signals list and add collaboration notifications for note/reassignment/blocked events.

Primary files:

- [src/app/api/views/dashboard/signals/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signals/route.ts)
- [src/app/api/views/dashboard/signal-notifications/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signal-notifications/route.ts)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/server/bot/service.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/bot/service.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/components/layout/Header.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/layout/Header.tsx)
- [src/components/layout/SignalNotificationsMenu.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/layout/SignalNotificationsMenu.tsx)
- [src/app/(dashboard)/overview/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/page.tsx)

Expected output:

- operators can filter active signals by assignee and workflow state from the list itself;
- the dashboard surfaces recent collaboration events in-app without opening a signal drawer first;
- Telegram alerts are sent automatically when a note is added, a signal is reassigned, or a signal becomes blocked.

Result:

- the signals API now returns filter metadata together with the active signal list, and the feed now exposes assignee/workflow filters plus workflow/owner chips on each card
- added a tenant-safe `signal-notifications` API route and a header-level in-app notification menu for recent note/reassignment/blocked events from other operators
- collaboration actions now invalidate the notification query so the in-app center updates immediately after note/assignment/workflow changes
- `AnalyticsEngine` now derives notification items from the shared timeline and dispatches Telegram collaboration alerts through `BotService`
- `BotService` now supports collaboration event messages with direct deep-links back into `overview?signalId=...`

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P29. Notification Receipts And Bulk Signal Triage

Priority: `P2`

Status: `done`

Goal:

- make collaboration notifications stateful per operator and let the team process signal batches without opening every card one by one.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0006_fearless_gambit.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0006_fearless_gambit.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/app/api/views/dashboard/signal-notifications/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/views/dashboard/signal-notifications/route.ts)
- [src/components/layout/SignalNotificationsMenu.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/layout/SignalNotificationsMenu.tsx)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- in-app notifications remember whether the operator has seen them and whether they have explicitly acknowledged them;
- the header badge reflects unread collaboration events rather than the raw number of items in the feed;
- operators can bulk-assign, bulk-handoff, and bulk-close visible signal batches directly from the list.

Result:

- added `signal_notification_receipts` plus migration `0006_fearless_gambit.sql` for per-user `read_at` and `acknowledged_at` state tied to timeline events
- `AnalyticsEngine.getSignalNotifications(...)` now merges timeline events with receipts and returns both the visible notification list and an unread count
- the header notification center now auto-marks visible items as read on open and supports explicit per-item or bulk acknowledgement
- `overview` signal actions now include bulk assign, bulk workflow update, and bulk resolve/ignore operations with the same server-side permission checks as single-item triage
- `db:repair-local` now bootstraps the receipts table and records migration `0006` on an existing local workspace database

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

## P48. Explicit Follow-Up Outcome Enforcement

Priority: `P2`

Status: `done`

Goal:

- make explicit follow-up outcomes operational, not decorative, so reminder scheduling respects `awaiting explicit outcome`, `acknowledged`, `action taken`, and `no action`.

Primary files:

- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/server/jobs/signal-sla-follow-up.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/signal-sla-follow-up.ts)

Expected output:

- follow-up waves without an explicit operator outcome should stop generating repeat reminders until the operator closes the loop;
- acknowledged/action-taken outcomes should pause reminder pressure instead of being treated as final disappearance of the problem;
- run log and run drill-down should expose how many signals are still waiting for an explicit operator outcome.

Result:

- `runSignalSlaPendingFollowUp(...)` now blocks repeat reminders when the latest follow-up wave still has no explicit outcome, applies grace windows for `acknowledged` and `action_taken`, and suppresses repeat follow-up after `no_action`
- automation runs and follow-up waves now expose `awaitingExplicitOutcomeCount`, and per-signal drill-down rows expose `awaitingFollowUpOutcome`
- `SignalsFeed` now surfaces those counts and badges directly in the run cards, wave blocks, and per-signal detail rows
- scheduled follow-up sweep aggregation now reports `awaitingExplicitOutcome`, `skippedAcknowledged`, and `skippedOutcomeCaptured` for the new lifecycle

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P50. SLA Escalation Alerts On Awaiting Outcome

Priority: `P2`

Status: `done`

Goal:

- escalate stale `awaiting explicit outcome` follow-ups into a real automation alert path instead of leaving them as passive counters in the run log.

Primary files:

- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/server/jobs/signal-sla-follow-up.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/jobs/signal-sla-follow-up.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)

Expected output:

- pending follow-up waves that sit without explicit outcome long enough should emit a separate automation escalation note with dedupe rather than silently waiting forever;
- scheduled and manual follow-up paths should both report how many escalation alerts were eligible, sent, or skipped as too fresh / already reminded;
- `overview` should surface those escalation alerts back in the automation run log and per-signal drill-down instead of hiding them in the raw timeline only.

Result:

- `runSignalSlaPendingFollowUp(...)` now emits `sla_follow_up_escalation` notes when a pending signal stays in `awaiting explicit outcome` beyond the escalation threshold and no recent alert was already sent
- follow-up sweep aggregation now reports `escalationEligible`, `escalationAlertsTriggered`, `skippedEscalationRecently`, and `skippedEscalationTooFresh`
- automation run cards, latest follow-up wave blocks, signal detail rows, and automation health summary in `SignalsFeed` now expose escalation alert counts and the last escalation timestamp

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/tsx -e "import { runScheduledSignalSlaFollowUpSweep } from './src/server/jobs/signal-sla-follow-up.ts'; (async () => { const result = await runScheduledSignalSlaFollowUpSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"`

## P51. Owner Queue Entry Points And Route-Aware Lanes

Priority: `P2`

Status: `done`

Goal:

- turn queue-owner workload summaries into actual entry points for operator work instead of static analytics cards detached from the signal feed.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/lib/signal-queue-utils.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-queue-utils.ts)
- [src/components/dashboard/SignalQueueOwnerSummaryStrip.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalQueueOwnerSummaryStrip.tsx)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- owner summary cards should expose queue-level counts (`needs action`, `awaiting owner`, `blocked`, `overdue`) and open that exact owner lane in `overview`;
- queue-owner filtering should affect the actual signal feed and queue counters, not only the shared-view and automation side panels;
- top-level overview KPI and feed-level owner summary should speak the same owner-workload model instead of drifting in separate implementations.

Result:

- `SignalQueueOwnerSummary` now carries per-owner queue counts, and `buildSignalQueueOwnerSummaries(...)` computes them once from shared views, automation runs, and the real signal feed
- `SignalQueueOwnerSummaryStrip` now opens owner-specific lanes through route state (`ownerQueue`, `ownerQueueView`, `ownerQueueSort`), so KPI cards can jump straight into work
- `SignalsFeed` now treats queue-owner selection as a real feed scope: queue counts, SLA preset counts, and visible signals are filtered by the active owner lane
- feed-level owner cards now expose one-click lane buttons for `needs action`, `awaiting owner`, `blocked`, and `overdue`, and manual interactions clear the route-driven preset cleanly

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P52. Owner Defaults And Queue Balancing Operations

Priority: `P2`

Status: `done`

Goal:

- turn owner queues into operable shared lanes by adding per-owner shared defaults and direct handoff/rebalance controls on top of the existing workload cards.

Primary files:

- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/lib/signal-queue-utils.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-queue-utils.ts)
- [src/components/dashboard/SignalQueueOwnerSummaryStrip.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalQueueOwnerSummaryStrip.tsx)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- team/shared defaults should support one global fallback plus one default preset inside each owner queue instead of one tenant-wide shared star;
- operators should be able to hand selected visible signals directly into an owner queue from the workload cards without dropping into the generic bulk toolbar first;
- owner cards should also surface a safe rebalance shortcut that moves a small `needs action` batch from the busiest owner queue into a lighter one with an explicit audit note.

Result:

- `AnalyticsEngine.setSignalSavedViewDefault(...)` now resets shared defaults only inside the matching `sharedOwnerUserId` bucket, so global team fallback and owner-specific defaults can coexist without a schema change;
- `SignalsFeed` now resolves shared default semantics explicitly: owner lanes can auto-open their own `owner default`, while the tenant-wide `team default` remains the fallback for operators without a personal preset;
- shared saved-view chips/cards now label `My default`, `Team default`, and `Owner default` separately, so operators can see which preset scope they are editing or reopening;
- owner workload cards now expose `Selected to owner` and `Balance N` operations backed by the existing bulk handoff path, including audit notes for direct queue handoff and workload rebalance actions;
- `SignalQueueOwnerSummaryStrip` now reflects the new default semantics in its owner cards instead of showing every shared default as the same generic label.

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P53. Production Contour, CI, And Pilot Operating Baseline

Priority: `P1`

Status: `done`

Goal:

- move the repo from a strong local operator baseline to a repeatable production/pilot baseline with explicit deploy artifacts, automated checks beyond smoke, and a documented live operating model.

Primary files:

- [package.json](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/package.json)
- [next.config.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/next.config.ts)
- [src/app/api/health/route.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/api/health/route.ts)
- [src/lib/operator-signal-timeline.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.test.ts)
- [src/lib/signal-queue-utils.test.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-queue-utils.test.ts)
- [vitest.config.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/vitest.config.ts)
- [Dockerfile](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/Dockerfile)
- [render.yaml](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/render.yaml)
- [.github/workflows/ci.yml](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/.github/workflows/ci.yml)
- [docs/PRODUCTION_DEPLOYMENT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PRODUCTION_DEPLOYMENT.md)
- [docs/PILOT_OPERATIONS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PILOT_OPERATIONS.md)
- [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md)

Expected output:

- the repo should expose a real production health endpoint and a committed deployment path instead of depending only on local tribal knowledge;
- CI should run lint, unit tests, and production build automatically on branch pushes and PRs;
- automated tests should cover core queue/notification logic, not only browser smoke;
- pilot work should be documented as a concrete operating model with roles, queues, cadence, and KPI definitions.

Result:

- added `/api/health`, `scripts/healthcheck.mjs`, `.env.example`, `Dockerfile`, and `render.yaml`, giving the repo an explicit production boot/health/deploy contour;
- enabled `next build` standalone output for container deployment and added `db:migrate`, `test`, `test:watch`, and `test:coverage` scripts in `package.json`;
- added `vitest` coverage for signal notification helpers and queue workload logic, including rebalance suggestion behavior;
- added GitHub CI workflow `.github/workflows/ci.yml` running `lint`, `test`, and `build` on pushes/PRs with safe placeholder env vars;
- expanded `scripts/release-baseline.mjs` and [docs/RELEASE_CHECKLIST.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/RELEASE_CHECKLIST.md) so release gates now include unit tests;
- documented the recommended production topology in [docs/PRODUCTION_DEPLOYMENT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PRODUCTION_DEPLOYMENT.md) and the first live pilot operating model in [docs/PILOT_OPERATIONS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/PILOT_OPERATIONS.md).

Checks:

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run test:coverage`
- `npm run smoke:operator:runtime`

## P49. Automation Notification Routing And Preferences

Priority: `P2`

Status: `done`

Goal:

- split SLA automation traffic from ordinary collaboration notes so operators can manage automation noise separately in-app and in Telegram.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/server/bot/service.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/bot/service.ts)

Expected output:

- automation notes (`sla`, `follow-up`, `follow-up resolution`, escalation alert) should no longer be governed by the generic `note` preference;
- `settings` should expose a dedicated automation toggle for both tenant Telegram fan-out and personal in-app notification center state;
- Telegram collaboration alerts should visually distinguish SLA automation alerts from ordinary operator comments.

Result:

- signal notification preferences now include a dedicated `automation` key, with backward-compatible fallback to the historical `note` value when old JSON is loaded
- note events carrying SLA automation payloads are now routed through the `automation` preference in both `getSignalNotifications(...)` and Telegram dispatch
- `settings` now exposes `SLA / automation alerts` as a first-class toggle, and Telegram automation alerts use a dedicated alert emoji instead of the generic comment marker

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P47. Automation Governance History And Suppression Lifecycle

Priority: `P2`

Status: `done`

Goal:

- turn SLA control-plane actions into an auditable governance layer with `reason`, `suppress until`, and a persistent manual `preview -> execute` chain.

Primary files:

- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0013_fixed_nebula.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0013_fixed_nebula.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)

Expected output:

- suppressions should keep `reason` and `suppress until` instead of being anonymous on/off flags;
- unsuppress should not erase history, so operators can inspect who created and cleared a suppression;
- manual dry-run preview and manual execute should leave a linked history chain in `overview`.

Result:

- added `signal_automation_control_events` plus suppression lifecycle fields via `0013_fixed_nebula.sql`, and `db:repair-local` now repairs the local governance baseline to `26` public tables / `14` recorded migrations
- dry-run preview now records a control-event id, and manual execute records a linked governance event so `overview` can show a real `preview -> execute` chain
- suppression rows now persist `reason`, `suppressUntil`, `clearedAt`, `clearedBy*`, and `clearReason` instead of being deleted on unsuppress
- `SignalsFeed` now exposes a suppression policy editor, governance-history list, and suppression-audit list alongside the existing automation health and preview cards

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

## P31. Signal Drawer Presets And Working Queues

Priority: `P2`

Status: `done`

Goal:

- keep single-signal investigation aligned with the bulk triage workflow and turn handoff status into explicit operator queues rather than hidden card metadata.

Primary files:

- [src/lib/signal-workflow-config.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/signal-workflow-config.ts)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalDetailsPanel.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalDetailsPanel.tsx)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)

Expected output:

- operators can use the same note templates and handoff presets from the signal drawer that they already have in bulk triage;
- `overview` exposes queue-like views for `needs action`, `blocked`, and `awaiting owner`, so handoff status becomes a working list;
- those queues still compose with the lower-level assignee/workflow filters instead of replacing them.

Result:

- extracted shared signal note templates and handoff presets into `src/lib/signal-workflow-config.ts`, so both the drawer and bulk toolbar consume the same workflow contract
- added `applySignalHandoffPresetAction(...)` for single-signal preset application from the drawer
- `SignalDetailsPanel` now exposes note template chips plus one-click handoff presets that reuse the current assignee draft when present
- `SignalsFeed` now has explicit working queues for `all`, `needs action`, `blocked`, and `awaiting owner`; `awaiting owner` is derived from `handoff` signals assigned to `owner/admin`, while `needs action` keeps the remaining non-blocked operator queue

Checks:

- `npm run lint`
- `npm run build`
- `npm run smoke:operator:runtime`

## P30. Notification Preferences And Bulk Handoff Notes

Priority: `P2`

Status: `done`

Goal:

- let each operator decide which collaboration events appear in-app, let the cabinet decide which ones fan out to Telegram, and make batch triage capable of leaving shared notes and preset handoff context in one pass.

Primary files:

- [src/lib/operator-signal-timeline.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/operator-signal-timeline.ts)
- [src/lib/db/schema.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/db/schema.ts)
- [drizzle/0007_thin_shape.sql](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0007_thin_shape.sql)
- [scripts/repair-local-db-baseline.mjs](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/repair-local-db-baseline.mjs)
- [src/app/(dashboard)/settings/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/actions.ts)
- [src/app/(dashboard)/settings/page.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/settings/page.tsx)
- [src/app/(dashboard)/overview/actions.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/app/(dashboard)/overview/actions.ts)
- [src/components/dashboard/SignalsFeed.tsx](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/components/dashboard/SignalsFeed.tsx)
- [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts)

Expected output:

- signal collaboration notifications can be enabled or disabled by event type separately for the in-app header center and the tenant Telegram channel;
- `settings` exposes those preferences clearly enough that operators can understand the difference between personal in-app state and shared Telegram fan-out;
- bulk triage can leave one shared note across the visible batch and can apply one-click handoff presets instead of repeating the same workflow comments manually.

Result:

- added JSONB-backed signal notification preference columns on `tenants` and `user_tenants` via migration `0007_thin_shape.sql`
- `AnalyticsEngine.getSignalNotifications(...)` now filters notification items through the current operator's in-app preferences, and Telegram collaboration fan-out is filtered through tenant-level Telegram event prefs before `BotService` sends anything
- `settings` now has a dedicated per-user in-app preference card and a tenant-wide Telegram event preference section for `note`, `assignment/reassignment`, and `blocked`
- `overview` bulk triage now supports shared notes with quick templates plus handoff presets that apply assignee/workflow/note bundles to the visible selection
- `db:repair-local` now repairs and records migration `0007` for existing local workspace databases

Checks:

- `npm run lint`
- `npm run build`
- `npm run db:repair-local`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts`
- `npm run smoke:operator:runtime`

---

## Advertising Redesign Track (Wave 1 — «Страховочная сетка бюджета»)

> Задача: полный редизайн вкладки «Реклама» с целью создания инструмента, полностью заменяющего рекламный кабинет Wildberries. Принципы: **максимальная простота** (любой селлер разберётся без инструкции), **объяснимость** (под каждым автодействием — почему), **экономия бюджета** (не запускаем рекламу вслепую, автопаузы, cap).
>
> Что сохраняем: Drizzle-схемы 6 таблиц, Inngest-джоба `advertising-auto-bidder`, WB API-слой (rate-limit, окна, retry), финансовые расчёты из `workspace.ts`.
> Что сносим: `AdvertisingWorkspace.tsx` (4370 строк), текущую UI-структуру 4 таба, `/advertising/page.tsx`.
>
> WB API 2025: единый тип кампании 9 (unified/manual), min CPM 250 ₽, ставки конкурентов скрыты → оптимизируем по своим данным.

### P63 · Рефакторинг монолита AdvertisingWorkspace

Priority: `P2`

Status: `done (2026-04-17)`

Goal:

- разбить `AdvertisingWorkspace.tsx` (4370 строк) на компоненты по функциональным блокам;
- добавить виртуализацию для всех тяжёлых таблиц;
- закрыть `P2-23` (table virtualization).

Primary files:

- `src/components/advertising/AdvertisingWorkspace.tsx`
- `src/app/(dashboard)/advertising/page.tsx`

Plan:

- [x] Выделить 4 таба: `AdvertisingOverview.tsx`, `AdvertisingClusters.tsx`, `AdvertisingControl.tsx`, `AdvertisingBidWorkspace.tsx`
- [x] Вынести тяжёлую таблицу кластеров `<ClusterTable>` с виртуализацией (порог 50 строк); `SKUTable`/`BidChangeTable`/`RunHistoryTable` отложены как follow-up в P63.1 (зависят от дробления 8 sub-табов BidWorkspace)
- [x] Подключить `@tanstack/react-virtual` для таблиц >50 строк
- [x] Новая структура директории: `src/components/advertising/` → `_shared/`, `overview/`, `clusters/`, `control/`, `workspace/`
- [x] `page.tsx` — только layout + `next/dynamic` импорт табов (1300 → 190 строк)

Out of scope (→ P63.1):

- Дробление 8 sub-табов внутри `AdvertisingBidWorkspace` (bids/map/batch/ads2/strategies/pacing/portfolios/alerts) — они делят большой пул state и queries, требуют отдельной итерации.

Checks:

- `npm run build` ✓
- `npm run lint` ✓ (только pre-existing warnings)
- `npm run test` ✓ 125/125
- Визуальная проверка в браузере: **не выполнена в этой сессии**, рекомендуется smoke-test перед деплоем

---

### P63.1 · Дробление AdvertisingBidWorkspace на sub-tab компоненты

Priority: `P3`

Status: `done` ✅ (2026-04-18, Slices 0-8 merged via PRs `9ef48f1`/`94a13e1`/`0cac6ca`/`4aceec8`/`a1d7dfe`/`b84d6d5`/`2085c33`/`4cea854`/`ef0b42a`; Slice 9 остаётся в списке как optional follow-up — рассмотреть, если появится необходимость в shared `BidWorkspaceContext` для устранения props-drilling)

Goal:

- разбить `AdvertisingBidWorkspace.tsx` (4366 строк) на 8 sub-tab компонентов;
- сократить parent до контейнера со state/queries и conditional render `<XxxTab .../>`.

Primary file:

- `src/components/advertising/workspace/AdvertisingBidWorkspace.tsx`

Контекст: 8 sub-tab делят большой пул state/queries (line 907+) и handlers (line 1567+). Render-блоки изолированы, но props у каждого таба будут крупные (10-20 полей). Нужно идти slice-by-slice, по одному табу за итерацию, с QA в браузере между slices.

План slices (по возрастанию связности):

- [x] **Slice 0** (preparatory, 2026-04-18): вынес `panelClass` + `mapStatusLabel`/`alertSeverityLabel`/`alertTypeLabel` в `_shared/ui.ts`; удалил локальные дубликаты `formatMoney/formatMoneyPrecise/formatNumber/formatDecimal/formatPercent/formatDateTime` (взяты из `_shared/format.ts`). Файл 4366 → 4285 строк (-81). Build/lint/tests 301/301 ✓.
- [x] **Slice 1** (2026-04-18) — `AlertsTab` extracted to `tabs/AlertsTab.tsx` (138 строк, 8 props). Тип `AlertsResponse` перенесён в новый файл с `export type`. Build/lint/tests 301/301 ✓. Файл монолита 4285 → 4196 строк (-89).
- [x] **Slice 2** (2026-04-18) — `MapTab` extracted to `tabs/MapTab.tsx` (185 строк, 11 props). Типы `ClusterMapResponse`/`ClusterMapRow`/`MapStatusFilter`/`MapActionMessage` перенесены с `export type`. Toggle-mutation остаётся в parent, передаётся как callback `onToggle(cluster, currentStatus)`. Build/lint/tests 301/301 ✓. Файл монолита 4196 → 4072 строк (-124).
- [x] **Slice 3** (2026-04-18) — `BatchTab` extracted to `tabs/BatchTab.tsx` (184 строк, 11 props). Тип `BatchResult` + `BatchRiskLevel` перенесены. Mutation остаётся в parent, передаются callback'и `onDryRun/onApply/onConfirm`. Удалён неиспользуемый `riskLevelLabel` (дубль `riskLabel` в `_shared/ui.ts`) и тип `RiskLevel`. Build/lint/tests 301/301 ✓. Файл монолита 4072 → 3928 строк (-144).
- [x] **Slice 4** (2026-04-18) — `BidsTab` extracted to `tabs/BidsTab.tsx` (380 строк, 30 props). Типы `BidMode`/`BidWorkspaceRow`/`BidWorkspaceResponse`/`BulkBidResult` перенесены. Mutation остаётся в parent, передаются callback'и `onDryRun/onApply/onConfirm`. Selection-disabled flag вместо передачи `selectedCluster`/`effectiveAdvertId`. Удалены неиспользуемые импорты `Target`. Build/lint/tests 301/301 ✓. Файл монолита 3928 → 3694 строк (-234).
- [x] **Slice 5** (2026-04-18) — `Ads2Tab` extracted to `tabs/Ads2Tab.tsx` (447 строк, ~30 props). Helpers `toNullableNumber`/`toSummaryObject`/`bidChangeStatusLabel`/`strategyReasonLabel`/`drrToneClass` вынесены в `workspace/strategy-helpers.ts` (113 строк, shared с монолитом для будущего StrategiesTab). Render-блок (313 строк) заменён на `<Ads2Tab .../>`. Refetch bidsQuery/clusterMapQuery/strategiesQuery передан как `onSync`. Build/lint/tests 301/301 ✓. Файл монолита 3694 → 3310 строк (-384).
- [x] **Slice 6** (2026-04-18) — `PacingTab` extracted to `tabs/PacingTab.tsx` (499 строк, ~25 props). Типы `PacingRuleRecord`/`PacingResponse`/`PacingDraft`/`PacingEnabledFilter`/`PacingGroupBy` перенесены с `export type`. `PACING_PRESETS` (49 строк) и `applyPacingPreset` перенесены внутрь tab. Helpers `parseIntList`/`strategyStateLabel` вынесены в `strategy-helpers.ts` (нужны Portfolios/Strategies). Mutation остаётся в parent: callbacks `onSubmitDraft/onResetDraft/onEditRule/onRunRule/onDeleteRule/onToggleRule/onResetFilters`. Удалён неиспользуемый импорт `Clock3`. Build/lint/tests 301/301 ✓. Файл монолита 3310 → 2914 строк (-396).
- [x] **Slice 7** (2026-04-18) — `PortfoliosTab` extracted to `tabs/PortfoliosTab.tsx` (570 строк, ~28 props). Типы `PortfolioRecord`/`PortfoliosResponse`/`PortfolioDraft`/`PortfolioEnabledFilter`/`PortfolioModeFilter`/`PortfolioGroupBy` перенесены с `export type`. `PORTFOLIO_PRESETS` (69 строк) и `applyPortfolioPreset` перенесены внутрь tab. Mutation остаётся в parent: callbacks `onSubmitDraft/onResetDraft/onEditPortfolio/onRunPortfolio/onDeletePortfolio/onTogglePortfolio/onResetFilters`. Удалён неиспользуемый `BriefcaseBusiness`. Build/lint/tests 301/301 ✓. Файл монолита 2914 → 2481 строк (-433).
- [x] **Slice 8** (2026-04-18) — `StrategiesTab` extracted to `tabs/StrategiesTab.tsx` (1050 строк, ~37 props). Типы `StrategyRecord`/`StrategiesResponse`/`StrategyRun`/`StrategyRecentChange`/`StrategyTemplateKey`/`StrategyDraft`/`StrategyClusterRow`/`StrategyTodaySummary`/`StrategyAutopilotInsights` перенесены с `export type`. `STRATEGY_TEMPLATE_PRESETS` (150 строк) перенесён с `export const`. `normalizeRunEstimatedSavingsRub` — `export function` (используется parent-ом для `strategyAutopilotInsights`). `strategyGuardrailLabel`/`strategyGuardrailToneClass` — local (нужны только в журнале автоизменений внутри таба). `toSafeNumber` остаётся в монолите — нужен для ads2 summary. Mutation/template logic `applyStrategyTemplateToForm`/`saveStrategyFromTemplate` остаются в parent как callbacks. Cluster toggle вызывает parent `onToggleClusterFromRow`. Удалены неиспользуемые импорты `Bot`/`RefreshCcw`/`formatDateTime`/`formatDecimal`/`formatMoney`/`formatMoneyPrecise`/`formatNumber`/`formatPercent`/`mapStatusLabel` + helpers `bidChangeStatusLabel`/`drrToneClass`/`strategyReasonLabel`/`strategyStateLabel` из монолита. Build/lint/tests 301/301 ✓. Файл монолита 2481 → 1606 строк (-875).
- [ ] **Slice 9** (optional): рассмотреть `BidWorkspaceContext` для shared state/queries, чтобы убрать props-drilling.

Checks per slice:

- `npm run build` ✓
- `npm run lint` ✓
- `npm run test` ✓
- **Smoke-test в браузере** (открыть таб, проверить базовую функциональность) — обязательно, иначе slice не считается закрытым.

Out of scope:

- Изменение поведения, добавление фич, рефакторинг state-флоу — только перенос JSX в компоненты.

---

### P64 · Финансовое ядро рекламы: расчёты + Break-even CPM

Priority: `P1`

Status: `done` ✅ — 2026-04-17, код в commit `f8521a6`, закрытие задокументировано в этом коммите

Goal:

- выделить все финансовые расчёты в `src/lib/advertising/math.ts`;
- добавить Break-even CPM (макс. ставка, при которой реклама не убыточна);
- покрыть unit-тестами.

Plan:

- [x] `src/lib/advertising/math.ts` — `calcDRR`, `calcROAS`, `calcCPO`, `calcCPC`, `calcCTR`, `estimateBidSavingsRub`, `computeSelfLearningRunReward`
- [x] `calcBreakevenCPM({ margin, conversionRate, avgOrderValue }): number` — `(margin × conversionRate × avgOrderValue) / 10` (₽/1000 показов)
- [x] `calcBreakevenStatus(currentCPM, breakevenCPM): 'safe' | 'warning' | 'danger'`
- [x] `src/lib/advertising/math.test.ts` — 28 тестов: все функции + граничные случаи (нулевой CR, нулевая маржа, нулевая выручка, деление на ноль)
- [x] `src/server/advertising/workspace.ts` импортирует `estimateBidSavingsRub` и `computeSelfLearningRunReward` из `@/lib/advertising/math`

Checks:

- `npx vitest run src/lib/advertising/math.test.ts` → 28/28 passed ✅
- `npm run build` → ok ✅
- `npm run lint` → ok ✅

Commit кода: `f8521a6 feat(advertising): extract math module, add break-even CPM (P64)`

---

### P65 · Guardrails System — автопаузы, дневной cap, kill switch

Priority: `P1`

Status: `done` ✅ — 2026-04-17, код в commit `b684a1d`, миграция `drizzle/0036_advertising_guardrails.sql`

Goal:

- система предохранителей: 4 триггера автопаузы, дневной cap спенда, Advisor mode первые 7 дней, kill switch.

Primary files:

- `src/lib/advertising/guardrails.ts` ✅ — 10 триггеров, `normalizeGuardrailConfig`, `isInLearningPeriod`, `checkGuardrails`
- `drizzle/0036_advertising_guardrails.sql` ✅ — новая таблица `advertising_guardrail_events` + колонки `advertising_autopilot_enabled` на tenants, `guardrail_config`/`last_bid_changed_at`/`strategy_started_at` на strategies
- `src/server/advertising/workspace.ts` ✅ — `checkGuardrails` перед каждым bid-изменением в `executeStrategyRun`; strategy-level блок скипает весь run + логирует событие; per-cluster блок фильтрует предложения; `lastBidChangedAt` обновляется после apply

Plan:

**Правила (per-tenant, настраиваемые):**
- [x] Автопауза: остатки nmId < `minStockThreshold` (default: 3 шт.) — `low_stock`
- [x] Автопауза: ДРР > `maxDRR` (default: 1.5× `targetAcosPct`) — `high_drr`
- [x] Автопауза: 0 заказов при расходе > `maxSpendWithoutOrders` ₽ за 24ч (default: 500 ₽) — `spend_no_orders`
- [x] Автопауза: CR < `minCR`% за 7 дней (default: 0.1%) — `low_cr`
- [x] Дневной cap: `dailySpendCap` ₽ — `daily_cap`
- [x] Hard: max delta ставки за шаг ≤ 20% — `max_bid_delta`
- [x] Hard: max ставка ≤ `maxBidMultiplier`× рекомендованной WB (default: 1.5×) — `max_bid`
- [x] Cooldown: `bidCooldownMinutes` мин (default: 60) — `cooldown`
- [x] Kill switch: `autopilotEnabled` на уровне тенанта — `kill_switch`

**Learning period:**
- [x] Первые 7 дней стратегии → только Advisor (`advisorOnly: true`, bid-изменения не применяются)
- [x] После 7 дней → автоматически Autopilot

**Интеграция:**
- [x] Перед каждым bid-изменением в Inngest: прогнать guardrails
- [x] При срабатывании: логировать в `advertising_guardrail_events`
- [x] Drizzle-миграция `0036_advertising_guardrails.sql`

Checks:

- `npx vitest run src/lib/advertising/guardrails.test.ts` → 42/42 passed ✅
- `npm run build` → ok ✅
- `npm run lint` → ok ✅

Commit кода: `b684a1d feat(advertising): guardrails system — auto-pause, daily cap, kill switch (P65)`

---

### P66 · Страница баланса: просмотр, пополнение, автопополнение

Priority: `P1`

Status: `done` — 2026-04-17, commit 1ea0247

Goal:

- секция «Баланс»: реальные деньги vs промо-бонусы WB, пополнение через UI, автопополнение по порогу.

WB API: `GET /adv/v1/balance`, `GET /adv/v1/upd`, `POST /adv/v1/budget/deposit`.

Primary files:

- `src/lib/wb-api/ads-balance.ts` (новый)
- `src/app/api/views/advertising/balance/route.ts` (новый)
- `src/components/advertising/balance/BalancePage.tsx` (новый)

Plan:

- [x] `wbApi.getBalance()` → `{ realMoney, bonus: { sum, percent, expiresAt } }` — `src/lib/wb-api/ads-balance.ts:getAdBalance`
- [x] `wbApi.getSpendHistory(days)` → история расходов — `getAdSpendHistory`
- [x] `wbApi.depositBudget(campaignId, amountRub)` → пополнение — `depositAdBudget`
- [x] Фоновый sync баланса каждые 30 мин — `src/server/jobs/advertising-balance-sync.ts` (cron `*/30`)
- [x] Автопополнение: баланс < порога → пополнить; cooldown 6ч + daily cap 10 000 ₽ — `src/server/advertising/balance.ts:executeAutoRefill`
- [x] UI: карточки real/bonus, прогноз «хватит на N дн.» (`forecastDaysLeft`), график расходов 30д, форма пополнения, настройки автопополнения — `BalancePage.tsx`

Checks:

- `npm run build` ✅ (deploy 928e71a)
- Ручная проверка: deferred (нет рекламного кабинета на тестовом тенанте)

---

### P67 · Dayparting UI + аудит-лог + откат действий

Priority: `P2`

Status: `done` (commit 16c5e95, 2026-04-17)

Goal:

- расписание показов по часам суток;
- аудит-лог автодействий с откатом в 1 клик.

Primary files:

- `src/components/advertising/dayparting/DaypartingSchedule.tsx` (новый)
- `src/components/advertising/audit/AuditLog.tsx` (новый)
- `src/db/schema/advertisingDaypartingRules.ts` (новый)

Plan:

**Dayparting:**
- [ ] Схема: `advertisingDaypartingRules` (tenant_id, campaign_id, schedule: `boolean[168]` — 24×7)
- [ ] UI: сетка 7д × 24ч, кликабельные ячейки; шаблоны «Рабочее время», «Вечер + выходные», «Круглосуточно»
- [ ] Cron: каждый час — паузить/возобновлять по расписанию

**Аудит-лог:**
- [ ] Таблица: дата / тип / объект / значение до→после / причина (из P69)
- [ ] Кнопка «Откатить» для bid-изменений → `PATCH /api/advert/v1/bids` с предыдущим значением
- [ ] Фильтр по типу, дате, кампании

Checks:

- `npm run build`
- `npm run lint`

---

### P68 · UX редизайн кабинета — новая структура навигации

Priority: `P2`

Status: `done` ✅ — Slice 1 (foundation) 2026-04-17; Slice 2 (UI редизайн) 2026-04-18 (PR #27, commit `54ab67a`)

Goal:

- переработать навигацию по принципу «максимальная простота»;
- карточки товаров с изображениями артикулов;
- словарь терминов.

New navigation (6 sections):

1. **Сводка** — расходы/выручка/ДРР, светофор, топ-3 рекомендации
2. **Товары** — карточки nmId с картинкой, светофором, метриками, toggle «Автопилот»
3. **Ставки** — углублённый drill-down
4. **Баланс** — из P66
5. **История** — аудит-лог из P67
6. **Настройки** — guardrails, dayparting, target ДРР, kill switch

Plan:

**Slice 1 — foundation (2026-04-17, ✅ done):**
- [x] `src/lib/advertising/terms.ts` — словарь `{ code, label, tooltip, unit? }` на 23 кода (DRR/ACOS/ROAS/CPO/CPC/CTR/CPM/CVR/CR/AOV/BREAKEVEN_CPM/NM_ID/AUTOPILOT/ADVISOR/GUARDRAIL/KILL_SWITCH/LEARNING_PERIOD/COOLDOWN/DAILY_CAP/CLUSTER/DAYPARTING/BOOST/AUTO_REFILL) + `getTerm(code)`
- [x] `calcCampaignStatus({ drrPct, targetDrrPct, orders, spendRub, stockQty }): 'good'|'warning'|'danger'` в `math.ts` + 15 тестов (граничные: нулевой остаток, нулевые заказы при расходе, ratio vs target, эвристика без target)
- [x] Используется уже существующий детерминированный `getWbPhotoUrl(nmId)` из `src/lib/wb-api/wb-photos.ts` — отдельный API-вызов за `photos[0].big` не нужен

**Slice 2 — UI редизайн (2026-04-18 ✅ PR #27):**
- [x] `<ProductCard>`: фото 60×60, название, артикул, светофор ДРР (calcCampaignStatus), расходы/заказы 7д, toggle → nav Автопилот
- [x] Новый layout страницы с 6-секционным меню: Сводка/Товары/Ставки/Баланс/История/Настройки; Ставки имеет sub-nav Кластеры/Управление/Рабочее место
- [x] Заменить сырые термины в UI на `TERMS[code].label` + `tooltip` (AdvertisingOverview: карточки + заголовки таблиц)

Checks:

- Slice 1: `npx vitest run src/lib/advertising/math.test.ts` → 43/43 passed ✅; `npm run build` ✅; `npm run lint` ✅
- Slice 2: `npm run build` + ручная проверка в браузере

---

### P69 · Объяснения к автодействиям (статические шаблоны)

Priority: `P2`

Status: `done` ✅ — 2026-04-17

Goal:

- человекочитаемое «почему» под каждым действием автопилота; без LLM, статические шаблоны.

Primary files:

- `src/lib/advertising/explanations.ts` ✅
- `src/lib/advertising/explanations.test.ts` ✅
- `src/server/jobs/advertising-dayparting-scheduler.ts` — интеграция `explainAction` в `reason` при записи аудита ✅

Шаблоны (`explainAction(action): string`) реализованы:

- `bid_raise`: «Поднял ставку с {oldBid} до {newBid} — кластер «{cluster}» за {days}\u00A0дн. дал CR {crPct} при ДРР {drrPct}, лучше цели на {deltaPct}»
- `bid_lower`: «Снизил ставку с {oldBid} до {newBid} — ДРР {drrPct} превысил цель {targetDrrPct} на протяжении {hours}\u00A0ч»
- `pause_drr`: «Поставил на паузу — ДРР {drrPct} превысил порог {thresholdPct}»
- `pause_stock`: «Поставил на паузу — остатки {stockQty}\u00A0шт. ниже порога {thresholdQty}\u00A0шт.»
- `pause_no_orders`: «Поставил на паузу — потрачено {spentRub} за {hoursWindow|24}\u00A0ч без единого заказа»
- `pause_low_cr`: «Поставил на паузу — конверсия {crPct} ниже {thresholdPct} за {daysWindow|7}\u00A0дн.»
- `dayparting_pause`: «Выключил по расписанию — ночные часы ({hour}:00)»
- `dayparting_resume`: «Включил по расписанию — утро ({hour}:00)»
- `cap_reached`: «Остановил все кампании — достигнут дневной лимит {capRub}»
- `kill_switch`: «Все кампании остановлены — сработал общий kill switch автопилота»
- `advisor_suggestion`: «Предлагаю поднять ставку до {proposedBid} — {reason}. Нажмите «Применить»»
- `manual`: «Ручное действие» (+ note если задано)

Plan:

- [x] Реализовать `explainAction` с шаблонами (12 типов действий, типизированный union `ExplainableAction`)
- [x] Подключить в аудит-лог: UI `AuditLog.tsx` уже рендерит `entry.reason` (ничего не меняется); писатели `writeAuditEntry` в `advertising-dayparting-scheduler.ts` теперь передают `explainAction(...)` в `reason` (было жёстко зашитой строкой)
- [x] Unit-тесты для каждого шаблона — 16 тестов (включая граничные: некорректный час 25/-1, пустой `manual.note`, кастомные окна `hoursWindow`/`daysWindow`)
- [ ] Подключить в TG-алерты — отложено в P70

Checks:

- `npx vitest run src/lib/advertising/explanations.test.ts` → 16/16 passed ✅
- `npm run build` → ok ✅
- `npm run lint` → ok ✅

---

### P70 · Telegram-алерты рекламных событий

Priority: `P2`

Status: `done` ✅ — 2026-04-17 (foundation: 5 типов + throttle + формат + sender). UI-toggle настроек вынесен в follow-up.

Goal:

- уведомлять в Telegram о ключевых событиях автопилота без захода в кабинет.

Primary files:

- `src/lib/advertising/notifications.ts` ✅ — форматтер + in-memory throttle
- `src/lib/advertising/notifications.test.ts` ✅ — 16 тестов
- `src/server/advertising/send-alert.ts` ✅ — `sendAdAlert(tenantId, payload)` (bot init check, throttle check, tenant lookup, grammy `bot.api.sendMessage`)

Типы алертов (реализованы с throttle):

- `auto_pause` → немедленно (throttle 0)
- `daily_cap_reached` → немедленно (throttle 0)
- `balance_low` → 1 раз в 6ч
- `advisor_daily_digest` → 1 раз в день (24ч)
- `learning_period_ended` → эффективно one-shot (365 дн.)

Plan:

- [x] `sendAdAlert(tenantId, payload): Promise<SendAdAlertResult>` с throttle по (tenantId, type), discriminated union `AdAlertPayload`
- [x] Формат: эмодзи + описание (для `auto_pause` через P69 `explainAction`) + ссылка на раздел кабинета (`APP_BASE_URL/advertising`)
- [x] Переиспользован существующий `grammy` bot из `src/server/bot/service.ts`
- [x] Throttle in-memory (Map по `tenantId:type`), `__resetThrottleForTests()` для unit-тестов
- [ ] Настройка в «Настройки»: toggle по типу алерта — **отложено** (требует новой колонки в tenants + UI секции; в текущем v1 алерты отправляются всегда при наличии `telegramChatId`)

Интеграция:

- [x] `src/server/advertising/balance.ts` — `syncAdvertisingBalance` вызывает `sendAdAlert({ type: 'balance_low', currentRub, thresholdRub, daysLeft: null })` при `balance.realMoney <= settings.thresholdRub`; ошибка отправки логируется и не ломает sync (fire-and-forget через `void ... .catch()`). Throttle 6ч предотвращает спам — алерт приходит максимум раз в 6ч пока баланс ниже порога.
- [x] `src/server/advertising/workspace.ts` — в strategy-level guardrail-блоке `executeStrategyRun`: `sendAdAlert({ type: 'auto_pause', action, campaignName: strategy.name, campaignId: strategy.advertId })` с throttle subkey `${strategy.id}-${trigger}` и окном 1ч. Алертим для `kill_switch`, `low_stock`, `high_drr`, `spend_no_orders`, `low_cr`; пропускаем `learning_period`, `cooldown`, `daily_cap` (у него свой тип алерта), `max_bid_delta`, `max_bid` (cluster-level).
- [x] `src/server/advertising/guardrail-to-alert.ts` — чистый маппер `mapGuardrailToAutoPauseAction(trigger, ctx, config): AutoPauseAction | null`, 12 unit-тестов.
- [x] Throttle в `src/lib/advertising/notifications.ts` расширен: `shouldThrottle`/`markAlertSent` принимают `ThrottleOptions { subkey?, windowMs? }`; subkey изолирует бакеты в рамках типа (например, per-strategy+trigger для auto_pause).

- [x] `src/server/advertising/workspace.ts` — при `trigger === 'daily_cap'` и `dailySpendCapRub !== null` отправляется `sendAdAlert({ type: 'daily_cap_reached', capRub, spentRub: spendTodayRubTotal, campaignsPaused: 1 })` с throttle subkey `${strategy.id}-daily_cap` и окном 6ч. Это замещает маршрут через auto_pause, который для этого триггера возвращал `null` в mapper'е.
- [x] `learning_period_ended` в `executeStrategyRun` — детект транзиции: `wasInLearning = isInLearningPeriod(effectiveStartedAt, learnDays, strategy.lastRunAt)` И `!isInLearningPeriod(effectiveStartedAt, learnDays, new Date())`. Миграция не требуется — используется существующая `strategy.lastRunAt` как маркер прошлого состояния. Throttle default 365д + subkey `${strategy.id}` защищает от повторов даже при рестарте.

- [x] `advisor_daily_digest` — Inngest-cron `advertisingAdvisorDigestJob` (ID `advertising-advisor-digest`, дефолт `0 9 * * *`, настраивается через `AD_ADVISOR_DIGEST_CRON`). Агрегирует `advertising_bid_changes` (source='auto') за последние 24ч per-tenant, группирует по nmId, ранжирует по суммарному числу изменений, формирует reason вида «3 примен., 2 предлож.» через `buildSuggestionReason`. Алерт не шлётся если за 24ч не было записей или у тенанта нет `telegramChatId`. Код: `src/server/advertising/advisor-digest.ts` + `src/server/jobs/advertising-advisor-digest.ts`. Тесты: 7 для `buildSuggestionReason` (все комбинации статусов applied/preview/failed + граничные).

Все 5 типов P70-алертов теперь интегрированы в реальные писатели.

Checks:

- `npx vitest run src/lib/advertising/notifications.test.ts` → 16/16 passed ✅
- `npx vitest run src/lib/advertising/` → 117/117 passed (math 43 + guardrails 42 + explanations 16 + notifications 16) ✅
- `npm run build` ✅
- `npm run lint` ✅

---

## Advertising Redesign Track — Wave 2 «Автопилот ставок 2.0» (планирование)

> Добавлено 2026-04-19. Wave 1 полностью закрыт (P63-P70), ставки управляются guardrails + ручной стратегией. Wave 2 — переход к обучающемуся автопилоту и A/B-тестированию.

### P71 · BidWorkspaceContext — устранение props-drilling

Priority: `P3`

Status: `done` (2026-04-19, commit `ea57cba`). BidWorkspaceContext создан, BidsTab/Ads2Tab/StrategiesTab: 37/27/37 props → 0. Build ✅, tests 328/328 ✅.

Goal:

- убрать 20-37 props из каждого sub-tab компонента (`BidsTab`/`StrategiesTab` и т.д.);
- собрать shared state/queries в `React.createContext` + custom hooks (`useBidWorkspace()`, `useStrategiesState()`).

Primary file:

- `src/components/advertising/workspace/AdvertisingBidWorkspace.tsx` (1606 LOC, после P63.1)
- `src/components/advertising/workspace/context/BidWorkspaceContext.tsx` (новый)

Acceptance criteria:

- props у каждого tab-компонента ≤5 (или 0 — только `<StrategiesTab />` без props);
- tests 301/301 ✓, build ✓;
- nothing regresses в browser smoke (визуальная проверка всех 8 табов).

Открытые вопросы:

- Разделять ли context на несколько (BidsContext/StrategiesContext/PacingContext) или один mega-context? → рекомендация: несколько, по scope использования каждого tab'а.

---

### P72 · ML/feedback-loop для автопилота ставок (self-learning)

Priority: `P1`

Status: `in-progress` — декомпозировано на P72a/b/c/d (2026-04-19); open questions закрыты в design doc.

Design doc: [docs/advertising/BANDIT_AUTOPILOT_DESIGN.md](advertising/BANDIT_AUTOPILOT_DESIGN.md).

Goal:

- стратегия автопилота сама корректирует ставки по историческим результатам (CTR × CR × средний чек × маржа / ДРР) без ручных правил guardrails;
- Bayesian Thompson Sampling или LinUCB для контекстных bandits.

Acceptance criteria:

- автопилот-стратегия показывает рост ROAS на ≥10% за 2 недели эксплуатации vs. baseline guardrails;
- UI объясняет каждое изменение («экспериментальная ставка 35₽ с вероятностью оптимальной 62%»);
- автопилот не делает >10% BID-дельты за сессию, не ломает guardrails из P65.

Подслайсы:

#### P72a · Bandit math foundation

Priority: `P1` · Status: `done` · 2026-04-19

- `src/lib/advertising/bandits/prng.ts` — mulberry32 + Normal/Gamma/Beta samplers.
- `src/lib/advertising/bandits/thompson.ts` — Beta-Bernoulli и Normal-Normal posterior, arg-max, Monte-Carlo `P(arm is best)`, Welford-обновления.
- 28 unit-тестов: determinism, dispersion, convergence, bounds, uniformity.
- `docs/advertising/BANDIT_AUTOPILOT_DESIGN.md` — архитектурное решение, закрытые open questions, migration strategy для P72b.
- Без изменений БД, без правок `workspace.ts` — additive-only.

#### P72b · Integration с workspace.ts и shadow-mode

Priority: `P1` · Status: `done` · 2026-04-19

- `StrategyAutopilotConfig` расширен полями `policy` (`epsilon_greedy` | `thompson_beta` | `thompson_normal`, default `epsilon_greedy`) и `rewardKind` (`position_hit` | `economic_delta`, default `position_hit`) — полная backcompat-совместимость с legacy summary.
- `StrategyLearningState.bandit?` — опциональный posterior (Beta или Normal) с детерминированной сериализацией/десериализацией в `readLearningStateFromSummary`.
- `src/lib/advertising/bandits/integration.ts` — pick/reward/update helpers, детерминированный seed через salt `'bandit'` (независим от epsilon-greedy seed).
- `executeStrategyRun` (workspace.ts): shadow-mode — `pickBanditShadow` считается параллельно с `pickSelfLearningTarget`, применяется всё равно epsilon-greedy. Posterior обновляется для **реально отработавшего arm'а** (learningTarget), а не того, что выбрал bandit — честное обучение на наблюдённых данных. Обновление только при `runStatus ∈ {applied, skipped}` (guardrail-suppressed не обновляет).
- `summary.banditShadow` логирует `{ policy, pickedKey, appliedKey, matchedApplied, samples, rewardKind, observedAcosPct }` — основа для будущего dashboard.
- `banditStateBefore` пересоздаётся при смене policy/rewardKind (migration-safe).
- 29 новых unit-тестов: determinism, config validation, reward math, posterior updates, shadowDelta, round-trip сериализация.

#### P72c · BanditInsights UI + LinUCB (contextual)

Priority: `P2` · Status: `done` · 2026-04-21

- `src/lib/advertising/bandits/linucb.ts` — disjoint LinUCB (d=4, α=1.0): `createLinUCBArm`, `linUCBScore`, `pickLinUCB`, `updateLinUCBArm`, `buildLinUCBFeatures`. LINUCB_MIN_OBSERVATIONS=500.
- `src/lib/advertising/bandits/linucb.test.ts` — 11 unit-тестов.
- `src/components/advertising/autopilot/BanditInsights.tsx` — `'use client'` компонент: probabilityArmIsBest Monte-Carlo (2000 it.), таблица arm/E[reward]/P(best)/obs, shadow delta, бейдж «LinUCB доступен» при ≥500 набл.

#### P72d · A/B split-тесты (объединяется с P74)

Priority: `P2` · Status: `done` · 2026-04-21

- `src/lib/advertising/bandits/ab-compare.ts` — `computeABConfidence` (Monte-Carlo, AB_CONFIDENCE_THRESHOLD=0.95, AB_MIN_OBSERVATIONS=50).
- `src/lib/advertising/bandits/ab-compare.test.ts` — 8 unit-тестов.
- `src/lib/advertising/notifications.ts` — добавлен тип `ab_test_won`.
- `src/server/advertising/bandit-winner.ts` — `checkBanditWinner` (pure), `notifyBanditWinner` (Telegram, throttle 7d per strategyId), `strategyIdToSeed`.
- `src/server/advertising/workspace.ts` — интеграция: auto-winner check + policy switch + fire-and-forget alert.

---

### P73 · Hybrid CPM + ROAS-based bidding modes

Priority: `P2`

Status: `done` · 2026-04-21

- `src/lib/advertising/bidding/strategies.ts` — чистые функции `computeBidPressure` для 4 режимов (drr/cpm/roas/hybrid), `computeCpm`, `roasFromDrrPct`, `normalizeBiddingMode`, `normalizeTargets`.
- `src/lib/advertising/bidding/strategies.test.ts` — 25 unit-тестов.
- `drizzle/0048_advertising_strategy_modes.sql` — колонки `bidding_mode`, `target_cpm_rub`, `target_roas` (default `drr`/200/4 + CHECK).
- `schema.ts` + `workspace.ts` — поля проброшены в record/input/validation/engine. В classic-adjuster заменён жёсткий DRR-check на mode-aware `computeBidPressure`; magnitude масштабирует stepUp/stepDown.
- `StrategiesTab.tsx` — селектор режима + условные поля Target CPM / Target ROAS.
- 432/432 tests ✓, typecheck ✓, build ✓.

Goal:

- стратегия может преследовать несколько метрик: `target_cpm`, `target_roas`, `target_drr`, hybrid-score;
- адаптивный расчёт ставки в зависимости от текущей позиции, конверсии, маржи.

Primary files:

- `src/lib/advertising/bidding/strategies.ts` (новый)
- `src/server/advertising/workspace.ts` — добавить `strategy.mode` = `cpm|roas|drr|hybrid`
- `drizzle/NNNN_advertising_strategy_modes.sql`

Acceptance criteria:

- 4 режима с unit-tests расчётов;
- UI переключения режима в StrategiesTab;
- migration path для существующих стратегий (default=`drr`).

---

### P74 · A/B split тесты ставок per SKU

Priority: `P2`

Status: `todo`

Goal:

- стратегия может запустить A/B-тест (50/50 split по времени дня или случайный) двух ставок на одном SKU;
- автоматический статистический анализ (Bayesian confidence) и auto-winner selection.

Primary files:

- `src/server/advertising/ab-tests.ts` (новый)
- `drizzle/NNNN_advertising_ab_tests.sql` — таблица `advertising_ab_tests`
- `src/components/advertising/workspace/tabs/AbTestsTab.tsx` (новый 9-й sub-tab)

Acceptance criteria:

- minimum sample size детектор;
- early-stopping на confidence ≥95%;
- Telegram-алерт `ab_test_won` с разницей ROAS/ДРР.

---

## Advertising Redesign Track — Wave 2.5 «Минимальный автопилот»

Design doc: [docs/advertising/ADVERTISING_AUTOPILOT_MINIMAL_UX.md](advertising/ADVERTISING_AUTOPILOT_MINIMAL_UX.md).

Цель: сделать первый экран рекламы операционным центром `Что делать сейчас`, где сложная рекламная логика сворачивается в 3-5 понятных действий, а advanced-режим остаётся доступным отдельно.

### P92 · Group-aware advertising attribution

Priority: `P1`

Status: `done` — 2026-05-12

Goal:

- считать рекламную эффективность по склейке, если рекламируемый `nmId` входит в `product_group_members`;
- не резать рабочую рекламу, когда расход идёт на один SKU, а продажи уходят в другой SKU той же склейки.

Acceptance:

- `getAdvertisingOverview` считает revenue/sales по всей склейке;
- рекламный расход по склейке суммируется по рекламируемым SKU внутри группы;
- UI показывает, что решение принято по склейке;
- action items используют group-level ДРР;
- одиночные SKU сохраняют прежний fallback.

Result:

- `getAdvertisingOverview` перешёл на scope-level CTE: одиночный SKU остаётся `sku:*`, артикул в `product_group_members` агрегируется до group scope;
- top rows, action items и карточки товаров получили `attributionScope`, `groupId`, `groupName`, `groupNmCount`;
- `Сводка` и `Товары` показывают бейдж `Склейка`, если ДРР считается по группе.

Checks:

- `npx vitest run src/server/analytics/advertising-decision-center.test.ts`
- targeted `npx eslint ...`
- `npm run typecheck`
- `npm run build`

### P93 · Advertising Decision Center API

Priority: `P1`

Status: `foundation done` — 2026-05-12

Goal:

- добавить `/api/views/advertising/decision-center`;
- возвращать 3-5 action cards: `Срочно остановить`, `Снизить ставку`, `Поднять ставку`, `Проверить товар`, `Все спокойно`;
- у каждой карточки: причина, деньги, риск, apply/dry-run payload.

Result:

- добавлен pure builder `buildAdvertisingDecisionCards(...)`;
- добавлен endpoint `/api/views/advertising/decision-center`;
- v1 карточки возвращают reason, money, risk и action target (`confirm_cleanup`, `open_bids`, `open_products`, `none`);
- apply/dry-run payload для `Срочно остановить` закрыт в P94; ставки остаются follow-up.

### P94 · Advisor confirmation flow

Priority: `P1`

Status: `done` — 2026-05-12

Goal:

- кнопка подтверждения применяет безопасное рекламное действие через существующий `advertising_action`;
- каждое действие проходит guardrails, audit log и Operations.

Result:

- добавлен endpoint `/api/views/advertising/decision-center/action`;
- для `Срочно остановить` реализован двухшаговый flow: dry-run → `Подтвердить`;
- для `Снизить ставку` и `Поднять ставку` реализован двухшаговый flow через `ad_bid_update` (`-10%` / `+10%`);
- apply использует `executeProcifryAdvertisingAction` с `actionType=ad_bulk_cluster_cleanup` или `ad_bid_update`;
- UI показывает queued/applied/failed summary прямо на карточке.
- после apply карточка ведёт оператора прямо в `Операции`;
- карточка хранит последнее dry-run/apply действие в локальной UI-памяти по кабинету.

### P95 · Minimal advertising first screen

Priority: `P1`

Status: `foundation done` — 2026-05-12

Goal:

- сделать `Что делать сейчас` первым экраном `/advertising`;
- advanced-разделы оставить вторым уровнем без удаления текущих инструментов.

Result:

- добавлен компонент `DecisionCenter`;
- `Сводка` теперь начинается с блока `Что делать сейчас`;
- кнопки v1 ведут в релевантный advanced-раздел, а `Срочно остановить` поддерживает dry-run/apply.
- перегруженный `AdvertisingOverview` скрыт за кнопкой `Подробная аналитика`, чтобы первый экран не превращался в dashboard для аналитика.

### P96 · Autopilot mode switch

Priority: `P2`

Status: `foundation done` — 2026-05-12

Goal:

- режимы `Советник`, `Полуавтомат`, `Автопилот`;
- лимиты, risk tiers, dry-run, audit, rollback.

Result:

- первый экран получил selector `Советник / Полуавтомат / Автопилот`;
- выбранный режим сохраняется по кабинету в `tenants.advertising_autopilot_mode`;
- добавлен endpoint `/api/views/advertising/settings`;
- scheduled auto-bidder применяет ставки только в режиме `Автопилот`;
- `Советник` и `Полуавтомат` принудительно пишут preview/audit без WB-мутаций, даже если конкретная стратегия не dry-run.
- dayparting pause/resume в режиме `Советник` стал read-only; расписание применяет WB-мутации только в `Полуавтомат` и `Автопилот`.

### P97 · Product check: creative, SEO, price, competitors

Priority: `P2`

Status: `done` — 2026-05-12

Goal:

- карточка `Проверить товар` должна объяснять, что проблема не в ставке: CTR, SEO, цена, фото, отзывы, остатки, конкуренты.

Result:

- `AdvertisingSkuRow` теперь содержит `productCheck` со статусом, причинами и коротким чек-листом проверки;
- v1 использует доступные рекламные сигналы: низкий CTR, клики без заказов, расход без выручки, высокий ДРР, дорогой CPC и склейку;
- подключены фактические источники `raw_api_stocks`, `raw_api_prices`, `raw_api_product_metadata`, `procifry_search_positions`, `procifry_competitor_cards`;
- `ProductCard` показывает компактный блок `Проверить товар` с первой причиной и тегами;
- `Decision Center` подтягивает reason из `productCheck` для карточки `Проверить товар`;
- стабильный служебный action item переведён в код `stable`, чтобы не создавать ложную карточку `Проверить товар`.
- `productCheck` получил структурированные `reasonCodes` и `checks`;
- причины разнесены на `stock`, `card_content`, `seo`, `price`, `competitor`, `semantic`, `bid_economics`, `traffic_quality`, `group_attribution`;
- `Decision Center`, `ProductCard` и подробная сводка показывают человекочитаемый тип причины.

### P98 · Advertising heatmap

Priority: `P2`

Status: `foundation done` — 2026-05-12

Goal:

- тепловая карта день/час для автоматического включения, выключения и снижения ставок.

Result:

- первый экран получил компактную heatmap `Когда реклама работает`;
- добавлен накопитель `advertising_hourly_stats` и миграция `0078_advertising_hourly_stats`;
- добавлен hourly sync job `advertising-hourly-stats-sync`, который каждый час снимает WB `adv/v3/fullstats` и сохраняет только положительную дельту часа;
- добавлен endpoint `/api/views/advertising/heatmap`;
- UI показывает 7×24 hourly matrix при наличии hourly-данных и дневной fallback, если накопитель ещё пуст.

Known limitation:

- первый снимок дня используется как baseline и не засчитывается в текущий час;
- для качественных dayparting-решений нужно накопить достаточно hourly-истории.

### P99 · Profit-aware advertising decisions

Priority: `P1`

Status: `done` — 2026-05-12

Goal:

- принимать решения по рекламе не только по ДРР/выручке, а по чистой прибыли после рекламы и прибыли до рекламы по SKU или всей склейке.

Result:

- `getAdvertisingOverview` добавил financial layer поверх рекламных scope: final PnL из `mv_daily_pnl_final` и provisional sales tail после последней реализации;
- daily/top SKU/summary возвращают `netProfit`, `netProfitBeforeAds`, `profitMarginPct`, `adSpendToProfitBeforeAdsPct`;
- Decision Center останавливает рекламу при отрицательной ЧП после рекламы;
- Decision Center снижает ставку, если реклама забирает 60%+ прибыли до рекламы;
- рост ставки разрешён только при положительной ЧП, нормальной марже и умеренной доле рекламы в прибыли.

### P100 · Background Decision Autopilot

Priority: `P1`

Status: `done` — 2026-05-13

Goal:

- фоновые карточки `Что делать сейчас` должны выполняться автоматически по режиму кабинета, без отдельного ручного клика, но через существующий безопасный `advertising_action` контур.

Result:

- ручной endpoint `/api/views/advertising/decision-center/action` переведён на общий service `decision-actions`;
- добавлен service `decision-autopilot` и Inngest job `advertising-decision-autopilot`;
- `advisor` остаётся read-only;
- `semi_auto` автоматически применяет только `Снизить ставку`, а `Срочно остановить`/`Поднять ставку` оставляет как dry-run;
- `auto` делает dry-run→apply для `Срочно остановить`, `Снизить ставку`, `Поднять ставку`, причём raise применяется только low-risk;
- `AD_DECISION_AUTOPILOT_COOLDOWN_HOURS` защищает от повторного применения одной и той же карточки чаще 6 часов;
- все действия пишутся в `procifry_agent_audit_log` с source `advertising-decision-autopilot`.

### P101 · Heatmap-driven dayparting rules

Priority: `P2`

Status: `done` — 2026-05-13

Goal:

- превратить накопленную 7×24 heatmap в готовое расписание включения/выключения рекламы;
- оставить неизвестные часы включенными, чтобы автопилот не выключал рекламу без достаточной истории;
- применять правило через существующий dayparting/audit контур.

Result:

- добавлен builder `buildHeatmapDaypartingRecommendation(...)` и loader `getHeatmapDaypartingRecommendation(...)`;
- правило отключает слоты только при значимом плохом сигнале: расход без выручки, расход без заказов или высокий ДРР;
- дневной fallback возвращает `insufficient_data` и не даёт сохранить hourly-расписание;
- добавлен endpoint `/api/views/advertising/heatmap/dayparting`: `GET` отдаёт рекомендацию, `POST` сохраняет правило для выбранной кампании;
- сохранение использует `upsertDaypartingRule(...)` и пишет audit action `dayparting_rule`;
- UI расписания получил heatmap-блок с действиями `Подставить` и `Сохранить heatmap`;
- журнал аудита показывает новые записи как `Правило расписания`.

Known limitation:

- точная campaign/SKU heatmap появится после накопления новых hourly-строк; старая история до P102 остаётся tenant-level.

### P102 · Campaign/SKU/group hourly attribution

Priority: `P1`

Status: `done` — 2026-05-13

Goal:

- хранить hourly рекламу в разрезе кампании и SKU;
- строить heatmap/dayparting по выбранной кампании, SKU или всей склейке;
- не использовать tenant-level fallback как будто это точная кампания.

Result:

- миграция `0079_advertising_hourly_campaign_scope` добавляет `advert_id` в `advertising_hourly_stats`;
- unique key hourly-накопителя расширен до `tenant + advert_id + nm_id + stat_hour + source`;
- `wbApi.getAdSpend(...)` получил режим `groupBy=advert_nm_date`;
- hourly sync сохраняет новые дельты с `advert_id`;
- `getAdvertisingHeatmap(...)` принимает `advertId`/`nmId`, а для `nmId` расширяет scope до склейки через `product_group_members`;
- scoped heatmap без hourly-истории возвращает пустой `daily` fallback, чтобы не подменять кампанию общей статистикой кабинета;
- dayparting recommendation и API используют campaign/SKU/group scope;
- UI расписания получил опциональное поле `nmID / склейка`.

Checks:

- `npx vitest run src/server/advertising/dayparting-recommendation.test.ts src/server/advertising/hourly-stats.test.ts src/lib/wb-api/index.test.ts`
- targeted `npx eslint ...`
- `npm run typecheck`
- `npm run build`

---

## Advertising Redesign Track — Wave 3 «Креативы и контент» (планирование)

> Добавлено 2026-04-19. Расширяет P44 content-risk signals в сторону автодействий и A/B.

### P75 · Content-quality scoring + автодействия

Priority: `P2`

Status: `todo`

Goal:

- скоринг каждой карточки 0-100 по факторам (фото count, видео, характеристики, длина заголовка/описания, SEO-ключи) с весами;
- автоматические тикеты «обновить фото» когда score < threshold;
- dashboard с рейтингом карточек.

### P76 · A/B тесты креативов (фото/заголовки/описания)

Priority: `P3`

Status: `todo`

Goal:

- обёртка над WB API для переключения контента + measurement периода;
- framework для 30-дневных A/B с CTR/CR/ROAS metrics.

---

## Analytics Track — Wave 2 «Сравнительная аналитика» (планирование)

### P77 · Competitor benchmark per категория/nmId

Priority: `P2`

Status: `todo`

Goal:

- подтянуть публичную аналитику WB (OpenAPI parsers или MPStats/ApiSbor) по top-N SKU в категории каждого nmId;
- показывать «ваши цены на 12% выше среднего», «ваша конверсия в сегменте 20-35%»;
- использовать в сигналах `conversion_drop` и `price_risk`.

Primary files:

- `src/lib/wb-benchmarks/` (новый)
- `drizzle/NNNN_competitor_benchmarks.sql` — snapshot таблица

Открытые вопросы:

- Источник данных: парсинг публичного WB (LGAL-грей зона) vs. платная API MPStats vs. Marketguru?
- Частота обновления (ежедневно / еженедельно)?

### P78 · Trend-detection сигналы

Priority: `P2`

Status: `todo`

Goal:

- новый signal-type `trend_anomaly`: детект неожиданных падений/скачков через rolling-window z-score;
- unsupervised anomaly detection для revenue/orders/ad_spend per SKU.

---

## Tech Debt Track — Engine.ts Decomposition Wave 2 (планирование)

> После Slices 1-5 (8047→5418 LOC, -33%) дальнейшая декомпозиция упирается в cross-method `this.*` рефы.

### P79 · SignalCoreService extraction

Priority: `P3`

Status: `done` — Slice 6, branch `claude/slice-6-signal-core-service`, 2026-04-19

Goal:

- вынести signal core методы (getActiveSignals, recordSignalTimelineEvent, recordSignalView, getSignalTimeline, getSignalWorkflowMembers, getLatestSignalEscalations, getSignalDetails, assignSignalOwner, updateSignalWorkflowState, addSignalNote, updateSignalStatus) в `services/signal-core.ts`;
- ~1500 LOC из engine.ts.

Блокер:

- методы используются из SLA execution cluster (P81). Нужно сначала стабилизировать API signal core, потом вынести SLA execution с импортом.

### P80 · EconomicsService extraction

Priority: `P3`

Status: `done` · PR [#46](https://github.com/viteab-source/enterprise-wb-analytics/pull/46) · `e5965b4` · 2026-04-19

Goal:

- вынести getDailyPnL, getUnitEconomics, getNetProfitBreakdown, getOrderHighlights, getKpis, getDashboardDataTrust в `services/economics.ts`;
- ~2500 LOC, самая крупная группа. Не содержит cross-class `this.*`, экстракция чистая.

Actual reduction: engine.ts 4522 → 2016 LOC (−2506 LOC, −75% от исходного 8047).

### P81 · SignalSlaExecutionService extraction

Priority: `P3`

Status: `todo` — блокируется P79

Goal:

- вынести SLA execution cluster (previewSignalSlaAutomation, runSignalSlaAutomation, runSignalSlaPendingFollowUp, runSignalSlaPendingFollowUpSweep, setSignalAutomationSuppression, clearSignalAutomationSuppression, captureSignalFollowUpResolution) в `services/signal-sla-execution.ts`;
- ~1500 LOC. Требует P79, потому что ссылается на signal core методы.

### P82 · SignalsFeedService + bulk ops

Priority: `P3`

Status: `todo` — блокируется P79

Goal:

- вынести getSignalsFeed, bulkAssignSignalOwner, bulkUpdateSignalWorkflowState, bulkAddSignalNote, bulkApplySignalHandoffPreset, bulkUpdateSignalStatus, dispatchSignalCollaborationNotification в `services/signals-feed.ts`;
- ~600 LOC.

---

---

## UnitEconomicsTemplateTable Decomposition Track

### P87 · Stocks 2.0 — раздел «Остатки» переписываем с нуля

Priority: `P3`

Status: `done` — все 8 этапов · 2026-05-06

Goal:

- Текущий `/stocks` (1041 строка `StocksPageClient` + ~2000 строк
  `getStocksPlanner`) перегружен (13 колонок, два таба, нет цены закупки в
  плане, плоский safety stock, нет UI для уже существующих в БД
  `production_orders`). Пользователь сказал: «должен разобраться школьник»,
  старая вкладка не нужна, делаю с чистого листа.
- Архитектура — три слоя данных: WB склады (из `warehouse_remains` P86),
  свой склад (новые таблицы `own_stock_batches` + `own_stock_movements`,
  партии с историей), партии в пути из Китая (расширили `production_orders`
  на header + многострочные `production_order_lines`).
- 4 экрана: Дашборд / Партии / Свой склад / По складам heatmap.

Decisions:

- Один свой склад (фулфилмент) — multi-location откладываем.
- Партии = мульти-SKU контейнер.
- Старый `StocksPageClient` и `getStocksPlanner` удаляем в Этапе 6.
- `stock_planning_inputs` пуста в проде → можно безопасно убрать в Этапе 6.

Implementation stages:

- [x] **Этап 0** (2026-05-06) — миграции БД. `production_orders`: убраны
  per-SKU поля (nmId/quantity/costPerUnit/totalCost), добавлены `title`,
  `currency`, `shippingCost`, `customsCost` на header. Новая таблица
  `production_order_lines` (одна строка = один SKU в партии, с
  `receivedQuantity` для partial receipts). Новые `own_stock_batches`
  (партия товара на собственном складе, immutable `receivedQuantity` +
  decreasing `remainingQuantity`) и `own_stock_movements` (журнал движений
  с reason: receipt/shipped_to_wb/fbs_sale/write_off/inventory_adjust).
  Миграции `0061_production_orders_multi_sku.sql`,
  `0062_own_stock_batches.sql`. Legacy `createProductionOrder` action
  адаптирован под header+lines (для совместимости пока не удалили
  старый UI). `tsc` ✅, `build` ✅, vitest 506/506 ✅.
- [x] **Этап 1** (2026-05-06) — backend `stocks-v2` готов. Pure-функции
  forecasting (`computeEwma`, `computeStdDev`, `computeSafetyStock`,
  `computeRop`, `computeDaysLeft`, `computeStockStatus`,
  `computeRecommendQuantity`, `classifyAbc`, `getZScoreForAbc`) — 35 тестов
  на ступени, граничные кейсы, top-1 always A. Главный сервис
  `getStocksV2(tenantId, opts)` пуллит 8 параллельных query (products /
  raw_api_stocks / own_stock_batches / production_order_lines+orders /
  funnel_stats daily / realization_reports revenue / region_sales /
  funnel_stats localization), считает per-SKU 3-слойный totalAvailable,
  EWMA-демэнд, ABC-категорию, safety stock = Z×σ×√L (Z от ABC), ROP,
  daysLeft, светофор-статус, recommendQty + recommendCost через
  unit_economics_configs.cost_price → manualFields.costPrice fallback.
  KPI агрегат: wbTotal/ownTotal/inProduction/inTransit/urgentBuyTotalRub/
  worstSku/avgLocalizationPercent + счётчики статусов. Region rows
  с demandShare per FD. Новый route `/api/views/stocks-v2`. Старая
  страница `/stocks` пока работает на старом stack.
- [x] **Этап 2** (2026-05-06) — Дашборд `/stocks-v2`. Новый роут с
  pageClient + sidebar entry «Остатки 2» (зелёный, рядом со старым
  «Остатки»). 5 KPI tiles (WB / свой / в производстве / в пути /
  локализация с расчётом «дней хватит» по weighted-avg демэнду),
  «🔴 Срочно — закончится скоро» секция с топ-8 critical SKU
  (фото, артикул, остаток, спрос/день, recommendQty + recommendCost
  через JOIN cost_price), сводная строка `N SKU · X шт · Y ₽`,
  3 status counters (warning / ok / overstock), regions strip с
  bar-визуализацией доли спроса по FD, footer «худший SKU». Кнопка
  «Создать партию» disabled до Этапа 3. Старая `/stocks` страница
  параллельно живёт.
- [x] **Этап 3** (2026-05-06) — Партии. Новый роут
  `/stocks-v2/batches` + 5 server actions: `listBatches`,
  `createBatch` (multi-SKU header + lines, валидация qty>0, nmId>0),
  `updateBatchStatus` (lifecycle ordered → in_production → shipped →
  customs → delivered с авто-таймстемпами), `deleteBatch`
  (запрещено для delivered), `listSkusForBatchForm` для select-комбобокса.
  При переходе в `delivered` автоматически: помечает все lines как
  `receivedQuantity = quantity`, создаёт `own_stock_batches` для
  каждого SKU с pro-rata распределением shipping/customs costs на
  per-unit cost, и пишет audit-trail в `own_stock_movements` (reason=
  `receipt`). UI: cards с timeline-визуализацией (5 шагов), inline
  форма создания с multi-SKU автокомплитом по vendorCode/brand/nmId,
  per-line qty + cost, итог партии с распределением по доставке/таможне.
  Кнопка из дашборда «Создать партию» теперь ссылка на этот раздел.
- [x] **Этап 4** (2026-05-06) — Свой склад. Новый роут
  `/stocks-v2/own-stock` + 5 server actions: `listOwnStock` (партии
  on-hand сгруппированные по SKU, JOIN с products), `listOwnStockMovements`
  (журнал, последние N), `createManualReceipt` (ручной приход без
  production_order), `consumeOwnStock` (FIFO-списание с reason'ами:
  shipped_to_wb / fbs_sale / write_off, валидация totalAvailable >= qty,
  raises на нехватку), `adjustBatchInventory` (корректировка одной
  партии после инвентаризации, audit запись с reason=inventory_adjust).
  FIFO применяется на уровне `consumeFifo()` helper'а — берёт партии
  отсортированные по `received_at ASC` пока не выберет нужный qty.
  UI: cards SKU с раскрытием на партии, кнопки «Списать» (рассветка
  rose с диалогом куда/сколько/заметки), «Партии» (chevron toggle),
  inline-форма ручного прихода, журнал движений с цветными reason-
  бэйджами. Дашборд получил две ссылки в header («🏪 Свой склад» +
  «🌏 Партии»).
- [x] **Этап 5** (2026-05-06) — Heatmap «По складам». Новый роут
  `/stocks-v2/by-warehouse`. Таблица SKU × физ.склад с цветовой
  подсветкой ячеек на основе «дни запаса в этом конкретном складе»
  (qty / avgDailyDemand): 🔴 красный (0 шт при наличии спроса) /
  🟠 амбер (<7 дн) / 🟢 emerald (7-90 дн) / 🔵 sky (>90 дн = затарка).
  Реактивный фильтр (Все / 🔴 Дефицит / 🔵 Затарка / ⚖ Перекос (max ≥ 5×
  min)) + текстовый поиск по vendorCode/brand/nmId. Sticky левая колонка
  SKU, sticky header, горизонтальный скролл для большого числа складов.
  Виртуальные buckets («В пути до получателей», «Всего на складах»)
  ставятся в конец списка. Дашборд получил третью header-кнопку
  «🗂 По складам».
- [x] **Этап 6** (2026-05-06) — снесли старый стек. Удалены файлы:
  `src/app/(dashboard)/stocks/{page,StocksPageClient,actions}.tsx,ts`
  (1041 + 179 + page = ~1230 строк), `src/app/api/views/stocks/route.ts`,
  `src/server/analytics/stocks.ts` (~2000 строк `getStocksPlanner`).
  В `next.config.ts` добавлен permanent (308) redirect `/stocks` →
  `/stocks-v2` (для закладок). Sidebar collapsed: убран дубль
  «Остатки 2», единственный пункт «Остатки» теперь ведёт на `/stocks-v2`.
  Migration `0063_drop_stock_planning_inputs.sql` дропает
  `stock_planning_inputs` (была пуста в проде). `stockPlanningInputs`
  удалён из `schema.ts`. Inngest job `stock-alerts.ts` адаптирован под
  новые источники: `ownStock` берёт из `own_stock_batches`
  (SUM(remainingQuantity)), `inTransitChina` / `inProductionQty` — из
  `production_order_lines + production_orders` по статусам
  (ordered/in_production → production, shipped/customs → transit).
- [x] **Этап 7** (2026-05-06) — Финальная полировка. **Excel-экспорт
  «Лист закупки»** на дашборде: кнопка «Скачать Excel» (динамический
  импорт ExcelJS, ~150 КБ только когда жмут), генерирует .xlsx с 14
  колонками (артикул WB / артикул продавца / бренд / статус / WB остаток
  / свой склад / в пути / в производстве / спрос/день / дней хватит /
  купить шт / себестоимость / сумма / ABC), сортировка critical first,
  цветная подсветка строк, итоговая строка по срочным SKU. Файл
  `purchase-list_YYYYMMDD_HHMM.xlsx`. **Pure-функции** для overhead
  distribution: `distributeOverheadShare(...)` (pro-rata по goods value
  с fallback на qty share при пустых costs) + `computeLandedCostPerUnit
  (...)` (landed cost per unit). Inline-логика в `updateBatchStatus`
  заменена на эти helper'ы. **10 новых тестов** (общее 551, было 541) —
  edge cases: zero overhead, single line, all-zero costs (fallback на
  qty), negative inputs. **revalidatePath** для `/by-warehouse`
  добавлен во все mutation'ы (createBatch / updateBatchStatus /
  deleteBatch / consumeOwnStock / adjustBatchInventory) — heatmap
  обновляется автоматически при любых изменениях.

Sources / inspiration: InvenTree open-source (purchase order lifecycle +
batch tracking), Cin7 (location × batch tracking), MoySklad WB integration,
NetSuite Demand Planning KPIs (DOS / Turnover / ROP), ISM safety stock
formula `Z × σ × √L`.

---

### P86 · Реальный объём WB в /economics-v2 из warehouse_remains

Priority: `P3`

Status: `done` — 2026-05-06

Goal:

- колонка «Литраж факт. WB» в `/economics-v2` сейчас фолбэчит на габариты
  из карточки (т.к. `warehouse-measurements` endpoint не отдаёт данные для
  части SKU, особенно комбо-упаковок типа «черная/розовая»). Из-за этого
  на скрине пользователя 4 SKU показаны как 0.50 л, тогда как WB начисляет
  по ним хранение/логистику по 1.13–1.17 л;
- WB API `/api/v1/warehouse_remains` (асинхронный отчёт) отдаёт **поле
  `volume`** per nmId — ровно ту цифру, что в Excel-выгрузке из кабинета
  «Аналитика → Отчёт по остаткам». Это и есть авторитетный объём.

Implementation:

- `wb-api/index.ts:getWarehouseRemains(token, { groupByNm })` — три шага:
  GET (create task) → polling status (4s × 30 max) → GET download. Парсит
  `nmId / volume / warehouses[]`.
- `WB_SYNC_SOURCE_SEQUENCE` расширен на `warehouse_remains` (18 источников,
  не 17). Источник попадает в `WB_SYNC_NIGHTLY_SOURCES` автоматически.
- Drizzle schema: `products.wb_warehouse_volume_liters NUMERIC(8,3)` +
  `wb_warehouse_volume_updated_at TIMESTAMPTZ`. Миграция `0059`.
- `inngest/sync-wb.ts`: новый шаг `sync-warehouse-remains` после
  `sync-stocks`. Дёргает `getWarehouseRemains`, обновляет volume в `products`
  по `(tenantId, nmId)`. Если WB API не отвечает — шаг пропускается без
  падения общего sync.
- `/api/views/economics-template`: новый helper `getWbWarehouseVolumeByNm`
  читает `products.wb_warehouse_volume_liters` per nmId. В enriched row
  приоритет: `wbWarehouseVolumeByNm.get(nmId) ?? cardDimensions.wbVolumeLiters
  ?? null`. Старый источник (`warehouse-measurements`) остаётся как
  fallback.
- UI `/economics-v2`: подсветка колонки «Литраж факт. WB» (P81/P83) теперь
  правильно срабатывает для комбо-SKU.

Тесты: `wb-sync-sources.test.ts` обновлён на новое количество источников
(17 → 18) + явный кейс на наличие `warehouse_remains`.

Checks: `tsc --noEmit` ✅, `npm run build` ✅, `vitest` 506/506 ✅.

Возможный follow-up (P87): полный rewrite `/stocks` страницы на этот же
endpoint (сейчас он использует комбинацию 3-х fallback-источников), чтобы
данные на странице 1-в-1 совпадали с кабинетом WB.

---

### P85 · Авто-ИРП в /economics-v2 из WB localizationPercent

Priority: `P3`

Status: `done` — 2026-05-06

Goal:

- избавить пользователя от ручного ввода ИРП % в `/economics-v2` для большинства
  SKU: WB endpoint `/api/analytics/v3/sales-funnel/products` отдаёт
  `statistic.selected.localizationPercent` per nmId; по нему можно
  автоматически рассчитать ИРП по официальной 11-ступенчатой сетке
  (>=60% → 0; <5% → 2.5%);
- ручной ввод остаётся приоритетом (индивидуальные WB-условия);
- если данных от WB ещё нет (новый SKU без funnel sync) — пользователь
  видит подсветку «нет данных WB — введите вручную».

Implementation:

- `WbFunnelItemSchema` (types/wb.ts) и `getNomenclatureReport` (wb-api/index.ts)
  расширены полем `localizationPercent`. Daily-funnel пишет 0 (DETAIL_HISTORY
  это поле не отдаёт).
- Новая колонка `localization_percent NUMERIC(6,2)` в `raw_api_funnel_stats`,
  миграция `0058_funnel_localization_percent.sql`, journal-индекс +1.
- `inngest/sync-wb.ts` пишет/обновляет поле при каждом funnel sync.
- `/api/views/economics-template` JOIN свежий localization per nmId
  (`getLocalizationPercentByNm` — DISTINCT ON по `period_end DESC`),
  отдаёт как `localizationPercent` в каждой строке.
- `economics/constants.ts:resolveIrpFromLocalization` — клиентская копия
  серверной функции `redistribution.ts:resolveKrpByLocalization` (чтобы
  client-bundle не тянул серверный модуль).
- `row-summary.ts`: новые поля RowSummary `irpPercentSource: 'manual'|'auto'|'none'`
  и `localizationPercent: number | null`. Логика: ручной > авто > 0;
  для FBS — всегда 0.
- `WarehousesPanel.tsx`: подпись «авто 2.50% (WB локализация 8%)» в emerald,
  «WB локализация 62%, авто = 0%» в muted при ручном вводе, «нет данных WB
  — введите вручную» в amber для новых SKU. `NumberInput` placeholder также
  показывает auto-значение пока поле пустое.
- 7 новых тестов в `row-summary.test.ts` на ступени локализации, manual
  override, FBS → 0, null vs 0%.

Checks: `tsc --noEmit` ✅, `npm run build` ✅, `vitest` 505/505 ✅.

---

### P83 · Декомпозиция монолита UnitEconomicsTemplateTable

Priority: `P3`

Status: `done` — Slices 0-11 done · 2026-05-06

Goal:

- разбить `UnitEconomicsTemplateTable.tsx` (4 178 строк) на модульные компоненты
  по аналогии с P63/P63.1 (AdvertisingWorkspace/BidWorkspace);
- конечная цель: `/economics-v2` работает на новом модульном стеке, монолит
  остаётся только для `/economics-template` (legacy).

Primary files:

- `src/components/economics/table/` — новый каталог модулей
- `src/app/(dashboard)/economics-v2/EconomicsV2PageClient.tsx`
- `src/components/dashboard/UnitEconomicsTemplateTable.tsx` (источник)

Slices:

- [x] **Slice 0** (2026-05-01, `66ac61c`) — building blocks: `columns.ts`,
  `utils.ts`, `cellValue.ts`, `NumberInput.tsx`, `HiddenProductsPanel.tsx`,
  `TableHeader.tsx`, `index.ts`. `tsc` ✅, tests 491/491 ✅.
- [x] **Slice 1-2** (2026-05-01, `7d8ae80`) — `EconomicsTable.tsx`: 80-column
  read-only table, toolbar, HiddenProductsPanel, tariff maps, manual fields.
  `EconomicsV2PageClient.tsx` переключён на `EconomicsTable`.
  `tsc` ✅, `npm run build` ✅, tests 491/491 ✅.
- [x] **Slice 3** (2026-05-01) — expandable panels: `SkuMetaBlock.tsx`,
  `WarehousesPanel.tsx`, `FinancePanel.tsx` (5 вкладок: fact / costs / price /
  pnl / batch). `EconomicsTable.tsx`: добавлены `detailMode` /
  `activeTab` state, `toggleDetailForRow`, `persistManualFieldsForNm` (debounce
  500 мс → `saveUnitEconomicsManualFields`) и отдельный debounce `costPrice` →
  `updateCostPrice`. Клик «Артикул WB» открывает warehouses, клик «Цена» —
  finance; повторный клик в том же режиме сворачивает. `tsc` ✅,
  `npm run build` ✅, tests 491/491 ✅.
- [x] **Slice 4** (2026-05-04, `9bf04a8`) — паритет с монолитом: глобальная
  скидка WB в toolbar, кнопка «Пересчитать себестоимость», `VariantPickerModal`
  + копирование ручных полей и `costPrice` на варианты модели, Excel-экспорт
  (3 листа через ExcelJS, динамический импорт), сабпанель «WB-тарифы по
  складам» с per-warehouse карточками и сводками. Pure-функция
  `computeWarehouseRates()` в `warehouse-rates.ts`.
- [x] **Slice 5** (2026-05-04, `86fbf00`) — семантические токены темы:
  `bg-white` → `bg-card`, `bg-slate-*` → `bg-muted/*`, `text-slate-*` →
  `text-foreground` / `text-muted-foreground`, `border-slate-*` →
  `border-border`. Убраны gradient-stops `to-white` (давали белые пятна
  в dark). Saturated-бордеры приглушены до `*-500/30`. Backdrop модалки
  переведён на `bg-foreground/30`. `/economics-v2` теперь корректно реагирует
  на app-уровневый theme switcher (next-themes + CSS variables).
- [x] **Slice 6** (2026-05-05, `6e01682`) — UX-полировка тёмной темы:
  manual-инпуты на amber-alpha (`bg-amber-500/15`), активная строка
  `bg-emerald-500/15` + 4 px emerald-полоса слева на photo, detail-панели
  больше не растягиваются по 80 колонок (`sticky left-0` +
  `max-w-[min(1280px,calc(100vw-120px))]`).
- [x] **Slice 7** (2026-05-05, `a3a7eaf`) — inline-инпуты в активной строке
  (cost_price, delivery_to_ff, packaging, fulfillment, buyout, marketing,
  content, other, cpo/cps, purchase_qty, turnover) — как в монолите.
  `HiddenProductsPanel` «Вернуть» убирает SKU из локального списка +
  `router.refresh()`. **Финансовая деталь возвращена к схеме монолита**:
  4 строки сценариев (excellent/good/average/poor) вместо 5-вкладочной
  `FinancePanel`, файл удалён. Pure-компонент `ScenarioRow.tsx`.
- [x] **Slice 8** (2026-05-05, `e5391fa`) — hide-SKU «глазик» в колонке Фото:
  confirmation → `toggleProductVisibility` → SKU исчезает из таблицы.
  Photo-колонка расширена 80 → 100 px.
- [x] **Slice 9** (2026-05-05, `b8f5e8f`) — критфиксы. (1) Manual-сохранения
  больше не теряются при быстром переходе со страницы: на unmount pending
  saves теперь **выполняются** (flush через `queueManualFieldsSave` /
  `persistCostPrice`), а не отменяются. Структура timer-ref переделана на
  `Map<nmId, { timeout, payload }>`. (2) Sticky-колонка Фото `z-40` → `z-20`
  (header) и `z-20` → `z-[5]` (cell), чтобы не перекрывать sidebar.
- [x] **Slice 10** (2026-05-05, `2a2d8d27` + `cc3a28c7`) — критфиксы
  персистентности после фидбэка с продакшна. (1) Soft-navigation в Next.js
  App Router не размонтирует `EconomicsTable` — добавлены listener'ы
  `visibilitychange` + `pagehide`, оба триггерят немедленный flush
  pending-saves. (2) TanStack Query показывал stale-snapshot при возврате
  на страницу, bootstrap затирал свежий localStorage устаревшими
  `manualInputsByNm` — для `useQuery` выставлены `staleTime: 0`,
  `refetchOnMount: 'always'`, `refetchOnWindowFocus: 'always'`.
- [x] **Slice 11** (2026-05-06) — снят монолит. Удалены
  `UnitEconomicsTemplateTable.tsx` (4178 строк), `unit-economics-template-helpers.ts`
  + его vitest-файл (12 групп тестов перенесены в
  `src/components/economics/helpers.test.ts` без изменений сигнатур),
  `EconomicsTemplatePageClient.tsx` и весь каталог
  `src/app/(dashboard)/economics-template/`. В `next.config.ts` добавлен
  permanent (308) redirect `/economics-template` → `/economics-v2` (закладки/SEO).
  `/economics` теперь редиректит сразу на `/economics-v2` (вместо двойного hop
  через `/economics-template`). Sidebar: вместо двух пунктов «Юнит-экономика»
  (`/economics`) и «Юнит-экономика 2» (`/economics-v2`) теперь один пункт
  «Юнит-экономика» → `/economics-v2`. `revalidatePath('/economics-template')`
  заменён на `/economics-v2` в `economics/actions.ts` (3 места) и
  `settings/actions.ts` (1 место). `tsc` ✅, `npm run build` ✅, tests 496/496 ✅.

Checks per slice: `tsc --noEmit` ✅, `npm run test` ✅, визуальная проверка в браузере.

---

## Итоговый прогноз (Wave 2+3 полный объём)

- **Advertising Wave 2**: P71 (~1-2 дня), P72 (~2-3 недели ML-работы), P73 (~1 неделя), P74 (~1-2 недели). Итого: **~1.5-2 месяца**.
- **Advertising Wave 3**: P75 (~1 неделя), P76 (~2 недели). Итого: **~3 недели**.
- **Analytics Wave 2**: P77 (~1 неделя + исследование source), P78 (~1-2 недели). Итого: **~3 недели**.
- **Engine.ts tech debt**: P79-P82 (~1 неделя суммарно). Можно делать инкрементально между product-items.

Приоритет для MVP автопилота 2.0: **P71 → P72 → P73**. P74 (A/B тесты) — follow-up после того как P72 начинает показывать реальный lift.
