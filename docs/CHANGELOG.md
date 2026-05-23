# Changelog

All notable project-management and implementation changes for `enterprise-wb-analytics` should be recorded here.

## 2026-05-23 · Unit Economics cabinet-wide IL/IRP

- Added tenant-level storage for cabinet-wide Unit Economics indices (`tenant_unit_economics_indices`) so ИЛ and ИРП are shared across all SKU rows for the cabinet.
- Changed Unit Economics rows to prefer cabinet-level ИЛ/ИРП over per-SKU localization-derived values; SKU localization remains only as a legacy fallback/diagnostic.
- Added a weekly Monday 10:00 Moscow background job for cabinet index refresh from WB Seller `Поставки и заказы → Тарифы` data (`weekly-rating`): `localization.percent` is cabinet ИЛ and `localization.pricePercent` is cabinet ИРП.
- Added a top-of-page Unit Economics cabinet block that shows the current ИЛ/ИРП source (`WB`, `Вручную`, or `Нет данных`) and lets users set one manual pair for the whole cabinet when WB data is unavailable.
- Manual cabinet ИЛ/ИРП values now apply to every SKU row, while the next successful WB tariff refresh overwrites the manual pair for the same cabinet week.
- Disabled the approximate 13-week per-SKU fallback for cabinet indices: automatic values now come only from exact WB tariff data, while missing values remain neutral/manual instead of being estimated.
- Preserved the rule that ИРП applies only when active ИЛ is greater than 1; ИЛ below 1 still discounts forward logistics.
- Kept the raw ИРП visible in the warehouse panel even when it is not applied by the `ИЛ <= 1` rule; the panel now marks it as `не применяется` while formulas keep the surcharge at 0.
- Refreshed production cabinet indices from WB: ИП Бербека `ИЛ 1.04`, `ИРП 0.83%`; ИП Лавров `ИЛ 1.00`, `ИРП 0.33%` for week `2026-05-18`.

**Checks:** `npm run db:migration:check`, `GIT_PAGER=cat git diff --check`, `npm run test -- src/components/economics/row-summary.test.ts src/components/economics/tariff-helpers.test.ts`, `npm run typecheck`, `npm run db:migrate`, WB LK refresh for ИП Бербека and ИП Лавров.

---

## 2026-05-23 · Unit Economics IRP gating by IL

- Changed Unit Economics logistics so ИРП applies only when the active ИЛ multiplier is greater than 1.
- When ИЛ is 1 or lower, ИРП is forced to 0 while ИЛ still discounts forward logistics when below 1.
- Added a row-summary regression test for `ИЛ 0.83` with manual `ИРП 0.83%` to ensure no ИРП surcharge is charged.
- Updated table and Excel formula help text to describe the ИЛ/ИРП gate.

**Checks:** `GIT_PAGER=cat git diff --check`, `npm run test -- src/components/economics/row-summary.test.ts src/components/economics/tariff-helpers.test.ts`, `npm run typecheck`.

---

## 2026-05-22 · Unit Economics buyout column labels

- Renamed Unit Economics table columns from `Выкуп ручной` to `Ручной % выкупа` and from `Выкуп авто` to `Автоматический % выкупа`.
- Increased the column widths so the new labels fit cleanly in the table header.

**Checks:** `GIT_PAGER=cat git diff --check`, `npm run typecheck`.

---

## 2026-05-22 · Unit Economics auto-buyout 90-day WB base

- Changed Unit Economics auto-buyout facts to use the accumulated WB base for the selected end date with at least a 90-day lookback, instead of only the narrow table date filter.
- Backfilled WB LK per-SKU funnel data for ИП Бербека from 2026-03-01 through 2026-05-22, saving 3092 rows.
- This keeps `Выкуп авто` stable for short table periods: if the 90-day WB base passes 30 days of history, 100 closed outcomes, and max 40% open orders, the auto percentage is shown and used; otherwise the cell stays `—` and manual buyout is used.

**Checks:** `GIT_PAGER=cat git diff --check`, `npm run typecheck`, `npm run test -- src/components/economics/tariff-helpers.test.ts src/components/economics/row-summary.test.ts src/components/economics/table/cellValue.test.ts src/components/economics/helpers.test.ts`, DB check: 36 ИП Лавров and 5 ИП Бербека SKUs pass auto-buyout guardrails on the 90-day WB base; `199980160` resolves to 70.28%.

---

## 2026-05-22 · Unit Economics WB LK buyout fallback

- Added WB LK per-SKU daily funnel data (`raw_api_sales_funnel_nm_daily`) as a fallback source for the Unit Economics auto-buyout facts when the official funnel table is empty.
- Included official/LK funnel dates in SKU activity history so the 30-day auto-buyout guardrail can pass from funnel facts, not only raw orders/sales.
- Kept the display rule: `Выкуп авто` shows a percentage only when the auto-buyout guardrails pass; otherwise it shows `—` and formulas use the manual buyout column.

**Checks:** `GIT_PAGER=cat git diff --check`, `npm run typecheck`, WB LK backfill for ИП Лавров on 2026-05-21..2026-05-22 saved 100 per-SKU rows.

---

## 2026-05-22 · Unit Economics auto-buyout display rule

- Changed the `Выкуп авто` column to show a percentage only when WB auto-buyout is actually applied by the guardrails.
- Rows that have WB buyout facts but fail the auto-buyout rules now show `—` in `Выкуп авто`; calculations continue to use the manual buyout column.
- Updated Excel export and cell-value tests to match the display rule.

**Checks:** `npm run test -- src/components/economics/table/cellValue.test.ts src/components/economics/tariff-helpers.test.ts src/components/economics/row-summary.test.ts src/components/economics/helpers.test.ts`, `GIT_PAGER=cat git diff --check`, `npm run typecheck`.

---

## 2026-05-22 · Unit Economics auto-buyout server guardrail sync

- Synced the server-side analytics auto-buyout history guardrail with the Unit Economics table rule: SKU history >= 30 days and closed WB outcomes >= 100 before WB auto-buyout can be trusted.
- Updated the Excel formula reference so exported Unit Economics docs no longer mention the old >=10 closed-order threshold.

**Checks:** `npm run test -- src/components/economics/tariff-helpers.test.ts src/components/economics/row-summary.test.ts src/components/economics/table/cellValue.test.ts src/components/economics/helpers.test.ts`, `GIT_PAGER=cat git diff --check`, `npm run typecheck`.

---

## 2026-05-22 · Production deploy guardrail for visible changes

- Added `npm run deploy:production:local` as the canonical server-side deploy command: it stops the web service before building, requires a complete `.next/standalone` artifact, prepares runtime assets, starts systemd, and waits for `/api/health` to report ok.
- Updated project agent rules so future changes must be recorded in `docs/CHANGELOG.md` and deployed through the guarded command instead of a manual build/restart sequence.

**Checks:** `bash -n ops/deploy-production-local.sh`, `GIT_PAGER=cat git diff --check`, `npm run typecheck`.

---

## 2026-05-22 · Unit Economics logistics buyout normalization restored

- Restored the Unit Economics `Итоговая логистика с % выкупа` column name and per-buyout logistics formula: `(forward с ИЛ/ИРП + reverse × (1 - выкуп/100)) / (выкуп/100)`.
- Updated the column help text, Excel formula reference, and row-summary tests so the browser build and exports describe the same calculation.

**Checks:** `npm run test -- src/components/economics/tariff-helpers.test.ts src/components/economics/row-summary.test.ts src/components/economics/table/cellValue.test.ts src/components/economics/helpers.test.ts`, `GIT_PAGER=cat git diff --check`, `npm run typecheck`, `npm run build`, `systemctl stop enterprise-wb-analytics.service`, `npm run build`, `ops/prepare-next-standalone.sh`, `systemctl start enterprise-wb-analytics.service`, `/api/health` ok, built `/economics-v2` chunk contains `Итоговая логистика\nс % выкупа`.

---

## 2026-05-22 · Unit Economics auto-buyout confidence threshold

- Raised the Unit Economics auto-buyout guardrail from at least 10 closed WB outcomes to at least 100 closed outcomes while keeping the existing 30-day SKU history and max 40% open-order share checks.
- Updated the `Выкуп авто` column help/formula hints and tests so the UI explains the new confidence threshold consistently.

**Checks:** `npm run test -- src/components/economics/tariff-helpers.test.ts src/components/economics/row-summary.test.ts src/components/economics/table/cellValue.test.ts src/components/economics/helpers.test.ts`, `git diff --check`, `npm run typecheck`, `npm run build`, `systemctl restart enterprise-wb-analytics.service`, `/api/health` ok.

---

## 2026-05-22 · Production boot self-healing

- Removed hard `Requires` chains between web, worker, Inngest, and Supabase
  systemd units so a single early boot dependency failure no longer leaves the
  whole application inactive.
- Made `enterprise-wb-analytics-watchdog.timer` run earlier after boot,
  persist missed runs, and auto-start monitored inactive/failed units in a
  safe order: Postgres/Docker/Supabase first, then web, workers, Inngest, and
  nginx.
- Updated the remote deploy script to install tracked systemd units before
  `daemon-reload`, so boot-hardening changes are applied on every deploy.
- Added retry/cleanup around production `npm ci` to recover from transient
  package download resets without leaving `node_modules` half-installed.
- Documented the boot behavior and added watchdog recovery env flags.

**Checks:** `node --check scripts/ops-watchdog.mjs`,
`bash -n ops/install-on-production.sh scripts/deploy-remote-production.sh`,
`git diff --check`, `npm run lint` (existing warning in
`scripts/backfill_sales_funnel_nm.ts`), GitHub Actions deploy `26300344829`
success, primary/secondary `/api/health` OK, primary watchdog self-heal test
restarted `enterprise-wb-analytics-reviews-worker.service`.

---

## 2026-05-22 · Supabase boot retry for production

- Tracked the production `enterprise-wb-analytics-supabase.service` unit in
  `ops/systemd` and added `Restart=on-failure` with a 15s retry delay so a
  server reboot cannot leave the web app blocked when Supabase containers are
  still warming up.
- Updated the production installer and server topology note to keep this
  systemd behavior reproducible.

**Checks:** production `systemctl show` confirmed the retry drop-in is active;
production `/api/health` returned `ok` after recovery.

---

## 2026-05-22 · Redistribution stock-control API migration

- Switched redistribution HTTP probing and auto-submit to WB's new
  `/stock-control` contour: `transfer/list`, `transfer/AvailableLimits`, and
  `transfer/order`.
- Kept the old `/ns/shifts` probe as a technical fallback only; access errors
  and 429 rate limits stay on the stock-control path so disabled cabinets and
  WB throttling are not hammered by the legacy contour.
- Slot-monitor events now use `stock_control_*` sources for target routes,
  quota snapshots, and matrix scans while still reading old `http_*` events
  for backoff compatibility.

**Checks:** `npm run test -- src/server/redistribution/wb-lk-http.test.ts src/server/jobs/redistribution-slot-monitor.test.ts`,
`npm run typecheck`.

---

## 2026-05-22 · Unit Economics warehouse/logistics display follow-up

- Unit Economics now pre-fills costed SKU warehouse selections from the top WB
  stock warehouses when saved cost fields have no warehouse selection yet, and
  still preserves local unsaved cost drafts instead of overwriting them with a
  stale server payload.
- Changed `Логистика до клиента` to include both ИЛ and ИРП in the displayed
  value; renamed the total column to `Итоговая с % выкупа`.
- Removed the extra buyout formula card and manual ИЛ/ИРП inputs from the
  warehouse detail panel; it now shows compact read-only `ИЛ / ИРП` values.
- `Выкуп авто` now remains visible when WB fact exists but is not used as the
  effective buyout because of the auto-buyout guardrails.

**Checks:** `npm run test -- src/components/economics/row-summary.test.ts src/components/economics/table/cellValue.test.ts 'src/app/(dashboard)/costs/costing-helpers.test.ts'`,
`npm run typecheck`, `npm run lint` (existing warning in
`scripts/backfill_sales_funnel_nm.ts`), `npm run build`, `git diff --check`.

---

## 2026-05-22 · Production deploy serialization

- Added a production deploy lock at
  `/tmp/enterprise-wb-analytics-deploy.lock` so GitHub Actions and manual
  deploys cannot simultaneously modify the same `node_modules`, `.next`, or
  working tree.
- Wrapped GitHub Actions remote deploy commands in the same lock before their
  remote `git reset`, and documented that manual fallback deploys must call
  `scripts/deploy-remote-production.sh` instead of raw `npm ci` / `build`.
- Added a post-`npm ci` Next.js dependency sanity check for
  `node_modules/.bin/next` and `node_modules/next/link.d.ts`.

**Checks:** `bash -n scripts/deploy-remote-production.sh`, workflow YAML
parse check, `node scripts/sync-claude-memory.mjs`, `git diff --check`.

---

## 2026-05-22 · Manual redistribution requests

- Added a manual redistribution request flow on the redistribution page: users
  can enter WB article, size, quantity, source warehouse, and destination
  warehouse even when the route was not recommended by the algorithm.
- Added `/api/views/redistribution/manual-request` to create a
  `manual_custom_ui` run and `planned` queue item for the existing
  slot-monitor/auto-submit pipeline.
- Manual requests are deduplicated against active queued/failed items and
  reject warehouses outside the official WB redistribution list, so users get
  an explicit error instead of a silent queue item that cannot be processed.

**Checks:** `npm run test -- src/server/redistribution/manual-request.test.ts src/server/jobs/redistribution-slot-monitor.test.ts src/server/redistribution/wb-lk-http.test.ts src/server/redistribution/route-scan.test.ts`,
`npm run typecheck`, `git diff --check`, `npm run build`.

---

## 2026-05-22 · Unit Economics logistics column labels

- Renamed Unit Economics logistics columns to make the calculation meaning
  explicit: `Логистика до клиента с ИЛ`, `Хранение за ед среднее / день`, and
  `Итог логистики с % выкупа и ИРП`.
- Updated matching tooltips and Excel formula hints.

**Checks:** `npm run typecheck`, `npm run build`, `git diff --check`.

---

## 2026-05-22 · Unit Economics ИЛ coefficient formula

- Corrected Unit Economics WB logistics to treat ИЛ as the WB coefficient
  `0.5..2.0`, not as a percent delta. The active formula is now:
  `(first-liter + extra-liters) × warehouse logistics coefficient × ИЛ
  + priceBeforeWbDiscount × ИРП`.
- Kept backward compatibility for legacy saved ИЛ values: values above `2`
  are interpreted as the old percent-delta input and normalized to a WB
  coefficient.
- Updated `/costs`, `/economics-v2`, approval UI, tooltips, and tests so ИЛ
  is displayed as a coefficient while ИРП remains a percent of price.
- Fixed localization source selection for Unit Economics and Dynamics: daily
  funnel rows are excluded so legacy `0%` DETAIL_HISTORY rows cannot override
  the aggregate WB localization value used for ИЛ/ИРП fallback.

**Checks:** `npm run test -- src/components/economics/row-summary.test.ts src/components/economics/tariff-helpers.test.ts src/components/economics/table/cellValue.test.ts src/app/(dashboard)/costs/costing-helpers.test.ts src/server/agent/procifry-unit-economics-indices.test.ts`,
`npm run typecheck`, `npm run lint` (existing warning in
`scripts/backfill_sales_funnel_nm.ts`), `npm run build`, `git diff --check`.

---

## 2026-05-22 · Dual production deploy guardrails

- Added one-way dual production deploy: approved `origin/main` now deploys to
  Metric Pulse and the secondary `rmp_gemmini` server through GitHub Actions.
- Added a remote deploy script that hard-resets production clones to
  `origin/main`, disables production push-url, builds, migrates, restarts
  configured services, and waits for `/api/health`.
- Documented the rule that secondary-server work must come back only through
  review/merge, never by direct server-to-primary sync.

**Checks:** `node scripts/sync-claude-memory.mjs`, `git diff --check`.

---

## 2026-05-22 · Next build proxy trace workaround

- Replaced `src/proxy.ts` with supported `src/middleware.ts` to avoid a Next
  16 standalone build failure where webpack generated `middleware.js.nft.json`
  while the build finalizer expected `proxy.js.nft.json`.

**Checks:** `git diff --check`.

---

## 2026-05-22 · Unit Economics WB logistics correction

- Removed the extra low-buyout penalty and repeated forward leg from Unit
  Economics marketplace logistics.
- Unit Economics now uses the WB 2026-03-20 reverse rule directly:
  `forward + (1 - buyout) × reverse + ИРП`, where reverse is based only on
  volume and does not use warehouse coefficients, ИЛ, or ИРП.
- Updated the warehouse panel and column tooltip so the displayed formula
  matches the calculation.

**Checks:** `npm run test -- row-summary tariff-helpers costing-helpers cellValue`,
`npm run typecheck`, `npm run build`, `git diff --check`.

---

## 2026-05-22 · Costs WB warehouses and localization indices

- Connected WB warehouse tariff maps to `/costs` so the cost screen calculates
  WB logistics/storage with the same tariff data as Unit Economics.
- Added per-SKU top WB warehouse suggestions by positive stock to `/costs`;
  Unit Economics keeps reading the saved cost inputs and does not auto-pick
  warehouses itself.
- Auto-derived both ИЛ and ИРП from WB `localizationPercent`, with manual
  inputs kept as overrides.

**Checks:** `npm run test -- row-summary tariff-helpers`, `npm run build`,
`git diff --check`.
## 2026-05-22 · Redistribution monitor backoff split

- Split redistribution slot-monitor cooldowns: target auto-submit now reacts
  only to target-route `429`, while route-matrix intelligence has its own
  `429` cooldown and no longer blocks automatic WB order creation.
- Reduced default matrix pressure: aggressive windows run target checks only,
  while background matrix sampling defaults to 1 SKU and 50 routes unless
  overridden by env.
- Added a long stop condition for cabinets where WB returns `401/403` from the
  redistribution contour: the monitor records that redistribution is disabled
  or unavailable for the cabinet and stops probing instead of retrying every
  minute.

**Checks:** `npm run test -- src/server/jobs/redistribution-slot-monitor.test.ts src/server/redistribution/wb-lk-http.test.ts src/server/redistribution/route-scan.test.ts`,
`npm run typecheck`, `git diff --check`, `npm run build`.

---

## 2026-05-21 · Unit economics WB reverse logistics

- Fixed Unit Economics buyer reverse logistics after the WB 2026-03-20 tariff
  change: reverse delivery now uses only the parcel volume base, without
  warehouse coefficient, ИЛ/КТР, or ИРП/КРП.
- Kept forward delivery unchanged: warehouse coefficient and ИЛ still apply,
  while ИРП remains a separate price-based surcharge.
- Removed seller return tariff from the warehouse panel because it is not part
  of Unit Economics marketplace logistics and should not be mixed with buyer
  reverse delivery.
- Added regression tests for sub-1L WB tier handling and >1L reverse delivery.

**Checks:** `npm run test -- src/components/economics/row-summary.test.ts src/components/economics/tariff-helpers.test.ts`,
`npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`.

---

## 2026-05-21 · Dynamics logistics forecast from WB fixation

- Added RAW realization fields for WB logistics fixation: office, fixation
  period, paid-delivery flag, and fixed warehouse coefficient.
- Changed Dynamics operational logistics from "all orders × tariff" to
  `orders × expected buyout percent × actual WB delivery average`.
- Added rate priority for Dynamics logistics: stock-weighted active fixation,
  active SKU fixation, same-day WB fact, SKU history, group history,
  stock-weighted tariff fallback, then old tariff fallback.
- Aligned Dynamics tariff fallback with Unit Economics WB rules: sub-1L items
  use WB tier bases 23/26/29/30/32 with warehouse coefficient, >1L items use
  WB box base/liter, and localization/КРП are included when WB localization is
  available.
- Added `Логистика / выкуп` to separate the WB delivery rate from the
  buyout-adjusted `Логистика / заказ`.
- Updated Dynamics metric help text so `Логистика / заказ` is shown as a
  buyout-adjusted operational forecast, not factual PnL logistics.

**Checks:** `npm run db:migration:check`, `npm run typecheck`,
`npm run test -- src/lib/wb-api/index.test.ts`, `npm run lint`,
`npm run test`, `git diff --check`, `npm run build`.

---

## 2026-05-20 · Redistribution route-matrix slot monitoring

- Added observation-only route-matrix monitoring for redistribution slots: the
  WB LK HTTP monitor now samples SKUs with stock, checks official WB
  source/destination warehouses returned by `/stocks`, and writes
  `http_slot_matrix_monitor` events for route-level availability.
- Kept auto-submit scoped to recommended redistribution items only; matrix
  events are historical signal for slot-opening patterns and do not create WB
  orders or overwrite recommendation gating.
- Added matrix monitor env caps:
  `REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_NM_PER_TENANT` and
  `REDISTRIBUTION_SLOT_MONITOR_MATRIX_MAX_ROUTES_PER_TENANT`.
- Added scheduler backoff after WB LK `HTTP 429` so aggressive monitoring does
  not keep hammering the rate limit; manual UI runs remain available.

**Checks:** `npm run typecheck`,
`npm run test -- src/server/redistribution/wb-lk-http.test.ts src/server/redistribution/route-scan.test.ts src/server/jobs/redistribution-slot-monitor.test.ts`,
`git diff --check`, `npm run build`.

---

## 2026-05-20 · Redistribution execution journal

- Added `/api/views/redistribution/execution-log` to expose recent
  redistribution item statuses, slot-monitor runs, and WB slot attempt events.
- Added a compact redistribution UI block with submitted, queued, and waiting
  counts; recent attempts and reasons such as zero quota, unavailable route,
  missing source warehouse, or WB `429` are now hidden behind a journal toggle.
- Added a manual `Создать в WB сейчас` action that runs the same HTTP
  slot-monitor/auto-submit contour as the redistribution worker and refreshes
  the journal.
- Removed the old on-page help and advanced HTTP probe panels from the
  redistribution screen to reduce duplicate operational text.
- Updated the official redistribution warehouse filter with `Новосибирск` and
  `Екатеринбург Испытателей 14г`, keeping non-official warehouses such as
  `Воронеж WB` excluded from recommendations.

**Checks:** `npm run typecheck`,
`npx vitest run src/server/redistribution/route-scan.test.ts src/server/redistribution/wb-lk-http.test.ts src/server/jobs/redistribution-slot-monitor.test.ts`,
`npm run lint`, `npm run build`, `npm run test`.

---

## 2026-05-20 · Telegram bot webhook responsiveness

- Changed `/api/bot` to acknowledge Telegram webhooks immediately and process
  heavy report commands in the background, preventing Telegram timeout retries
  from dropping bot answers as duplicate updates.
- Removed remaining English product-facing fragments from bot reports such as
  `SKU`, `persisted snapshot`, `live API` and `offset`.
- Stopped broadcasting internal Inngest failures without `tenantId` to all
  tenant chats; Telegram alerts are sanitized, while detailed failures remain
  in server logs.

**Checks:** targeted bot/dedup tests, targeted `npx eslint`,
`npx tsc --noEmit --pretty false`, `npm run build`.

---

## 2026-05-19 · Production Next standalone build guard

- Forced production builds through webpack instead of the Next 16 default path
  and disabled the webpack build worker to keep `.next/standalone` generation
  deterministic on the production server.

**Checks:** `npx tsc --noEmit --pretty false`, `npm run build`.

---

## 2026-05-19 · Telegram bot Russian menu UX

- Replaced user-facing Telegram bot onboarding/help text with Russian product
  copy and removed English slash-command lists from bot replies.
- Added a persistent Russian Telegram keyboard for common actions: summary,
  sync status, reviews, unit economics, stocks, ads, support and help.
- Added Russian text-command fallbacks such as `Сводка`, `Отзывы`,
  `Остатки 12345678`, `Реклама 12345678`, `Юнит 12345678` and
  `Поддержка ...`.

**Checks:** targeted bot tests, targeted `npx eslint`, `npx tsc --noEmit --pretty false`,
`npm run build`.

---

## 2026-05-19 · Telegram webhook runtime hotfix

- Initialized the grammY bot before handling webhook updates in `/api/bot`.
- Documented the production grant for `telegram_processed_updates`; the grant is
  applied operationally because the app migrator role cannot grant privileges on
  this legacy table.

**Checks:** `npm run db:migration:check`, targeted `npx eslint`,
`npm run test -- src/server/bot/agent-commands.test.ts src/lib/telegram-link-token.test.ts`,
`npx tsc --noEmit --pretty false`, `npm run build`.

---

## 2026-05-19 · Split domain workers for Inngest jobs

- Split Inngest job registration into sync/core, redistribution, advertising,
  and reviews/questions groups with dedicated API endpoints under
  `/api/inngest/*`.
- Added separate production worker app services and Inngest runtimes for sync,
  redistribution, advertising/bidder, and reviews/questions so high-frequency
  slot monitoring or bidding cannot block the main web process.
- Updated production systemd install, postdeploy checks, watchdog defaults,
  network hardening ports, and ops docs for the split-worker topology.

**Checks:** targeted `npx eslint`, `npx tsc --noEmit --pretty false`,
`npm run test -- src/server/jobs/redistribution-slot-monitor.test.ts src/server/jobs/redistribution-route-scan.test.ts src/server/jobs/advertising-auto-bidder.test.ts src/server/jobs/advertising-decision-autopilot.test.ts src/server/jobs/advertising-balance-sync.test.ts src/server/jobs/reviews-qa-auto-reply.test.ts src/server/jobs/wb-sync-sources.test.ts src/server/jobs/sync-runtime.test.ts`,
`npm run build`, `git diff --check`.

---

## 2026-05-19 · Redistribution HTTP auto-submit monitor

- Switched slot monitor from Playwright probing to HTTP WB LK probing with
  auto-submit through `/ns/shifts/analytics-back/api/v1/order` when quotas,
  stock, `chrtID`, source and destination are valid.
- Slot monitor now scans pending redistribution items directly and updates item
  statuses after HTTP submit/probe, so already prepared requests keep retrying
  until they are submitted or blocked by WB.
- Added quota observation logging for all WB `src/dst` warehouses returned by
  `/stocks`, written as `http_quota_monitor` events for hour-by-hour limit
  analysis.
- Added official WB redistribution warehouse filtering; warehouses absent from
  the official list, including `Воронеж`, are excluded from new
  recommendations.
- Slot monitor now deduplicates old pending items by route/product/size and
  skips non-official source/destination warehouses before auto-submit attempts.
- Quota monitoring now records per-warehouse transient quota errors instead of
  dropping the full observation batch when WB returns a temporary 429.

**Checks:** `npm run test -- src/server/redistribution/wb-lk-http.test.ts src/server/redistribution/route-scan.test.ts src/server/jobs/redistribution-slot-monitor.test.ts`,
targeted `npx eslint`, `npx tsc --noEmit --pretty false`, `npm run build`.

---

## 2026-05-19 · Redistribution slot monitor windows

- Confirmed with live WB `/stocks` that `Сарапул` is present, but
  `198753748 / 40-41` is not available as source stock there; the failed row is
  caused by missing `Воронеж` source in current WB `src` warehouses.
- Added multi-window aggressive slot monitoring in MSK:
  `08:40-10:30`, `11:55-12:20`, `15:55-16:20`, `17:55-18:20`.
- Documented external slot timing sources and GitHub search result in
  `docs/research/wb-api-redistribution.md`.

**Checks:** `npm run test -- src/server/jobs/redistribution-slot-monitor.test.ts src/server/redistribution/wb-lk-http.test.ts`,
targeted `npx eslint`.

---

## 2026-05-19 · Telegram bot safety baseline and product plan

- Added `docs/TELEGRAM_BOT_PRODUCT_PLAN.md` with external-practice notes,
  scaling assumptions for 300-500 users, security model, MVP commands and
  roadmap.
- Added canonical `telegram_chat_links` schema/migration with RLS, active
  `chat_id` uniqueness and safe backfill from non-ambiguous legacy
  `tenants.telegram_chat_id` values.
- Added one-time `telegram_link_tokens` deep-link binding: Settings creates a
  short-lived token, `/start <token>` consumes it in a private chat, stores the
  active link and marks the token as used.
- Added read-only bot commands `/stock <nmId>`, `/ads <nmId> [days]`,
  `/reviews [limit]` and `/support <text>` with tenant-scoped report builders.
- Updated Telegram report commands to allow cabinet data only in private chats
  by default; group report commands require explicit
  `TELEGRAM_ALLOW_GROUP_REPORT_COMMANDS=true`.
- Updated bot help text, Settings UI, `.env.example`, README, Agent API docs
  and backlog references.

**Checks:** `npm run test -- src/server/bot/agent-commands.test.ts src/lib/telegram-link-token.test.ts`,
`npm run db:migration:check`, targeted `npx eslint`,
`npx tsc --noEmit --pretty false`, `git diff --check`, `npm run build`.

---

## 2026-05-19 · Redistribution HTTP slot probe

- Reverse-engineered WB redistribution modal endpoints: `nms`, `stocks`,
  `quota?type=src|dst`, and submit candidate `/api/v1/order`.
- Added safe HTTP slot probing for `/redistribution`: the app checks quotas
  for the top plan routes and updates route availability without creating WB
  orders.
- Added `POST /api/views/redistribution/http-slot-probe` and the advanced UI
  button «HTTP-проверка слотов по плану».
- Fixed `scripts/inspect-wb-api.ts` env loading by importing DB/encryption
  modules after `.env` is loaded.

**Checks:** `npm run test -- src/server/redistribution/wb-lk-http.test.ts src/server/redistribution/http-readiness.test.ts src/server/wb/lk-refresh-flow.test.ts`,
targeted `npx eslint`. Full `npx tsc --noEmit --pretty false` is currently
blocked by unrelated Ozon WIP errors in `src/components/ozon/OzonFinanceClient.tsx`
and `src/server/ozon/sync.ts`.

---

## 2026-05-19 · Redistribution HTTP readiness gate

- Updated `REDISTRIBUTION_REWRITE_PLAN.md`: the current HTTP path is based on
  WB LK `storageState -> auth/token -> wb-seller-lk`, not on legacy
  `WBTokenV3`.
- Added `POST /api/views/redistribution/http-readiness` and
  `src/server/redistribution/http-readiness.ts` to classify the WB LK HTTP
  contour as `ready`, `needs_login`, `warning` or `blocked`.
- Wired the check into `/redistribution` under the advanced section so an
  operator can verify HTTP readiness after logging into WB LK.

**Checks:** `npm run test -- src/server/redistribution/http-readiness.test.ts src/server/wb/lk-refresh-flow.test.ts`,
targeted `npx eslint`, `npx tsc --noEmit --pretty false`,
`git diff --check`, `npm run build`. Local direct readiness check returned
`needs_login` because the local cabinet has no saved WB LK `storageState`.

---

## 2026-05-18 · Advertising terminal actionable signal drilldown

- Made campaign signals actionable: clicking `Можно усилить`, `Стоп-расход`,
  `Запросы в минус`, `Бюджет низкий` and other badges opens the Actions panel
  for that campaign.
- Added a signal explanation block with evidence metrics and concrete
  recommendations, including quick jumps to Queries and Positions.
- Clarified scale-up logic in the UI: `Можно усилить` now explains ROAS,
  orders, position and budget constraints before suggesting a dry-run bid test.

**Checks:** targeted `npx eslint`, `npx tsc --noEmit --pretty false`,
`npm run build`.

---

## 2026-05-18 · Advertising terminal operator presets and position drill-down

- Added Bider-plus terminal presets: management, analytics and full dense mode,
  with a sticky campaign column so rows stay readable while scanning wide KPI
  columns.
- Added row-level action signals for active/paused campaigns: stop-spend,
  negative query traffic, lower bid, low budget and scale-up opportunities.
- Extended campaign detail with a dedicated Positions tab, delayed day-history
  tooltip and query click-to-order conversion in both table and tooltip views.

**Checks:** targeted `npx eslint`, `npx tsc --noEmit --pretty false`.

---

## 2026-05-18 · Advertising terminal budget, positions and data confidence layer

- Added the next Bider-style terminal layer: account balance snapshot, loaded
  campaign budgets, WB position aggregates, query/cluster conversion facts and
  row-level data completeness scoring.
- Added a read-only WB Advertising budget helper for `/adv/v1/budget?id=...`
  with throttling so the terminal can enrich top campaigns without blocking the
  whole table indefinitely.
- Corrected the WB advertising balance mapping: `balance` is the Promotion
  account amount, while `net` is the WB mutual-settlement limit; terminal
  balance cache now refreshes after 5 minutes.

**Checks:** targeted `npx eslint`, `npx tsc --noEmit --pretty false`,
targeted `npm test`, `npm run build`.

---

## 2026-05-18 · Bider-style dense advertising terminal metrics

- Expanded campaign terminal rows with Bider-style dense metrics: campaign
  type/payment/bid mode, active days, placement zones, current WB bids,
  CTR with views/clicks, spend with CPC/CPM, today/yesterday spend, funnel
  open-card/cart metrics, cart/order conversion, CPO, ROAS and DRR/revenue.
- Enriched `/api/views/advertising/decision-center` campaign payload with
  per-campaign active days, last data timestamp, daily deltas, funnel totals
  and live WB campaign bid metadata from Advertising API details.

**Checks:** targeted `npx eslint`, `npx tsc --noEmit --pretty false`,
`npm run build`.

---

## 2026-05-18 · Dashboard chart tooltip and previous-period line

- Restored dashboard chart hover details with an explicit pointer tooltip:
  nearest day, vertical guide, current value, previous-period value and optional
  context series.
- Added a previous-period daily chart series to `/api/views/dashboard`; it uses
  the same previous-period resolver as KPI deltas, so arbitrary ranges compare
  with the immediately preceding equal-length period, not a fixed week.
- Wired the comparison series into all overview dashboard variants.

**Checks:** targeted `npm run lint`, `npm run typecheck`, `npm run lint`,
`npm run test`, `npm run db:migration:check`, `git diff --check`,
`npm run build`.

---

## 2026-05-18 · WB LK redirect-safe phone entry

- Made interactive WB LK login tolerate saved-session redirects to
  `seller.wildberries.ru`: if WB opens the cabinet while the phone field is
  still being prepared, the flow now treats that as progress instead of failing
  on a detached DOM node.
- Replaced the initial phone-field click with focus/JS-clear/typed input so
  Playwright does not depend on pointer actionability during WB navigation.
- Login success now requires the LK refresh-flow to pass `auth/token` and a
  real read-only probe; stale cookies no longer mark the WB LK session healthy.

**Checks:** targeted `npx eslint`,
`npm run test -- src/lib/wb-rpa/auth-channel.test.ts src/lib/wb-rpa/token-v3.test.ts src/server/wb/lk-refresh-flow.test.ts`,
`npx tsc --noEmit --pretty false`, `npm run build`.

---

## 2026-05-18 · WB supplies journal and ads sync hotfix

- Made `/stocks-v2/wb-supplies` tolerant to invalid/null date and numeric
  values so the write-off journal renders instead of throwing `RangeError`.
- Fixed `/stocks-v2/own-stock` and `/stocks-v2/china-stock` server-rendering by
  removing a problematic imported type re-export from the `use server` stocks
  actions module.
- Fixed ads sync cleanup after `history_upd`: raw SQL now passes period bounds
  as ISO strings with explicit `timestamptz` casts, avoiding the Drizzle
  `Date` parameter failure that marked usable sync as partially failed.

**Checks:** `npm run typecheck -- --pretty false`, targeted `npx eslint`,
`npm run build`.

---

## 2026-05-18 · WB LK login reuses saved device session

- Interactive WB LK phone/SMS login now starts Chromium with the tenant's
  saved encrypted `storageState` when present, so repeated login attempts keep
  the same WB browser/device context (`wbx-refresh`, device and seller cookies)
  instead of starting from a clean anti-bot-prone browser.
- The auth dialog logs when a saved WB session is loaded before requesting the
  phone/SMS flow.

**Checks:** targeted `npx eslint`,
`npm run test -- src/lib/wb-rpa/auth-channel.test.ts src/lib/wb-rpa/token-v3.test.ts src/server/wb/lk-refresh-flow.test.ts`,
`npx tsc --noEmit --pretty false`, `npm run build`.

---

## 2026-05-18 · Procifry draft SKU fulfillment

- Added `procifry_draft_skus` for new supplier products that are already
  ordered/in production/in transit but do not yet have a WB `nmId`.
- `fulfillment_stock_update` now accepts `productionOrders.lines` without
  `nmId` when `isNewProduct=true` and a draft/external/supplier key is present.
- Approval apply creates/reuses draft SKU, writes production/own-stock rows on
  `draftSkuId`, and keeps repeat invoices idempotent by `sourceKey`.
- `stocks_summary`, `fulfillment_summary`, catalog and `/approvals` now expose
  `isNewProduct`, `draftSkuId`, `linkedNmId`, `externalSkuKey`,
  `supplierArticle`.
- Added UI/API flow to link `draftSkuId -> nmId`; it updates production lines,
  own-stock batches and own-stock movements.

**Checks:** `npm run db:migration:check`, `npx tsc --noEmit --pretty false`,
targeted `npx eslint`, `npx vitest run src/server/agent/procifry-fulfillment.test.ts`,
`npm run build`.

---

## 2026-05-18 · WB supply auto write-off

- Added FBW Supplies API client methods for supply list, supply details and
  goods lines, with request pacing for the new WB endpoints.
- Added `wb_supply_writeoffs` as an idempotent ledger for automatic own-stock
  write-offs by WB supply line.
- Added nightly Inngest job `wb-supply-writeoffs-nightly`: it scans only
  accepted WB FBW supplies, skips virtual/planned supplies, writes off own
  stock via FIFO, then compares declared quantity against WB accepted quantity.
- Discrepancy alerts now account for later WB additional acceptance: if
  `acceptedQuantity` changes, the stored difference is recalculated and a new
  Telegram alert is sent only when the difference changes or closes.
- Added `/stocks-v2/wb-supplies` as the operator journal for processed WB
  supplies, write-off statuses and discrepancies, with a manual “run now”
  reconciliation button for initial backfill.
- Moved shared own-stock FIFO consumption into
  `src/server/analytics/stocks-v2/own-stock-ledger.ts` so UI actions and
  automation use the same stock movement path.
- Documented `WB_SUPPLY_WRITEOFF_CRON` and
  `WB_SUPPLY_WRITEOFF_LOOKBACK_DAYS`.

**Checks:** `npm run db:migration:check`, targeted `npx eslint`,
`npm run typecheck -- --pretty false`,
`npm run test -- src/server/analytics/stocks-v2/forecasting.test.ts`,
`git diff --check`, `npm run build`.

---

## 2026-05-18 · Advertising terminal UX hotfix

- Stopped loading the heavy aggregate advertising overview while `Терминал` is
  in campaign mode, so old overview timeouts no longer appear over campaign
  query details.
- Added a draggable horizontal splitter between the campaign list and the lower
  detail panel; operators can keep only a compact set of campaign rows visible.
- Delayed query-history hover popovers by 3 seconds to avoid covering the table
  during normal pointer movement.

**Checks:** `npm run typecheck`, targeted `npx eslint`, `git diff --check`,
`npm run build`.

---

## 2026-05-18 · WB LK auth verification correction

- Rechecked saved WB LK sessions against the current `auth/token` endpoint:
  saved `wbx-validation-key` + `wbx-refresh` cookies are present, but direct
  HTTP token exchange returns `401`, so they must not be shown as fully ready
  LK-backed HTTP read.
- Downgraded modern-cookie LK auth and `LK-backed read` source health from
  optimistic `healthy` to `warning` until the refresh-flow is implemented and
  verified.

**Checks:** targeted `npx eslint`, `git diff --check`, `npm run typecheck`.

---

## 2026-05-18 · Advertising terminal campaign drilldown

- Added focused campaign drilldown endpoint
  `/api/views/advertising/terminal-detail` with daily campaign facts from
  `advertising_hourly_stats` and query/cluster history from
  `raw_api_ad_clusters`.
- Wired `Терминал` campaign selection to a Bider-style lower panel:
  `По дням` now shows the selected campaign by date, `Запросы` shows clusters
  with per-day hover history.
- Made active/pause campaign state more visible with a colored row accent,
  dot and status badge.

**Checks:** `npm run typecheck`, targeted `npx eslint`, `git diff --check`,
`npm run build`.

---

## 2026-05-18 · Advertising terminal source/status hotfix

- Fixed `Терминал` active/pause filters by loading WB campaign metadata only
  for campaigns present in the current terminal snapshot, instead of walking
  the whole archived advertising cabinet before reaching live campaigns.
- Updated source health to detect current WB LK auth cookies
  (`wbx-validation-key` + `wbx-refresh`) when `WBTokenV3` is no longer issued
  by WB.

**Checks:** `npm run typecheck`, targeted `npx eslint`, `git diff --check`,
`npm run build`.

---

## 2026-05-18 · WB source health contour

- Added a read-only `/api/views/advertising/source-health` endpoint that
  exposes one sanitized source-health contract per tenant: WB API token, WB LK
  session, WB LK auth, Advertising API, Content API and LK-backed read
  readiness.
- Wired the advertising terminal header to show source health before extending
  campaign/card snapshots with LK-backed data.
- Kept tokens, cookies and storage-state payloads server-only; UI receives only
  statuses, timestamps and operator-safe messages.
- Added the Bider data-source research note as the rationale for the next
  snapshot layers.

**Checks:** `npm run typecheck`, targeted `npx eslint`, `git diff --check`,
`npm run build`.

---

## 2026-05-18 · Advertising terminal active and pause filters

- Enriched `Терминал` campaign rows with live WB advertising campaign
  metadata: status, type, payment type and placements.
- Replaced the campaign-mode filter set with operator filters:
  `Все`, `Активные`, `На паузе`, `Проблема`, `Внимание`.
- Updated campaign counters, table status badges and detail panels to show the
  actual WB campaign state instead of auto-strategy state.

**Checks:** `npm run typecheck`, targeted `npx eslint`, `git diff --check`,
`npm run test`, `npm run build`.

---

## 2026-05-18 · Expense deduction reason drilldown

- Fixed the fast profit report payload for the expenses modal: WB deduction
  rows are now returned in `deductionDetails` instead of an always-empty array.
- Reused the existing WB deduction classifiers for PnL expense, credit
  principal, credit interest and WB promotion, so the modal can split
  report-level vs SKU-level deductions and show `bonus_type_name` reasons.

**Checks:** `npm run lint -- src/server/analytics/services/finance-breakdown-fast.ts`,
`npm run typecheck`, `npm run db:migration:check`, `npm run test`,
`git diff --check`, `npm run build`. Local DB smoke was blocked by local
Postgres `ECONNREFUSED`.

---

## 2026-05-18 · Advertising terminal full campaign source

- Fixed the advertising `Терминал` campaign mode source: campaign rows now come
  from the factual `Decision Center` campaign snapshot over
  `advertising_hourly_stats`, not from the auto-strategy workspace.
- Auto-strategies are now used only as enrichment for state, dry-run, bid
  limits and recent changes, so campaigns without configured strategies are
  still visible in the master table.
- Updated campaign-mode metrics, filters and detail panel to use campaign-level
  spend, revenue, orders, CTR, CPC and DRR.

**Checks:** `npm run typecheck`, targeted `npx eslint`, `git diff --check`,
`npm run test`, `npm run build`.

---

## 2026-05-18 · Dynamics audit fixes (DYN-1, DYN-2)

- Fixed `/dynamics` ad attribution inflation (`DYN-1`) in
  [src/server/analytics/engine.ts](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/server/analytics/engine.ts):
  - split ad costs into raw rows, spend aggregation, and attributed-order aggregation;
  - for attributed ad turnover now use deduped per-day/per-SKU value (`MAX(order_sum)`),
    while ad spend stays full sum;
  - added runtime cap for day SKU rows:
    `adOrderSum <= orderTurnoverBeforeSpp` (non-negative), so DRR base cannot exceed SKU order turnover.
- Fixed negative `lostOrdersCount` in `/dynamics` (`DYN-2`):
  - daily stock aggregation now uses `SUM(ABS(lost_orders_count))`;
  - runtime guard clamps parsed daily `lostOrdersCount` to non-negative.

**Checks:** `npm run typecheck`, `npm run build`.

---

## 2026-05-18 · Advertising terminal campaign mode

- Extended the advertising `Терминал` with a `Кампании / Товары` mode switch.
- Added campaign-oriented rows from the existing auto-strategy workspace:
  `advertId`, `nmId`, strategy mode, bidding mode, active/pause/dry-run state,
  bid limits, last run status, product metrics and risk.
- Enriched the selected-row detail panel with campaign state and guarded action
  handoff into the existing bid workspace.
- Marked P106 done in the terminal UX spec.

**Checks:** `npm run typecheck`, targeted `npx eslint`,
`npm run lint` (1 pre-existing warning outside changed files),
`npm run test`, `git diff --check`, `npm run build`.

---

## 2026-05-18 · Advertising terminal shell

- Added the read-only `Терминал` tab to `/advertising` with a dense
  Bider-style data-visualization pattern: toolbar metrics, search, risk/scope
  filters, compact master table and selected-row detail panel.
- Added detail tabs for daily metrics, query clusters, stock/action placeholders
  and guarded action handoff into the existing bid workspace.
- Extended advertising tab typing and marked P105 done in the terminal UX spec.

**Checks:** `npm run typecheck`, targeted `npx eslint`,
`npm run lint` (1 pre-existing warning outside changed files),
`npm run test`, `git diff --check`, `npm run build`.

---

## 2026-05-18 · Dashboard audit closure (April 2026)

- Closed DEF-2 in KPI aggregation:
  `adsOrderSum`/`adsOrderCount` now aggregate from deduplicated
  `nm_id + day` attribution rows (no placement multiplication), while ad spend
  keeps full row-level sum.
- Added KPI invariants for attributed ads metrics:
  `adsOrderSum <= orderSum` and `adsOrderCount <= orders` on the final KPI
  payload to prevent impossible values in DRR/CPO.
- Closed DEF-5 net-profit mismatch:
  fast profit report totals now compute tax/net from period aggregates via
  `calculateTax` (same contour as dashboard KPI), not by summing per-row tax.
- Closed DEF-7 buyout-rate contour mixing:
  exact funnel buyouts are now preferred whenever topline snapshot is present;
  finance fallback is only used when funnel outcomes are provisional/missing.
- Closed DEF-9 period comparison for calendar presets:
  previous-period range now resolves as previous calendar month for
  full-month presets and month-to-date for MTD windows (instead of plain
  rolling N-day shift).
- Closed DEF-3/DEF-8 for group scope consistency:
  in product-group summary, groups that represent full visible assortment
  (or are named `Весь магазин`) are evaluated with full-tenant scope (`groupId=null`);
  group naming now blocks reserved `Весь магазин` and normalized duplicates,
  and selector UI disambiguates user group label as `Весь магазин (склейка)`.
- Closed DEF-6 UI terminology mismatch:
  product table headers renamed to `Сумма заказов` and `Заказы, шт`.

**Checks:** `npm run typecheck`, `npm run build`,
`npm run test -- src/server/analytics/advertising-decision-center.test.ts src/server/advertising/ad-cost-history.test.ts src/lib/wb-sync-utils.test.ts`,
`npm run lint` (1 pre-existing warning outside changed files).

---

## 2026-05-18 · RAW dedupe hardening (global)

- Investigated the WB ad-spend mismatch for `ИП Лавров` in April and confirmed
  the root cause: mixed `raw_api_ad_costs` layers (`history_upd` + legacy
  `unified`) overlapped on `2026-04-10..2026-04-20`, causing double counting.
- Added sync guardrail in [`src/inngest/sync-wb.ts`](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/inngest/sync-wb.ts):
  when `history_upd` is present for a day, same-day legacy `unified` rows are
  deleted for that tenant/date window.
- Added ads-row dedupe before insert (`dedupeAdCostRows`) to avoid repeated
  source rows inside one run.
- Added `stock_sizes` in-memory dedupe helper
  (`dedupeStockSizeMetricItems`) in
  [`src/lib/wb-sync-utils.ts`](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-sync-utils.ts)
  and wired it into sync to block duplicate nullable-key rows from WB payloads.
- Added the same in-memory dedupe layer for `stock_offices`
  (`dedupeStockOfficeMetricItems`) and wired it into the same WB sync flow.
- Added migration
  [`drizzle/0089_raw_unique_nulls_not_distinct.sql`](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/drizzle/0089_raw_unique_nulls_not_distinct.sql):
  rebuilt nullable RAW unique indexes with PostgreSQL `NULLS NOT DISTINCT`
  (`ad_costs`, `paid_storage`, `stock_offices`, `stock_sizes`) so NULL-key
  duplicates are blocked by DB itself.
- Added global RAW duplicate audit CLI
  [`scripts/audit-raw-duplicates.mjs`](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/scripts/audit-raw-duplicates.mjs)
  (`npm run audit:raw-duplicates`) for full-history checks by business keys
  and ad-layer overlap (`history_upd` + `unified` on same `tenant+nm+day`).
- Added regression test in
  [`src/lib/wb-sync-utils.test.ts`](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/src/lib/wb-sync-utils.test.ts).
- Production data cleanup executed:
  - deleted 496 overlapping `unified` ad rows (`131 803.01 ₽`);
  - removed 1217 duplicate rows from `raw_api_stock_sizes`;
  - full-history post-check across RAW tables: no duplicate groups remain by
    normalized business keys, and no ad multi-type overlap by `tenant+nm+day`.

**Checks:** `npm run test -- src/lib/wb-sync-utils.test.ts`,
`npm run typecheck`, `npm run db:migration:check`,
production SQL duplicate audit and post-cleanup verification.

---

## 2026-05-17 · Dashboard warehouse revenue and logistics split

- Added a dashboard block for revenue by WB processing warehouse from
  `raw_api_sales.warehouse_name`, including warehouse count, total revenue,
  share and sale count.
- Promoted WB logistics into a separate dashboard expense metric with daily
  history bars, expense cards and a `Логистика всего` badge in the expenses
  section.
- Added product photos to the expenses drill-down SKU table, matching the KPI
  drill-down product rows.

**Checks:** targeted `npx eslint`, `npm run typecheck`,
`npm run db:migration:check`, `npm run test`, `npm run build`,
`npm run lint`, `git diff --check`.

---

## 2026-05-17 · Dashboard KPI drill-down tail and SKU photos

- Fixed KPI drill-down for buyouts and finance so same-day operational sales
  after the latest WB realization report are included in SKU totals.
- Added a finance-based fallback for buyout rate when exact funnel outcomes are
  not yet available, avoiding misleading `0.0%` for fresh periods.
- Added SKU photos to KPI drill-down tables and translated drill-down source
  labels from technical identifiers to Russian operator-facing text.

**Checks:** `npm run db:migration:check`, targeted `npx eslint`,
`npm run typecheck`, `npm run test`, `npm run build`, `npm run lint`,
`git diff --check`.

---

## 2026-05-17 · Stocks China warehouse and all-stock drilldown

- Added `stock_location` for own stock batches and movements, so existing rows stay on `own` and new ready stock can be tracked separately on `china`.
- Added `/stocks-v2/china-stock` with the same manual receipt, FIFO write-off, adjustment and WB shipment flow as the existing own-warehouse screen.
- Added `/stocks-v2/all-stock` and dashboard links/KPI for total stock across WB, own warehouse, China warehouse, production and in-transit layers.
- Updated Stocks 2.0 payload, purchase export and route titles to expose China stock and all-stock totals.

**Checks:** `npm run db:migration:check`, `git diff --check`,
`npm run typecheck`, `npm run build`.

---

## 2026-05-15 · WB card SEO audit and manual apply MVP

- Added `/seo` dashboard section with card-level SEO audit: title, description,
  characteristics, media, funnel, stock and data-quality checks.
- Added `/api/views/seo` behind active tenant + feature access validation.
- Added read-only SEO rules engine for scanned WB cards, including priority,
  score, issue details and concrete recommendations.
- Added direct card-level apply for SEO text: operator edits title/description
  in `/seo`, clicks `Применить в WB`, server fetches the full current WB card,
  changes only safe text fields and sends `content/v2/cards/update`.
- Added server-side payload guardrails for WB overwrite semantics: preserve
  dimensions, characteristics, sizes, brand and KIZ flag; strip non-updatable
  photos/video/tags/read-only fields.
- Added `seo` tenant feature, route gating and sidebar navigation entry.

**Checks:** `npx vitest run src/server/seo/card-audit.test.ts src/server/seo/card-apply.test.ts src/lib/wb-api/index.test.ts`,
`npm run typecheck`, targeted `npx eslint`, `npm run build`.

---

## 2026-05-15 · Dynamics metric picker bulk controls

- Added `Снять все` and `Выделить все` actions to the `/dynamics` metric picker next to `Сброс`.
- Updated default metric order so primary operational rows start with orders, projected net profit, fact profit, buyouts, revenue, logistics and ad efficiency; secondary stock/WB-tail rows move lower.

**Checks:** `git diff --check`, `npx eslint 'src/app/(dashboard)/dynamics/page.tsx'`,
`npm run typecheck`, `npm run build`.

---

## 2026-05-15 · Dynamics warehouse-based order logistics

- `/dynamics` now stores WB order warehouse fields from `supplier/orders`
  and uses them for order-based logistics projection.
- Added `raw_api_orders` warehouse/catalog/price fields plus an active
  `(tenant_id, nm_id, warehouse_name, date)` index for warehouse logistics reads.
- Projected net profit now subtracts logistics as a separate line: warehouse
  order logistics uses order warehouse, product volume in liters and the latest
  WB box tariff snapshot; missing coverage falls back to the historical WB
  logistics rate.
- Partial tariff coverage now uses a mixed projection: matched orders use
  warehouse tariffs, while the uncovered share uses the historical logistics
  fallback instead of blindly applying the matched average to all orders.
- Added visible dynamics rows for `Логистика заказов`, `Логистика / заказ`
  and `Покрытие логистики тарифами`.

**Checks:** `npm run db:migration:check`, `git diff --check`,
`npm run typecheck`, `npm run test -- src/server/jobs/sync-orders.test.ts`,
`npx eslint src/server/analytics/engine.ts src/server/jobs/sync-orders.ts src/inngest/sync-wb.ts src/types/wb.ts src/lib/db/schema.ts 'src/app/(dashboard)/dynamics/page.tsx'`,
`npm run build`.

---

## 2026-05-15 · Advertising snapshot data-quality guardrails

- Decision Center snapshot KPI now suppresses unreliable CTR values (outside `0..100%`) and falls back to hourly campaign CTR when raw cluster clicks/views are inconsistent.
- Snapshot CPC/CTR are now hidden when ad spend is zero instead of showing misleading values (`0 ₽`, non-zero CTR).
- Added explicit in-UI notice when the selected date range contains days without advertising data, so equal numbers between `30 дней` and shorter ranges are explained by coverage, not by UI bug.

**Checks:** `npm run typecheck`, `npm run test -- src/server/analytics/advertising-decision-center.test.ts`, `npm run build`, production rebuild + service restart + `/api/health` (`ok`).

---

## 2026-05-14 · Unit economics and dynamics performance pass

- Capped optional WB measurement enrichment in `/api/views/economics-template`
  at 2.5s with short error backoff, removing the observed >120s cold-load tail
  for the Berbeka cabinet.
- Disabled PostgreSQL JIT only for the large group dynamics and unit economics
  SQL reads; measured `/api/views/dynamics` on Lavrov at ~10.6s → ~1.3s and
  Berbeka at ~13.8s → ~6.5s, with `/dynamics` browser waterfall around 5.6-5.9s.
- Unit economics warm API on Lavrov improved from ~2.65s median to ~2.0-2.45s;
  Berbeka cold load now returns in ~4s then warms to ~0.8s.
- Materialized repeated dynamics CTEs after EXPLAIN showed repeated realization
  scans; Berbeka `/api/views/dynamics` improved further from ~6.2s to ~0.8-0.9s.

**Checks:** `npx eslint src/app/api/views/economics-template/route.ts`,
`npx eslint src/server/analytics/engine.ts`,
`npx eslint src/server/analytics/services/economics.ts`, `npm run build`,
repeated direct API `curl` timings, repeated `npm run load:tabs` for
`/economics-v2`, `/dynamics`, `/dynamics-lab` on the staging port.

---

## 2026-05-14 · Dynamics projected storage cost

- `/dynamics` projected order-based net profit now subtracts daily paid storage
  cost, so operational profit includes this real daily expense alongside SKU
  cost, ad spend and tax.

**Checks:** `npm run typecheck`, `npm run build`.

---

## 2026-05-14 · Dashboard tab performance pass

- Reduced eager Next.js prefetch on always-visible dashboard, signal and stock
  navigation links so tab loads no longer trigger large waves of aborted RSC
  requests.
- Avoided clearing React Query cache during the first tenant initialization;
  cache is now cleared only when an already-known tenant actually changes.
- Verified all 22 authenticated dashboard tabs with repeated Playwright
  waterfall runs: median total tab time improved by 5.3%, API requests by 7.5%,
  failed requests by 75.2%, and failed RSC requests by 97.2%.

**Checks:** `npx eslint` on changed client files, `npm run build`, repeated
`npm run load:tabs` over all authenticated dashboard routes.

---

## 2026-05-14 · Tab waterfall load audit

- Added `npm run load:tabs`, a Playwright tab-waterfall audit for API, RSC,
  server-action, static asset and failed-request diagnostics.

**Checks:** `node --check scripts/load/tab-waterfall.mjs`,
`npm run load:tabs -- --help`, `git diff --check`, `npm run lint`.

---

## 2026-05-14 · Marketplace expansion plans

- Added Ozon and Yandex Market integration plans as docs-only architecture
  baselines for marketplace-account expansion.
- Recorded the marketplace expansion track in the implementation backlog.

**Checks:** `git diff --check`, official API docs spot-check for Ozon and
Yandex Market.

---

## 2026-05-14 · Production WIP reconciliation and PnL fixes

- Reconciled production-local WIP into Git so the server can return to clean
  `origin/main` instead of carrying uncommitted code changes.
- WB Promotion deduction rows are now excluded from PnL expenses alongside
  credit-principal rows, with API/UI labels updated to show whether a deduction
  is included in PnL.
- Finance API realization timestamps with explicit time zones are normalized to
  the Moscow report day before storing report rows.
- Historical ad spend with no resolved `nmId` is retained in the total PnL
  bucket under `nmId = 0` instead of being dropped from inserted rows.
- `.codex/` local artifacts are ignored by Git; stale local `agent2`/`agent3`
  remotes were removed from this checkout.

**Checks:** `npm run db:migration:check`, `git diff --check`,
`npx vitest run src/lib/wb-api/index.test.ts src/server/advertising/ad-cost-history.test.ts`,
`npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`,
`npm run audit:production`.

---

## 2026-05-14 · Separate dashboard scale controls

- Split the dashboard toolbar into two labeled controls: manual `Масштаб` slider and separate `Под экран` auto-fit button.
- Kept both controls compact so the header does not stretch while making the purpose of each action explicit.

**Checks:** `npx eslint src/components/layout/DashboardScaleControl.tsx` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Dynamics projected profit correction

- Corrected `/dynamics` order-based projected net profit for group and SKU rows: forecast now uses expected buyouts, revenue after SPP, historical WB rates, SKU cost, ad spend, and tax.
- Kept order turnover before SPP and revenue after SPP as separate visible metrics so profit no longer silently uses the larger pre-SPP order sum as its base.

**Checks:** `npx eslint src/server/analytics/engine.ts` ✅.

---

## 2026-05-14 · Dashboard fit-to-screen control

- Added a separate dashboard fit mode next to the manual scale slider: manual scale remains for readability, fit mode auto-shrinks the workspace to the visible screen width.
- Reduced the shared scale toolbar width and slider/thumb size so the header control takes roughly half the previous space.
- Let the dashboard content container expand past the old fixed max-width while fit mode is active.

**Checks:** `npx eslint src/components/layout/DashboardScaleControl.tsx 'src/app/(dashboard)/layout.tsx'` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Dashboard drilldown timeout fix

- Replaced the heavy finance/buyout/expense drilldown source with a fast aggregate over `mv_daily_pnl_final`, paid storage, ad costs, and latest SKU costs.
- Kept the KPI drilldown and profit-report API outputs compatible so dashboard modals no longer fail on statement timeout.

**Checks:** `npx eslint src/server/analytics/services/finance-breakdown-fast.ts src/app/api/views/kpi-drilldown/route.ts src/app/api/views/profit-report/route.ts` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Compact header correction and WB news

- Removed the extra screenshot-inspired header actions and restored the compact top toolbar: scale, WB news, help, AI, tenant, notifications, theme, profile.
- Moved data freshness and the date range picker into one shared compact row under the header for all dashboard tabs.
- Wired the WB news button to the official Wildberries seller portal news API with server-side per-tenant caching.

**Checks:** `npx eslint src/components/layout/Header.tsx src/components/layout/WBNewsMenu.tsx src/components/layout/DateRangePicker.tsx src/components/dashboard/DataFreshnessBanner.tsx src/components/dashboard/DashboardDataFreshnessControls.tsx 'src/app/(dashboard)/layout.tsx' 'src/app/(dashboard)/overview/OverviewPageClient.tsx' 'src/app/(dashboard)/overview-test/page.tsx' 'src/app/(dashboard)/advertising/page.tsx' 'src/app/(dashboard)/explorer/page.tsx' 'src/app/(dashboard)/dynamics/page.tsx' src/app/api/views/wb-news/route.ts` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Dashboard header toolbar and calendar

- Reworked the shared dashboard header into a distributed toolbar: title on the left, dashboard scale control in the center, quick actions across the row, and the date range block below.
- Added a persistent dashboard scale slider from 80% to 120% with a one-click reset to 100%.
- Replaced the compact date inputs with a two-month range calendar, quick presets, and apply/cancel actions.
- Added a View Transition theme reveal animation for light/dark switching.

**Checks:** `npx eslint src/components/layout/Header.tsx src/components/layout/DateRangePicker.tsx src/components/layout/DashboardScaleControl.tsx src/components/ThemeToggle.tsx 'src/app/(dashboard)/layout.tsx' src/app/providers.tsx` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Compact dashboard header controls

- Reduced the shared dashboard header height and tightened the help, AI, notification, theme, and profile controls.
- Compacted the tenant switcher so the active cabinet fits into the top row without pushing the header wider.
- Moved the date range picker into a smaller second row and added a profile/settings shortcut in its former top-row position.

**Checks:** `npx eslint src/components/layout/Header.tsx src/components/layout/TenantSwitcher.tsx src/components/layout/DateRangePicker.tsx src/components/ThemeToggle.tsx src/components/layout/SignalNotificationsMenu.tsx` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Dashboard page titles in header

- Header now shows the active dashboard page title instead of the static “Аналитика Wildberries” title.
- Shared dashboard navigation metadata now drives both sidebar labels and header page titles.
- Removed duplicated local page titles from dashboard tabs while keeping page controls and internal section headings.

**Checks:** `npx eslint` on touched layout/page files ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Dashboard sync status strip

- Compressed the shared data sync banner into a single low-height strip with status, title, sync window, and the settings link on one line.
- Moved the sync strip to the top of `/overview`, `/advertising`, `/dynamics`, `/explorer`, and `/overview-test`.

**Checks:** `npx eslint src/components/dashboard/DataFreshnessBanner.tsx src/app/(dashboard)/overview/OverviewPageClient.tsx src/app/(dashboard)/overview-test/page.tsx src/app/(dashboard)/advertising/page.tsx src/app/(dashboard)/explorer/page.tsx src/app/(dashboard)/dynamics/page.tsx` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · Dynamics: compact daily table header

- Reworked the `/dynamics` daily table header into a compact strip with group photos, selected group name, WB finance coverage note, and the metrics button.
- Removed the large “Дневная таблица” explanatory block and redundant source pills from that table header.
- Slightly increased the group and SKU table column widths and numeric font size after the previous dense layout pass.

**Checks:** `npx eslint src/app/(dashboard)/dynamics/page.tsx` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-14 · All-tabs performance pass

- Extended the measured performance loop from `/overview` to all 16 authenticated sidebar tabs.
- Kept verified improvements for `/costs`, `/advertising`, `/dynamics`, and `/dynamics-lab`: virtualized the costing table rows, stabilized advertising summary loading layout/CLS, and switched dynamics thumbnails from WB `big` images to `tm` images.
- Discarded `/economics-v2` table virtualization/content-visibility experiments because they worsened LCP or overall Lighthouse score.

**Checks:** `npm run build` ✅, `/api/health` ✅, production Playwright smoke on `/overview`, `/costs`, `/advertising`, `/dynamics` ✅, all-tabs Lighthouse control on worktree ✅.

---

## 2026-05-13 · Overview: measured startup performance pass

- Ran an autonomous measured performance loop for authenticated `/overview` on the production server branch `perf/autoresearch-2026-05-13`.
- Kept only verified changes: defer below-fold overview sections, disable dashboard nav prefetch during startup, defer product-group summary/sync polling, avoid redundant initial dashboard refetch, and replace the Recharts PnL chart with a lightweight SVG chart.
- Deployed the verified branch to production. Repeat Lighthouse on `127.0.0.1:3457/overview`: performance 74, LCP ~1.02s, TBT ~1.56s, TTI ~3.16s; health and browser smoke passed.

**Checks:** `npm run build` ✅, `/api/health` ✅, Playwright smoke on `/overview` ✅, Lighthouse repeat measurement ✅.

---

## 2026-05-13 · Advertising: fast no-campaign decision actions

- `Decision Center` bid actions no longer perform a slow full WB campaign scan
  when local advertising stats have no `advert_id` for the SKU.
- Missing campaign linkage now returns a fast safe no-op explanation instead of
  waiting for the 25s route timeout.
- Current CPC card-bid actions were production-smoked for active `raise_bid` and
  `lower_bid` cards after deploy.

---

## 2026-05-13 · Advertising: CPC card-bid actions

- Added WB campaign-card bid API support for CPC search campaigns:
  current bids are read from `nm_settings.bids_kopecks`, minimum bids from
  `/api/advert/v1/bids/min`, and confirmed changes are sent to
  `/api/advert/v1/bids`.
- `Decision Center` bid cards now route CPC actions to the card-bid surface
  and keep cluster bid actions only for manual CPM campaigns.
- CPC dry-runs now produce a real preview and confirmation path instead of an
  unsupported warning.

**Checks:** `npx eslint src/lib/wb-api/index.ts src/server/advertising/workspace.ts src/server/agent/procifry-advertising-actions.ts src/server/advertising/decision-actions.ts src/components/advertising/decision/DecisionCenter.tsx` ✅.

---

## 2026-05-13 · Advertising: CPC bid-action guard

- `Decision Center` now detects CPC search campaigns before bid actions.
- CPC campaigns return a safe no-op preview with an explanation, because WB API
  allows search-cluster bid updates only for manual CPM campaigns.
- Action cards display that explanation as a warning instead of a red execution
  error.

**Checks:** `npx eslint src/server/advertising/decision-actions.ts src/components/advertising/decision/DecisionCenter.tsx` ✅.

---

## 2026-05-13 · Advertising: fast decision action preview

- `Decision Center` bid checks now resolve `advertId` from local hourly ad stats
  before falling back to live WB campaign lookup.
- Bid preview actions use a fast mode for the main cards: no full remote cluster
  analytics is loaded during the click, and the route aborts before nginx can
  return an HTML `504 Gateway Time-out`.
- If WB does not return current cluster bids, the UI now receives a JSON business
  error instead of calculating changes from zero bids.

**Checks:** `npx eslint src/app/api/views/advertising/decision-center/action/route.ts src/server/advertising/decision-actions.ts src/server/agent/procifry-advertising-actions.ts src/server/advertising/workspace.ts` ✅,
`npm run typecheck` ✅.

---

## 2026-05-13 · Advertising: JSON-safe decision actions

- `Decision Center` action cards now parse non-JSON server responses safely
  and show a readable error instead of `Unexpected token '<'`.
- `withIdempotencyKey(...)` now catches its own middleware failures and returns
  JSON errors, so API routes wrapped by idempotency no longer leak Next HTML
  error pages to the frontend.

**Checks:** `npx eslint src/lib/idempotency.ts src/components/advertising/decision/DecisionCenter.tsx` ✅,
`npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Advertising: compact heatmap labels

- Restored compact hourly heatmap layout.
- Hour headers now display `0:00`, `1:00`, ... instead of bare numbers.
- Active hourly cells now show only the order count; spend/revenue/ACoS remain
  in the hover tooltip.

**Checks:** `npx eslint src/components/advertising/heatmap/AdvertisingHeatmap.tsx` ✅,
`npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Overview: parity fix for finance card vs SKU table

- Aligned `getUnitEconomics` provisional-day logic with KPI contour:
  - provisional tail now uses dynamic `sku_margin_ratio` (same as KPI path),
    not hardcoded `15% + 50 ₽`;
  - ad source in unit economics is now selected globally (`ad_costs` or
    `ad_clusters`) without per-SKU mixing in one response;
  - group and hidden-product filters are applied consistently for provisional
    sales, ads and funnel aggregates.
- Goal: remove cases where finance card and SKU table show opposite profit sign
  for the same day and same scope.

**Checks:** `npm run build` ✅.

---

## 2026-05-13 · Advertising: fast detailed analytics

- Replaced the expandable `Подробная аналитика` UI query from the legacy heavy
  `/api/views/advertising` overview to the fast advertising `products` and
  `clusters` endpoints.
- Added a 15-second client-side timeout guard so the detailed block cannot
  spin forever if an API request stalls.
- Removed misleading PnL-only fields from the fast detailed view; the block now
  shows advertising-native metrics: spend, revenue, orders, ДРР, ROAS, CTR,
  CPC, CPO, product/group rows and search clusters.

**Checks:** `npx eslint src/components/advertising/overview/AdvertisingOverview.tsx` ✅,
`npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Advertising: clearer hourly heatmap cells

- Hourly heatmap axis now displays explicit Moscow-time labels (`00:00`,
  `01:00`, ...), not bare numbers.
- Active hourly cells now show orders and ad spend directly inside the colored
  slot; tooltip keeps the full context: spend, orders, revenue and ACoS.
- Daily fallback cells now also show orders alongside spend and ACoS.

**Checks:** `npx eslint src/components/advertising/heatmap/AdvertisingHeatmap.tsx` ✅,
`npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Advertising: fast Products API + product photo in Decision Center

- Added dedicated fast endpoint `/api/views/advertising/products` built on
  `advertising_hourly_stats` with group-aware attribution, lightweight risk
  classification and product context (`title`, `brand`, `vendorCode`,
  `photoUrl`).
- Switched `Товары` tab to the new endpoint to remove dependency on heavy
  overview payload and reduce first-load failures.
- Updated `Что делать сейчас` cards to include product identity and photo:
  backend decision-card contract now carries `productTitle`, `vendorCode`,
  `brand`, `photoUrl`; UI renders a thumbnail/fallback icon and item label.
- Kept operator flow unchanged (`Советник/Полуавтомат/Автопилот`, dry-run →
  confirm/apply), only improved data loading speed and card readability.

**Checks:** `npm run typecheck` ✅,
`npm run test -- src/server/analytics/advertising-decision-center.test.ts src/server/advertising/decision-autopilot.test.ts` ✅,
`npx eslint src/components/advertising/products/ProductsTab.tsx src/components/advertising/decision/DecisionCenter.tsx src/server/analytics/advertising-products.ts src/server/analytics/advertising-decision-center.ts src/server/advertising/decision-autopilot.test.ts src/app/api/views/advertising/products/route.ts src/components/advertising/_shared/types.ts` ✅,
`npm run build` ✅.

---

## 2026-05-13 · Advertising: fast decision center

- Fixed the Advertising summary card spinner: `/api/views/advertising/decision-center`
  no longer calls the full heavy `getAdvertisingOverview` query on first paint.
- Decision cards now use the indexed `advertising_hourly_stats` contour with
  group/SKU attribution for quick stop/lower/raise/check/quiet recommendations.

**Checks:** `npx eslint src/server/analytics/advertising-decision-center.ts ...` ✅,
`npx vitest run src/server/analytics/advertising-decision-center.test.ts` ✅,
`npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Settings: minimal control plane, fast API key apply, feature RBAC

- Settings page simplified around the essential operator controls: shop profile,
  WB API key, sync, WB LK, team access and account password.
- WB API key now saves immediately, then runs stored-token preflight with a
  visible animated status by API contour; sync stays blocked while the saved key
  is still `unknown`.
- Added in-settings password change via Supabase Auth.
- Added feature-level team access: `manager` role, presets for advertising,
  stock/supply, finance, support, analyst, custom permissions, invite-time
  permissions, owner-side member access edits, sidebar filtering and API view
  guards.
- Fixed WB LK interactive login status drift: successful login now stores
  `healthy`, migration normalizes legacy `active` statuses, and redistribution
  session readiness treats both values as valid during the transition.
- Added `.gitignore` guard for local `outputs/*` artifacts.

**Checks:** `npm run typecheck` ✅,
`npx eslint ...settings/team/auth...` ✅,
`npx vitest run src/lib/auth/tenant-access.test.ts` ✅,
`npm run db:migration:check` ✅, `npm run build` ✅.

---

## 2026-05-13 · Sync: progress summary and stock_sizes timeout

- `sync_runs.summary` теперь сохраняет `requestedSources` и не затирает
  существующий summary base при промежуточных progress update.
- В progress summary добавлен `updatedAt`, чтобы UI/оператор видел свежесть
  текущего шага синхронизации.
- Источник `stock_sizes` переведён на общий `runAbortableSource(...)` contour с
  отдельным timeout `WB_STOCK_SIZES_SOURCE_TIMEOUT_MS` и abort-signal.
- Добавлен Inngest job `wb-sync-recovery`: он ищет зависшие `pending/running`
  sync runs, строит план восстановления по сохранённым source summaries и
  перезапускает только оставшиеся источники.

**Checks:** targeted `npx eslint ...` ✅,
`npx vitest run src/server/jobs/sync-runtime.test.ts src/server/jobs/wb-sync-recovery.test.ts` ✅,
`npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Ops: load testing harness

- Добавлен документ `docs/LOAD_TESTING.md` с безопасным read-only контуром
  нагрузочного тестирования: HTTP API, browser UX и серверный мониторинг.
- Добавлены npm-команды `load:http`, `load:browser`, `load:watch`.
- Добавлены скрипты `scripts/load/*`: auth/storage-state helper, HTTP load,
  Playwright browser load, server watcher через SSH и общие env-utils.
- Отчёты пишутся в `output/load/*`; WB sync, RPA и webhook spam исключены из
  базового load test, чтобы не упереться во внешние лимиты WB/Supabase.

**Checks:** `npm run load:http -- --help` ✅,
`npm run load:browser -- --help` ✅, `npm run load:watch -- --help` ✅,
`node --check scripts/load/*.mjs` ✅.

---

## 2026-05-13 · Реклама: campaign/SKU heatmap для расписаний

- `advertising_hourly_stats` получил `advert_id`; новые hourly-дельты WB
  `adv/v3/fullstats` пишутся в разрезе `campaign + nmID + hour`.
- `wbApi.getAdSpend(...)` получил режим `groupBy=advert_nm_date`, не ломая
  прежний aggregate по `nmID + date` для обычной daily-рекламы.
- `/api/views/advertising/heatmap` и
  `/api/views/advertising/heatmap/dayparting` принимают `campaignId`/`advertId`
  и опциональный `nmId`.
- Если указан `nmId`, backend расширяет scope до склейки через
  `product_group_members`; dayparting считается по группе, а не по одиночному
  SKU.
- Scoped heatmap без накопленной почасовой истории больше не подменяется общей
  дневной heatmap кабинета и остаётся `insufficient_data`.
- UI расписания получил опциональное поле `nmID / склейка`.

**Checks:** `npx vitest run src/server/advertising/dayparting-recommendation.test.ts src/server/advertising/hourly-stats.test.ts src/lib/wb-api/index.test.ts` ✅,
targeted `npx eslint ...` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Реклама: heatmap превращается в расписание показов

- Добавлен builder рекомендации `heatmap -> dayparting`: неизвестные часы
  остаются включенными, а отключаются только слоты с достаточным плохим сигналом
  по расходу без выручки, расходу без заказов или высокому ДРР.
- Добавлен endpoint `/api/views/advertising/heatmap/dayparting`: `GET` отдаёт
  рекомендацию по периоду, `POST` сохраняет правило расписания для кампании.
- Дневной fallback не создаёт почасовые правила и возвращает `insufficient_data`,
  чтобы не выключать рекламу без hourly-истории.
- UI расписания показов получил heatmap-блок: `Подставить` и
  `Сохранить heatmap`.
- Сохранение идёт через существующий `upsertDaypartingRule(...)` и пишет audit
  action `dayparting_rule`; журнал показывает его как `Правило расписания`.

**Checks:** `npx vitest run src/server/advertising/dayparting-recommendation.test.ts` ✅,
targeted `npx eslint ...` ✅, `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-13 · Signals: карточки задач с фото и переходом к исправлению

- Карточки `/signals` теперь подтягивают контекст товара из `products`:
  `vendorCode`, `brand`, `photoUrl`.
- Если `photoUrl` в базе пустой, UI строит fallback-ссылку на фото WB по
  `nmId`, чтобы оператор видел артикул прямо в задаче.
- В карточке разделены действия: `Детали` открывает drawer, основная кнопка
  ведёт в место исправления проблемы.
- Переходы фокусируют нужный товар и раздел: реклама → `Explorer / ads`,
  карточка/SEO/конверсия → `Explorer / funnel`, остатки → `Explorer / orders`,
  экономика → `/economics-v2` с `focusNmId`.
- `/economics-v2` принимает `focusNmId`, фильтрует таблицу по товару и
  открывает финансовую детализацию.

**Checks:** `npm run test -- src/lib/signal-queue-utils.test.ts src/lib/operator-signal-timeline.test.ts` ✅,
`npm run build` ✅, production SHA parity `3882786f` ✅,
`curl http://localhost:3457/api/health` on `metric-pulse-app-01` ✅.

---

## 2026-05-13 · Реклама: background executor для Decision Center

- Ручной endpoint `/api/views/advertising/decision-center/action` переведён на
  общий server-service `src/server/advertising/decision-actions.ts`, чтобы UI и
  фоновые действия использовали один контур.
- Добавлен `src/server/advertising/decision-autopilot.ts`: он собирает карточки
  `Что делать сейчас`, делает dry-run и применяет действия по режиму кабинета.
- Добавлен Inngest job `advertising-decision-autopilot` с cron
  `AD_DECISION_AUTOPILOT_CRON` (`*/30 * * * *` по умолчанию).
- Политика применения: `Советник` read-only, `Полуавтомат` сам снижает ставки,
  `Автопилот` применяет stop/lower/low-risk raise через dry-run→apply.
- Добавлен cooldown `AD_DECISION_AUTOPILOT_COOLDOWN_HOURS` (6ч по умолчанию),
  чтобы одна и та же карточка не выполнялась повторно каждые 30 минут.
- Все фоновые действия пишутся в `procifry_agent_audit_log` с source
  `advertising-decision-autopilot`.

**Checks:** `npx vitest run src/server/advertising/decision-autopilot.test.ts src/server/jobs/advertising-decision-autopilot.test.ts src/server/analytics/advertising-decision-center.test.ts` ✅.

---

## 2026-05-12 · Реклама: минимальный автопилот и склейки

- Зафиксирован дизайн нового рекламного слоя `Что делать сейчас`:
  `docs/advertising/ADVERTISING_AUTOPILOT_MINIMAL_UX.md`.
- В backlog добавлена Wave 2.5: `P92-P98` для group-aware attribution,
  Decision Center API, подтверждений, минимального первого экрана, режимов
  автопилота, проверки товара и heatmap по часам.
- `getAdvertisingOverview` теперь считает рекламную эффективность по склейке:
  расход суммируется по рекламируемым SKU внутри группы, а продажи/выручка
  берутся по всем SKU этой склейки.
- Карточки товаров, top SKU и action items показывают бейдж `Склейка`, чтобы
  оператор видел, что ДРР и рекомендации посчитаны не по одиночному `nmId`.
- Для одиночных SKU оставлен прежний fallback.
- Добавлен `Decision Center`: pure builder, endpoint
  `/api/views/advertising/decision-center` и блок `Что делать сейчас` на
  сводке рекламы. V1 карточки ведут в нужный advanced-раздел без WB-мутаций.
- Для `Срочно остановить` добавлен двухшаговый flow: dry-run показывает
  количество high-risk кластеров, `Подтвердить` применяет bulk cleanup через
  `executeProcifryAdvertisingAction(actionType=ad_bulk_cluster_cleanup)`.
- Для `Снизить ставку` / `Поднять ставку` добавлен такой же dry-run/apply flow
  через `executeProcifryAdvertisingAction(actionType=ad_bid_update)`: маршрут
  находит поисковую кампанию по `nmId` и готовит дельту `-10%` или `+10%`.
- После apply карточка `Что делать сейчас` показывает переход в `Операции`,
  а также запоминает последнее dry-run/apply действие по кабинету.
- На первом экране добавлен selector `Советник / Полуавтомат / Автопилот`;
  выбранный режим сохраняется в `tenants.advertising_autopilot_mode` через
  `/api/views/advertising/settings`. Scheduled auto-bidder применяет ставки
  только в режиме `Автопилот`; в `Советник` и `Полуавтомат` пишет preview без
  WB-мутаций.
- Для P97 добавлен foundation `productCheck` на уровне SKU/склейки: причины
  проверки товара строятся из CTR, кликов без заказов, ДРР, CPC, расхода без
  выручки, склейки, остатков, цены, контента карточки, позиций и конкурентов;
  ProductCard и Decision Center показывают эти причины.
- Служебный стабильный action item получил код `stable`, чтобы `Все спокойно`
  не превращалось в ложное действие `Проверить товар`.
- Для P98 добавлена дневная heatmap `Когда реклама работает`: по дням недели
  видны расход, выручка и ДРР. Почасовой слой отложен до появления hourly
  source, потому что текущие рекламные RAW-таблицы дневные.
- Для P99 добавлен profit-aware слой решений: `getAdvertisingOverview` теперь
  считает `netProfit`, `netProfitBeforeAds`, `profitMarginPct` и
  `adSpendToProfitBeforeAdsPct` по SKU/склейке, используя final PnL и
  provisional sales tail после последней реализации.
- Decision Center теперь останавливает рекламу при отрицательной чистой
  прибыли после рекламы, снижает ставку если реклама забирает 60%+ прибыли до
  рекламы, а рост ставки разрешает только при положительной ЧП и нормальной
  марже.
- Подробная сводка и карточки товаров показывают чистую прибыль после рекламы,
  прибыль до рекламы и маржу, чтобы оператор видел бизнес-эффект, а не только
  выручку/ДРР.
- Первый экран `/advertising` стал минимальным: подробный старый
  `AdvertisingOverview` скрыт за кнопкой `Подробная аналитика`.
- Добавлены unit-тесты `advertising-decision-center.test.ts` на stop/raise/lower
  по profit-aware причинам, quiet и stable-action fallback.

**Checks:** `npx vitest run src/server/analytics/advertising-decision-center.test.ts` ✅,
targeted `npx eslint ...` ✅, `npm run typecheck` ✅, `npm run build` ✅,
`git diff --check` ✅.

---

## 2026-05-12 · PnL: тело кредита WB исключено из расходов

- В расчёте выплаты WB (`buildWbPayoutBeforeCostSql`) удержания по кредиту
  разделены по причине (`bonus_type_name` / `supplier_oper_name` /
  `doc_type_name`): погашение **тела** кредита исключается из расхода PnL,
  проценты по кредиту остаются в расходах.
- `getNetProfitBreakdown` и `/api/views/profit-report` теперь считают
  `удержания_wb` как расходные удержания (без principal), отдельно отдают
  `удержания_wb_проценты_по_кредиту` и
  `удержания_wb_тело_кредита_вне_pnl`; в расшифровке удержаний добавлены
  `тип_удержания` и флаг `в_расходах_pnl`.
- Добавлена миграция `0075_credit_principal_exclude_from_pnl.sql`:
  пересоздаёт `mv_daily_pnl_final` с тем же правилом исключения тела кредита,
  чтобы KPI/динамика и breakdown считались одинаково.
- Обновлены пояснения на экране детализации расходов и agent-report
  `cost_breakdown_detail`: `deduction` считается без тела кредита.
- AUSN-агрегация приведена к той же логике: поле `deduction` теперь расходное
  (без principal), отдельно возвращаются credit principal/interest.

**Checks:** `npm run typecheck` ✅, `node scripts/check-migration-journal.mjs` ✅,
`npm run build` ✅.

---

## 2026-05-12 · Procifry: SKU-атрибуция WB storage через paid_storage

- `unit_economics_summary` больше не распределяет фактическое хранение из
  finance-строк `nmId=0` по продажам: при наличии `raw_api_paid_storage`
  SKU PnL добавляет обратно weekly `storage_fee_rub` и списывает хранение по
  `raw_api_paid_storage.storage_amount`.
- KPI-карточка и drilldown `Хранение` переведены на SKU-атрибутированный
  `paid_storage`; finance storage оставлен только fallback, если paid-storage
  контур пуст.
- `cost_breakdown_detail.components.storage` и source/freshness теперь явно
  указывают `raw_api_paid_storage.storage_amount`.
- Read-only сверка Бербеки подтвердила причину: за `2026-04-13..2026-05-10`
  finance storage в `nmId=0` = `107 373.80`, а `paid_storage` = `107 373.69`
  при `paid_storage nmId=0 = 0`; за `2026-04-29..2026-05-12`
  `paid_storage nmId=0 = 0`.

**Checks:** `npm run typecheck` ✅, `npm run build` ✅, `git diff --check` ✅.

---

## 2026-05-12 · Реклама: verification и операционный центр

- `pauseAdvert` / `resumeAdvert` теперь после WB-запроса проверяют фактический
  статус кампании через campaign details: пауза ожидает `11`, запуск ожидает
  `9`; для тестов/спец-сценариев оставлен явный `verify: false`.
- Dayparting cron пишет в audit metadata результат проверки pause/resume,
  включая expected/actual status и ошибку, если WB не подтвердил состояние.
- Добавлен endpoint `/api/views/advertising/workspace/operations`: единый срез
  алертов, ошибок ставок, минус-фраз, pause/start verification и запусков
  автостратегий.
- В `AdvertisingBidWorkspace` добавлены health strip и sub-tab `Операции` с
  инцидентами и очередью действий.
- Roadmap записан в `docs/IMPLEMENTATION_BACKLOG.md` как `P77`.

**Checks:** `npm test -- src/lib/wb-api/index.test.ts` ✅, targeted
`npx eslint ...` ✅, `npm run typecheck` ✅, `npm run build` ✅,
`git diff --check` ✅. Browser smoke was limited by the current dev server:
`/advertising` returns `307 -> /login`, but `/login` hangs before DOM load.

---

## 2026-05-12 · Production readiness, deploy verification and workspace cleanup

- Added a repeatable read-only production smoke command:
  `npm run smoke:production:readonly`. It checks public pages, protected-route
  redirects and `/api/health` without login, tenant creation, sync triggers or
  production data mutation.
- Hardened CI and release baseline: GitHub Actions and
  `node scripts/release-baseline.mjs` now cover lint, typecheck, tests, build
  and `audit:production`.
- Added `scripts/production-dependency-audit.mjs` so transient npm registry
  `ECONNRESET` failures are retried while real high+ vulnerabilities still
  block release.
- Fixed production standalone startup preparation in
  `ops/prepare-next-standalone.sh`: App Router route-group manifests are synced
  into both root `.next/server/app` and
  `.next/standalone/.next/server/app`, which fixed production `500` responses
  on `/signup` and `/reset-password`.
- Deployed the readiness changes to `metric-pulse-app-01`, ran migrations
  (`0 pending`, 75 total), restarted `enterprise-wb-analytics` and
  `enterprise-wb-analytics-inngest`, then verified postdeploy health and
  read-only production smoke.
- Updated release/status documentation:
  `docs/PROJECT_STATUS.md`, `docs/RELEASE_CHECKLIST.md`,
  `docs/SMOKE_OPERATOR_FLOW.md`.
- Cleaned the local workspace:
  removed generated build/temp artifacts, removed obsolete clean git worktrees
  `РНП_Gemini-agent2..6`, pruned worktree metadata and moved large historical
  backup/copy folders to
  `/Users/vitea_b/.Trash/RNP_Gemini_cleanup_20260512-180222`.
- Workspace size under `/Users/vitea_b/Desktop/Боты/РНП_Gemini` was reduced
  from roughly 12G to 1.1G; `.env`, env backup, `node_modules` and current WIP
  source changes were intentionally preserved.

**Checks:** `node scripts/release-baseline.mjs` PASS,
`npm run smoke:production:readonly` PASS,
`POSTDEPLOY_SMOKE_AUTH_MODE=skip npm run postdeploy:production` PASS,
GitHub Actions `CI` PASS on latest `main`.

---

## 2026-05-12 · Динамика 2.0: sticky-колонки и тепловая подсветка

- В общей дневной таблице и раскрытии SKU снова закреплены левые колонки до
  `Итого`: при горизонтальном скролле остаются видны название метрики/артикула
  и итоговое значение.
- Дневные ячейки получили тепловую подсветку относительно своей строки:
  зеленый — лучше среднего, красный — хуже, желто-синий — сильные отклонения
  для нейтральных показателей вроде цены и остатка.

**Checks:** `npx eslint src/app/(dashboard)/dynamics-lab/page.tsx` ✅,
`npx tsc --noEmit --pretty false` ✅, `npm run build` ✅.

---

## 2026-05-12 · Динамика 2.0: дневная история цен и остатков в SKU

- `/api/views/dynamics` теперь подтягивает дневные ценовые снимки из
  `raw_api_price_snapshots`: СПП, цену продавца и цену после СПП.
- В динамику добавлена история остатков из `raw_api_stock_sizes`: остаток WB,
  товары в пути до/от клиента, потерянные заказы и оборачиваемость.
- Отдельный блок `Текущий срез SKU` убран из раскрытия артикула; эти показатели
  теперь идут строками в той же дневной матрице, а при отсутствии снимка
  показывается `н/д`, не ноль.
- В общую таблицу склейки добавлены дневные строки по общему остатку, товарам в
  пути и потерянным заказам.

**Checks:** `npx eslint src/app/(dashboard)/dynamics-lab/page.tsx` ✅,
`npx tsc --noEmit --pretty false` ✅, `npm run build` ✅,
`git diff --check` ✅.

---

## 2026-05-12 · Procifry Agent API: RBAC, data states and report hardening

- Выданы report scopes: `wb-content -> competitor_cards_summary`,
  `wb-ads -> ab_tests_summary`; training metadata синхронизирована с RBAC.
- External persisted reports теперь явно возвращают `sourceStatus`,
  `sourceUpdatedAt`, `dateCoverage` и note для пустых фидов:
  `ready`, `no_data_for_period`, `source_not_populated`.
- `unit_economics_summary` больше не падает HTTP 500 при ошибке engine:
  возвращает структурированный `sourceStatus=calculation_error`.
- `advertising_campaign_stats` больше не умножает расход при join с кластерами:
  сначала агрегирует `raw_api_ad_costs`, потом присоединяет impressions/clicks
  по `nmId/date`, плюс отдаёт diagnostics.
- `advertising_by_nm_summary` и `advertising_campaign_stats` теперь выбирают
  spend из `raw_api_ad_clusters.amount`, если fullstats/cluster spend
  существенно выше `raw_api_ad_costs`; в ответе есть `rawCostSpend`,
  `clusterSpend`, `spendSource`.
- Для `reviews_summary` / `questions_summary` добавлена пагинация через
  `offset` / `skip` / `cursor` / `page` / `afterId`, фильтр `answerStatus` и
  фильтрация по `dateFrom/dateTo`.
- `unit_economics_summary` распределяет `nmId=0` storage/other fees по SKU в
  Agent API output: основной вес `stock_count * wbWarehouseVolumeLiters`,
  fallback — stock-days, soldQty, grossRevenue или equal split.

**Checks:** `npm test -- src/server/agent/reports.test.ts src/lib/agent-api.test.ts src/server/agent/procifry-training.test.ts` ✅, `npm run typecheck` ✅, `npm run lint` ✅.

---

## 2026-05-12 · Динамика 2.0: sticky-календарь, компактная запись действий и fallback формул

- В `/dynamics-lab` закреплена только строка календаря в таблицах (общая и SKU),
  без закрепления левых колонок и без sticky для верхнего блока склейки.
- Календарная шапка усилена контрастом: `Метрика`/`Итого`/дни выделены разными
  цветами, чтобы при вертикальном скролле не терялась привязка по датам.
- Правый сайдбар записи действий убран; вместо него добавлена компактная
  горизонтальная строка `Запись` над дневной таблицей с быстрым созданием события.
- Кнопки периодов и управления склейкой приведены к контрастным состояниям, чтобы
  не пропадать в неактивном состоянии.
- Подсказки `?` переведены на portal-рендер над интерфейсом (выше иконки), чтобы
  текст не обрезался контейнерами и читался полностью.
- Для общих и SKU-метрик добавлены fallback-расчеты без пустот:
  `ЧП без рекламы`, `CTR`, `% выкупа`, `средний чек`, `прибыль/шт`.

**Checks:** `npx eslint src/app/(dashboard)/dynamics-lab/page.tsx` ✅,
`npm run build` ✅.

---

## 2026-05-12 · Динамика 2.0: компактная склейка и раскрываемые SKU

- В `/dynamics-lab` верхний блок склейки сжат до рабочей панели: выбор группы,
  фото SKU, KPI и действия управления теперь видны без крупного темного баннера.
- Кнопки создания, добавления SKU, переименования и удаления получили явные
  контрастные состояния, чтобы не пропадать на светлом фоне.
- Основная дневная таблица получила внутренний скролл, закрепленную шапку и
  закрепление левых колонок до `Итого` при горизонтальной прокрутке.
- Нижняя SKU-матрица заменена на старый паттерн раскрытия: клик по артикулу
  раскрывает дневные метрики, текущие цены, остатки, путь до/от клиента и
  оборачиваемость.
- Для KPI, общих строк и раскрытых SKU-метрик добавлены подсказки с вопросом:
  при наведении объясняется человеческим языком, откуда берется показатель и
  как он считается.

**Checks:** `npm run typecheck` ✅, `npm run build` ✅, `git diff --check` ✅.
Локальный визуальный smoke ограничен редиректом на `/login`: без авторизованной
сессии `/dynamics-lab` не открывает данные.

---

## 2026-05-12 · Динамика 2.0: управление склейкой внутри вкладки

- В `/dynamics-lab` перенесены основные действия старой вкладки: создать
  склейку, переименовать, удалить, добавить товары и убрать SKU из группы.
- Добавлен встроенный выбор товаров с поиском по nmID, артикулу и названию,
  мультивыбором и добавлением выбранных SKU в текущую склейку.
- В SKU-матрице появился быстрый action удаления артикула из склейки.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅.

---

## 2026-05-12 · Динамика 2.0: CPO склейки и дневные SKU-ряды

- В `/dynamics-lab` добавлена явная метрика `Цена заказа склейки`: рекламный
  расход всей группы делится на заказы всей группы, чтобы реклама на одном SKU
  оценивалась по продажам всей склейки.
- `ДРР` в новой вкладке теперь тоже считается от суммы заказов всей склейки;
  `WB ads order_sum` используется только как fallback, если воронки нет.
- Ниже общего блока добавлена дневная таблица по каждому артикулу с переключением
  метрики: заказы, цена заказа, средний чек, ЧП, реклама, ДРР, CTR, % выкупа.
- В блок формул добавлены `Цена заказа склейки` и `Средний чек заказа`.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅.

---

## 2026-05-12 · Runtime smoke, CI gates and project status

- Added `smoke:production:readonly` for repeatable production checks that do
  not log in, create tenants or trigger sync.
- CI now runs the minimum release gate: lint, typecheck, tests, build and
  production dependency audit.
- Release baseline now includes `audit:production`, with retries around
  transient npm registry failures.
- Added `docs/PROJECT_STATUS.md` with current green checks, remaining runtime
  proof points, workspace cleanup inventory and release path.
- Fixed production standalone startup preparation so App Router route-group
  client manifests are synced into both root `.next/server/app` and
  `.next/standalone/.next/server/app`; this restores `/signup` and
  `/reset-password` in standalone runtime.

**Checks:** production read-only smoke PASS, GitHub latest `CI` run inspected
PASS, `git diff --check` PASS.

---

## 2026-05-12 · Отдельная вкладка «Динамика 2.0»

- Добавлена новая вкладка `/dynamics-lab` без замены текущей `/dynamics`.
- Вкладка собирает найденные практики WB/GitHub в отдельный управленческий
  формат: источники метрик, KPI, график, контуры `Контроль` / `Воронка` /
  `Финансы` / `SKU` / `База решений`.
- В меню добавлен отдельный пункт `Динамика 2.0`, чтобы сравнивать старую и
  новую вкладки рядом.
- `getGroupDynamics` теперь читает состав группы через `product_groups.tenant_id`,
  чтобы доступ к `product_group_members` был явно привязан к активному кабинету.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅, `npm run build` ✅,
`git diff --check` ✅.

---

## 2026-05-12 · Себестоимость копируется в цвета модели

- В `/costs` добавлена колонка `Склейка`: из любой строки можно открыть выбор
  SKU той же модели и проставить им текущие поля себестоимости.
- Копируются только cost-поля: `Товар закупка`, доставка до ФФ, упаковка,
  фулфилмент, выбранные склады и доставка до ВБ; сценарии юнит-экономики и
  план заказа у целевых SKU не затираются.
- Применение сразу сохраняет источник и выбранные SKU в
  `unit_economics_manual_inputs`, а закупочную цену синхронизирует в
  `unit_economics_configs`.

**Checks:** targeted costs tests ✅, targeted eslint ✅, `npm run typecheck` ✅.

---

## 2026-05-12 · Production readiness smoke

- Production `metric-pulse-app-01` verified on `origin/main` SHA `4909068f`.
- Applied pending DB migration `0073_ausn_bank_and_manual_operations` after a
  verified pre-migration backup with restore-test.
- Read-only browser smoke passed for public pages, protected-route redirects
  and `/api/health`.
- Deployment runbook updated to use `.env.backup` + OS user `postgres` for
  pre-migration snapshots instead of the app DB role.

**Checks:** `npm run postdeploy:production` with UI smoke skipped ✅,
production `npm run db:migrate` ✅ `0 pending`, internal/external
`/api/health` ✅, read-only Playwright smoke ✅, `git diff --check` ✅.

---

## 2026-05-12 · Jarvis worker IDs и Procifry Agent API quality fixes

- Добавлены 8 новых Jarvis `worker_id` в RBAC: `wb-chief`, `wb-data`,
  `wb-economics`, `wb-ads`, `wb-content`, `wb-ops`, `wb-reviews`,
  `wb-market`; scopes наследуют соответствующих legacy worker-ов, у
  `wb-market` добавлен competitor read-scope.
- Training layer и skill pack переведены на новую команду Jarvis; рекламные
  autonomous actions разрешены для `wb-ads` и `wb-chief` и видны в
  `catalog.actions` как `advertising_action`.
- `oos_history` теперь принимает `limit` до 5000, `reviews_summary` /
  `questions_summary` по умолчанию возвращают 100 строк и максимум 500.
- Добавлен helper `scripts/procifry-agent.mjs` для `catalog`, `report`,
  `unit-economics-indices-action`.
- Расширены дефолтные RPA-селекторы перераспределения WB под новый маршрут и
  кнопку `Перераспределить`.
- Обновлен запрос разработчикам Procifry по внешним feeds, worker keys,
  backfill и P2-доработкам.

**Checks:** `git diff --check` ✅, targeted Procifry tests ✅,
`npm run typecheck` ✅, `npm run lint` ✅, `npm run build` ✅,
`procifry-agent` dry-run ✅.

---

## 2026-05-12 · Юнит-экономика читает себестоимость из /costs

- В `/economics-v2` поля `Товар закупка`, `Доставка до ФФ`, `Упаковка`,
  `Фулфилмент`, `Доставка до ВБ` и `Себес полный с отгрузкой` теперь работают
  как отображение источника `/costs`, без повторного inline-ввода.
- Блок складов в юнит-экономике показывает выбранные в себестоимости склады и
  суммы доставки до ВБ read-only; ИЛ/ИРП и сценарные поля остались в юнитке.
- `/costs` использует тот же fallback закупочной цены, что и `/economics-v2`:
  ручной `costPrice`, затем `purchasePrice`, затем legacy `costPrice` только
  когда нет отдельных доставок/упаковки/фулфилмента.
- Excel-лист «Данные для ввода» больше не принимает колонки себестоимости:
  эти значения редактируются в `/costs`.

**Checks:** `git diff --check` ✅, targeted economics tests ✅,
`npm run typecheck` ✅, `npm run lint` ✅, `npm run build` ✅.

---

## 2026-05-11 · Quality cleanup: чистые lint/build

- Убраны последние `eslint` warnings: удалён устаревший WB LK flow в настройках,
  CAPTCHA в новом WB LK flow переведена на `next/image`, лишний
  `eslint-disable` в перераспределении удалён.
- Settings page после успешного WB LK входа теперь перечитывает настройки
  кабинета и обновляет карточку состояния сессии без перезагрузки страницы.
- Next build перестал предупреждать о Sentry/Prisma OpenTelemetry bundle:
  `@prisma/instrumentation` вынесен в `serverExternalPackages`.

**Checks:** `npm run lint` ✅ без warnings, `npm run build` ✅ без warnings,
`npm run typecheck` ✅, `npm run test` ✅, `npm audit --omit=dev --audit-level=high` ✅,
`git diff --check` ✅.

---

## 2026-05-11 · Security patch зависимостей

- `next` и `eslint-config-next` обновлены с `16.2.4` до `16.2.6`.
- `npm audit fix` обновил транзитивные зависимости, включая `fast-uri` и
  OpenTelemetry-пакеты, которые приходят через Sentry/Inngest.
- `npm audit --omit=dev` теперь возвращает `0 vulnerabilities`.

**Checks:** `npm audit --omit=dev` ✅, `npm run typecheck` ✅,
`npm run test` ✅, `npm run lint` ✅ с существующими warning,
`npm run build` ✅ с существующим Sentry/OpenTelemetry warning.

---

## 2026-05-11 · Себестоимость: единые названия в юнит-экономике

- Разделы `/costs` и `/economics-v2` приведены к одной терминологии:
  `Товар закупка`, `Доставка до ВБ`, `Себес полный с отгрузкой`.
- Активная ячейка `Товар закупка` в `/economics-v2` теперь показывает fallback
  из сохранённой себестоимости, если ручное поле ещё пустое.
- Excel-экспорт/импорт юнит-экономики получил те же названия входных колонок,
  чтобы не выглядеть как отдельный второй источник затрат.

**Checks:** `git diff --check` ✅, `npm run typecheck` ✅,
`npm run build` ✅ with existing Prisma/Sentry OpenTelemetry warning.

---

## 2026-05-11 · Точки входа: отдельная регистрация и русский публичный контур

- Добавлена отдельная страница `/signup` с русским сценарием регистрации,
  подтверждением пароля и кнопками показа/скрытия пароля.
- `/login` оставлен только для входа и восстановления пароля; старый
  `/login?mode=signup` переводит пользователя на `/signup`.
- Публичные кнопки на лендинге теперь ведут на `/signup`; видимые англоязычные
  подписи на публичной странице заменены русскими.
- Middleware разрешает `/signup` как публичную страницу входа.
- Регистрация сохраняет `source`, `ref`, `utm_*` в Supabase user metadata как
  безопасную основу для будущего раздела лидов в админке.
- Зафиксирован план точек входа: сайт — основная регистрация, Телеграм —
  привлечение/поддержка, админка — контроль клиентов, магазинов, подписок и
  будущих лидов.

**Проверки:** `npm run typecheck` ✅, targeted eslint ✅,
`git diff --check` ✅, `npm run build` ✅, браузерная проверка `/`, `/signup`,
`/login`, `/login?mode=signup` ✅.

---

## 2026-05-11 · Админка: hotfix production render

- Исправлен production-crash `/admin`: сырые SQL-запросы возвращали даты
  строками, а группировка аккаунтов вызывала `createdAt.getTime()`.
- Admin backoffice теперь нормализует даты перед сортировкой, фильтрами и
  расчетом статусов.
- Группировка аккаунтов учитывает и `user_tenants`, и legacy `users.tenant_id`;
  production-данные поправлены: `vitea_b@mail.ru` владеет магазинами
  `ИП Лавров` и `ИП Бербека`, `bahtierzodasahrier@gmail.com` владеет
  `Skinshop`.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅,
production `npm run build` ✅, production `/api/health` ✅,
Playwright `/admin` + `/admin/customers` under `vitea_b@mail.ru` ✅.
Related commit: `ee62d98`.

---

## 2026-05-11 · АУСН: банк, WB-взаимозачёт и операции вне WB

- Раздел `/aosn` переведён на понятную схему расчёта: отдельно суммы банка,
  которые уже есть в операциях АУСН, отдельно WB-взаимозачёт для переноса в ЛК,
  отдельно ручные операции вне WB.
- Налоговая оценка теперь считает базу как `банк + строки ЛК`, а не только
  WB-взаимозачёт. Для объекта `Доходы` применяется 8%, для
  `Доходы-Расходы` — 20% с минимумом 3%.
- В WB-формуле сохранена бухгалтерская логика из сверок:
  `Приход = удержания - возврат удержаний + возврат доходов`;
  `Возврат прихода = возврат доходов`; `Расход = УПД`;
  `Возврат расхода = УКД`.
- Добавлены ручные строки `Прочий приход / возврат прихода / расход / возврат
  расхода` для операций, которые не попали в банковскую разметку ФНС.
- Синхронизация WB теперь заменяет только WB-документы месяца и не стирает
  ручные операции вне WB.
- Добавлена миграция `0073_ausn_bank_and_manual_operations.sql` и unit-тесты
  формул на февральском примере бухгалтера.

**Checks:** targeted eslint ✅, `npx vitest run src/server/analytics/services/ausn.test.ts` ✅,
`npm run db:migration:check` ✅.

---

## 2026-05-11 · Админка: аккаунты, магазины и русский интерфейс

- `/admin` переведён на модель "аккаунт владельца -> магазины": один email
  владельца отображается как один аккаунт, а привязанные `tenants` показываются
  как магазины внутри него.
- Сводка теперь показывает количество аккаунтов и отдельно количество магазинов;
  текущая production-картина: 2 аккаунта и 3 магазина.
- Раздел `/admin/customers` переименован в интерфейсе в `Аккаунты`, таблица
  группирует магазины под владельцем вместо показа каждого магазина как
  отдельного пользователя.
- Видимые подписи, фильтры, статусы, карточки, подписки, платежи и
  синхронизации в админке переведены на русский.
- Production-доступ в админку выдан только постоянному аккаунту
  `vitea_b@mail.ru` с ролью `owner`; других platform admins сейчас нет.

**Checks:** `npm run typecheck` ✅, targeted eslint for admin ✅,
`git diff --check` ✅, production `npm run build` ✅,
production `/api/health` ✅. Deployed through `metric-pulse-app-01`.
Related commit: `1b1cc2c`.

---

## 2026-05-11 · Stocks v2 warehouse workflows

- Раздел `/stocks-v2/own-stock` получил рабочий ручной приход: массовый выбор
  SKU с фото, заполнение количества, закупки товара и доставки до ФФ, Excel
  шаблон и обратная загрузка.
- Закупка товара стала обязательной для ручного прихода; доставка до ФФ
  остаётся необязательной и прибавляется к складской себестоимости, если
  заполнена.
- Добавлена дозапись складских партий из раздела `Себестоимость`: берутся
  колонки `Закупка` и `Доставка до ФФ`; технические движения инвентаризации
  скрыты из пользовательской истории.
- Отгрузка со своего склада на WB переведена на тот же массовый UX: выбор
  нескольких SKU, количества, Excel для фулфилмента, FIFO-списание со своего
  склада и планирование коробов (`60x40x40` или свой размер, шт/короб,
  итоговое количество коробов).
- Раздел `/stocks-v2/batches` обновлён для производства и пути: массовый выбор
  SKU с фото, Excel шаблон/импорт партии, закупка по SKU и стартовый статус
  партии (`Заказано`, `Производство`, `В пути`, `Таможня`).
- Карточки статусов на `/stocks-v2` (`Скоро`, `Норма`, `Перезатарка`) стали
  кликабельными: раскрывают список SKU группы с фото, днями запаса, спросом,
  слоями остатков `WB / свой / производство / в пути` и рекомендацией.
- Технический фикс: примечание себестоимости для ручного прихода приводится к
  строке перед записью в движения склада.

**Checks:** targeted eslint ✅, `npx tsc --noEmit --pretty false` ✅,
`npm run build` ✅ locally and on production server, production
`/api/health` ✅. Deployed through `metric-pulse-app-01` with service restart.
Related commits: `9c95755`, `912c3db`, `cd6e6bc`, `0fa8301`, `34d8ef9`.

---

## 2026-05-11 · Sales plan MVP

- Добавлен отдельный простой раздел `/sales-plan`: склейка, период, план в штуках,
  средняя цена, сезон и целевой запас в днях.
- Добавлены таблицы `sales_plan_versions`, `sales_plan_lines`,
  `sales_plan_seasons` с tenant RLS и миграция `0072_sales_plan.sql`.
- `/overview` теперь показывает план-факт по активным планам за выбранный период.
- `/stocks-v2` использует активный план продаж как источник спроса для расчёта
  покрытия и закупки; история остаётся fallback, если плана нет.

**Checks:** `npm run db:migration:check` ✅, `npm run typecheck` ✅,
`npm run lint` ✅ with existing warnings outside the new sales-plan slice.
Local `npm run db:migrate` is blocked because Postgres `127.0.0.1:54322`
is not running.

---

## 2026-05-11 · Unit economics auto buyout column

- В юнит-экономике разделены ручной и автоматический процент выкупа:
  рядом с `Выкуп ручной` добавлена колонка `Выкуп авто`.
- Авто-выкуп используется в формулах только при 30+ днях истории SKU и наличии
  факта за выбранный период; для новых/коротких SKU расчёты идут от ручного
  выкупа.
- API шаблона юнит-экономики теперь отдаёт дни истории выкупа и даты первой/
  последней активности SKU.

**Checks:** `npm run test -- src/components/economics/row-summary.test.ts src/components/economics/tariff-helpers.test.ts` ✅,
`npx tsc --noEmit` ✅, `npm run build` ✅,
`git diff --check` ✅.

---

## 2026-05-11 · Finance management MVP

- Добавлен отдельный раздел `/finance` для управленческого финансового учета:
  обзор, журнал операций, счета и кассы, долги, план-факт.
- Добавлена миграция `0070_finance_management.sql` и Drizzle schema для
  `finance_accounts`, `finance_categories`, `finance_transactions`,
  `finance_debts`, `finance_budget_items` с tenant RLS.
- Раздел отделяет ДДС от P&L: кредиты, переводы и собственник не смешиваются
  с прибылью, но отражаются в движении денег.
- Добавлена проектная память `docs/knowledge/wiki/finance-management.md`.

**Checks:** `npm run typecheck` ✅, targeted eslint ✅,
`npm run db:migration:check` ✅, `npm run build` ✅,
`npm run knowledge:health` ✅, `git diff --check` ✅.
Local `npm run db:migrate` is blocked because Postgres `127.0.0.1:54322`
is not running.

---

## 2026-05-11 · Public landing brand and signup CTA

- Публичный лендинг выровнен с доменом `про-цифры.рф`: бренд в hero,
  header и metadata теперь `Про Цифры`.
- CTA для новых пользователей переведены на `/login?mode=signup`; вход для
  действующих пользователей оставлен отдельным `/login`.
- Страница `/login` получила отдельный режим регистрации, success/error
  сообщения и `autocomplete` для email/password.
- Улучшены mobile header и контраст тёмных блоков лендинга.

**Checks:** targeted eslint ✅, `git diff --check` ✅,
Playwright desktop/mobile smoke ✅, `npm run build` ✅
(existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).
Follow-up admin slice restored full `npm run typecheck` ✅.

---

## 2026-05-11 · Admin panel and billing backoffice plan

- Зафиксирован проект platform admin панели в `docs/ADMIN_PANEL_PLAN.md`.
- Решение: делать нативный `/admin` в текущем Next.js приложении, не
  смешивать platform-admin доступ с tenant-level ролями `owner/admin/viewer`.
- Описаны таблицы `platform_admins`, `plans`, `subscriptions`, `payments`,
  `billing_events`, `platform_audit_log`, entitlement layer и поэтапный MVP.
- Добавлена миграция `0069_platform_admin_billing.sql` и Drizzle schema для
  platform-admin и billing foundation.
- Добавлены `requirePlatformAdmin`, `recordPlatformAuditLog`,
  `resolveSubscriptionEntitlement`, `requireActiveSubscription`.
- Добавлены служебные команды `npm run billing:seed-plans` и
  `npm run admin:grant -- <local-user-id-or-email> owner`.
- Добавлен read-only backoffice `/admin`: сводка платформы, список клиентов,
  карточка tenant, список подписок, фильтры, пагинация и drilldown по платежам,
  sync runs и platform audit.
- В backlog добавлен active track `Platform admin + billing backoffice`.

**Checks:** targeted tests ✅, `npm run test` ✅,
`npm run db:migration:check` ✅, `npm run typecheck` ✅,
targeted eslint ✅, script syntax check ✅, `npm run build` ✅
(existing Sentry/Prisma/OpenTelemetry dynamic dependency warning),
`git diff --check` ✅. Local `npm run db:migrate` is blocked because
Postgres `127.0.0.1:54322` is not running.

---

## 2026-05-11 · Costs: full-cost source audit

- Старый вариант подписи доставки заменён на `Доставка до ВБ` в разделе
  себестоимости, юнит-экономике, согласованиях, Procifry-подсказках и Excel.
- Проверены расчёты дашбордов, склеек, PnL и детализаций: COGS/прибыль идут
  через полную себестоимость (`Итого за ед.`), а не через одну закупочную цену.
- `stocks-v2` для рекомендованной закупки теперь тоже берёт полную
  себестоимость единицы из раздела `Себестоимость`.
- В юнит-экономике разведены fallback-поля: `purchasePrice` остаётся закупкой
  для колонки `Товар закупка`, `costPrice/full_cost` остаётся полной
  себестоимостью для аналитики.

**Checks:** `npm run typecheck` ✅, `npm run test` ✅,
`npm run lint` ✅ (existing warnings), `git diff --check` ✅,
`npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Costs: parity with unit economics SKU controls

- Раздел `Себестоимость` выровнен с юнит-экономикой по управлению SKU:
  поиск по тому же SKU-пулу, выбор найденных, массовое скрытие, одиночное
  скрытие и панель `Скрытые` с массовым возвратом.
- Рабочий список SKU оставлен отдельным от массового скрытия: можно собрать
  нужные артикулы и включить `Только список`, не удаляя их из расчётов.
- `Доставка до ВБ` теперь раскрывается через блок складов: выбор до 12 складов,
  добавление склада из WB-списка с поиском и ввод доставки по каждому складу.
- Итоговая доставка до ВБ считается как средняя по выбранным складам, как в
  юнит-экономике.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅,
`git diff --check` ✅, `npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Costs: отдельный источник себестоимости

- Добавлен раздел `/costs` и пункт меню `Себестоимость`.
- Экран оставляет только рабочие поля затрат: закупка, доставка до ФФ,
  упаковка, фулфилмент, доставка до ВБ и итог за единицу.
- Добавлены поиск, фильтр `Все / Без себестоимости / Заполненные`, рабочий
  список SKU и режим `Только список`, чтобы убрать шум из десятков цветов/SKU.
- Сохранение идёт bulk-запросом в `unit_economics_manual_inputs`; закупочная
  цена дополнительно синхронизируется в `unit_economics_configs`.
- Дашборды уже читают полную себестоимость из этих же источников:
  закупка + доставка до ФФ + упаковка + фулфилмент + выбранная доставка до ВБ.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅,
`git diff --check` ✅, `npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Unit economics: массовая скидка WB

- Поле `Скидка WB` в шапке юнит-экономики теперь можно проставить во все SKU
  через `Проставить всем`.
- Значение записывается во все 4 ценовых сценария каждого SKU в текущей
  таблице, сохраняется в `unit_economics_manual_inputs` bulk-запросом и
  становится видимым в раскрытых сценариях/экспорте.
- Перед bulk-save очищаются отложенные локальные сохранения по тем же SKU,
  чтобы старый debounce не перезатёр новую скидку.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅,
`git diff --check` ✅, `npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Unit economics: массовый выбор и скрытые SKU

- В таблицу юнит-экономики добавлены чекбоксы выбора SKU и bulk-кнопка
  `Скрыть выбранные`, чтобы не убирать товары по одному.
- Добавлена кнопка `Выбрать найденные` для текущей выдачи поиска/фильтра.
- Панель `Скрытые артикулы` заменена с облака кнопок на компактный список с
  поиском, выбором нескольких SKU и массовым возвратом.
- Добавлена server action `toggleProductsVisibility` для массового
  скрытия/возврата SKU одним запросом.

**Checks:** targeted eslint ✅, `npm run typecheck` ✅,
`git diff --check` ✅, `npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Unit economics: ДРР/CPO/CPS + складская логистика

- Колонки `ДРР в заказах` и `ДРР в выкупах` перенесены перед
  `Маркетинг (внутренняя)`.
- `ДРР в заказах` стал ручным целевым процентом: при заполнении внутренний
  маркетинг считается как `ДРР × выручка в заказах`.
- `ДРР в выкупах`, CPO и CPS теперь считаются только от внутреннего маркетинга
  WB; внешний маркетинг, контент и прочие затраты остаются в валовой прибыли,
  но не попадают в рекламные метрики.
- Исправлен расчёт логистики WB для товаров больше 1 л: тарифы WB уже отдают
  базу/литр с коэффициентом склада, поэтому коэффициент больше не применяется
  повторно.

**Checks:** targeted vitest ✅, targeted eslint ✅,
`npx tsc --noEmit --pretty false` ✅, `git diff --check` ✅,
`npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Procifry: ИЛ/ИРП через approval + отдельный оператор

- Добавлен approval-required endpoint
  `POST /api/agent/v1/unit-economics-indices/action` с action type
  `unit_economics_indices_update` для заполнения ИЛ/ИРП
  (`localityIndexPercent`, `irpPercent`) в `economics-v2`.
- `/approvals` теперь умеет исполнять `unit_economics_indices_update` и писать
  execution audit; до approval значения не применяются.
- Report `cost_warehouse_delivery_config` расширен текущими полями
  `localityIndexPercent` и `irpPercent`, чтобы worker мог сначала прочитать
  текущее состояние, потом поставить заявку.
- В каталог actions добавлен `unit_economics_indices_update`.
- Добавлен отдельный worker `wb-procifry-operator` как единая точка постановки
  изменений в approval (без автоприменения).
- Добавлены runbook-документы:
  - `docs/WB_PROCIFRY_OPERATOR_ONBOARDING.md`
  - `docs/WB_PROCIFRY_ACCESS_REQUEST_FOR_DEVS.md`
- Обновлены docs/skill pack под новый action и воркера.

**Checks:** `npm test` ✅, `npm run typecheck` ✅, targeted eslint ✅,
`npm run build` ✅ (existing Prisma/OpenTelemetry warning).

---

## 2026-05-10 · Unit economics: полный каталог SKU

- `/api/views/economics-template` больше не ограничивает SKU активностью за
  последние 90 дней.
- Юнит-экономика снова берет полный `sku_pool`: `products`, ручные настройки,
  цены, остатки, paid storage, реклама, funnel, orders/sales/realization.
- Дополнительно в список добавляются все карточки из WB-кабинета (`nmID` из
  Cards List API), даже если по ним нет остатков, продаж и RAW-истории.
- Товары без активности/остатков добавляются как нулевые строки и уходят вниз
  сортировки; скрытые SKU не возвращаются обратно.

**Checks:** targeted eslint ✅, `npx tsc --noEmit --pretty false` ✅,
`git diff --check` ✅, `npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Unit economics: закрепление фото и заголовков

- В широкой таблице юнит-экономики слева закреплена только колонка `Фото`.
- Верхние заголовки остаются закрепленными сверху (`sticky top`) и двигаются
  по горизонтали вместе со своими колонками.
- Контейнер таблицы переведен на общий X/Y scroll, чтобы `sticky top` реально
  работал вместе с горизонтальной прокруткой.

**Checks:** targeted eslint ✅, `npx tsc --noEmit --pretty false` ✅,
`npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Procifry fulfillment/China stock approval action

- Добавлен approval-required endpoint
  `POST /api/agent/v1/fulfillment/action` с action type
  `fulfillment_stock_update`.
- Action доступен `wb-assortment-ops` и `wb-growth-manager`; без approval только
  создает заявку, реальные изменения применяются после подтверждения в
  `/approvals`.
- Approval executor заполняет `own_stock_batches` + `own_stock_movements` для
  остатков на ФФ/своем складе и `production_orders` +
  `production_order_lines` для партий из Китая в производстве/пути.
- `stocks_summary` после применения получает `ownStockQty` и
  `fulfillmentInTransitQty` из этих таблиц, а `fulfillment_summary` показывает
  строки партий.
- `/api/agent/v1/catalog` теперь отдает `fulfillment_stock_update` в
  `actions[]` с `approvalRequired=true`.

**Checks:** `npx vitest run src/server/agent/procifry-fulfillment.test.ts src/server/agent/procifry-warehouse-delivery.test.ts` ✅,
`npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-10 · Procifry warehouse delivery approval action для economics-v2

- Добавлен read report `cost_warehouse_delivery_config` для проверки текущего
  блока «Склады / доставка до ВБ» по `tenantId + nmIds`.
- Добавлен approval-required endpoint
  `POST /api/agent/v1/warehouse-delivery/action` с action type
  `warehouse_delivery_cost_update`.
- Action доступен `wb-economics-analyst` и `wb-growth-manager`, но без approval
  только создает заявку; economics-v2 меняется после подтверждения в
  `/approvals`.
- Approval executor теперь применяет batch-обновления в
  `unit_economics_manual_inputs.manual_fields`: отключает старые склады,
  включает новые и сохраняет `deliveryToWbPerUnit`; итоговая доставка считается
  как средняя по включенным складам.
- `/api/agent/v1/catalog` теперь отдает `actions[]` с
  `warehouse_delivery_cost_update` и `approvalRequired=true`.
- Обновлены Procifry worker docs/skill pack, чтобы агент не писал «заполнил»,
  если action недоступен или еще не approved.

**Checks:** `npx vitest run src/server/agent/procifry-warehouse-delivery.test.ts src/server/agent/procifry-training.test.ts src/lib/agent-api.test.ts src/server/agent/procifry-approval-cost.test.ts` ✅,
`npx tsc --noEmit` ✅, targeted eslint ✅, `npm run build` ✅.

---

## 2026-05-10 · Unit economics: выбор складов WB из списка

- `/api/views/economics-template` теперь возвращает список складов из WB-данных:
  observed stocks / stock offices / paid storage плюс warehouse names из тарифных
  снапшотов WB.
- В блоке складов юнит-экономики ручной ввод названия заменен на выбор склада
  из списка WB; выбранные новые склады сохраняются в существующем формате
  `customWarehouses`, чтобы не ломать расчеты и Procifry.
- Старые сохраненные склады остаются видимыми, чтобы уже заполненные карточки
  не потеряли подписи и стоимость доставки.
- Быстрый блок снова показывает 12 складов, теперь в порядке востребованности
  из WB-данных; полный список открывается по кнопке «Добавить склад».
- В полном списке добавлен поиск, выбранный склад можно убрать прямо оттуда
  или повторным кликом по быстрому складу.

**Checks:** `npx vitest run src/components/economics/warehouse-options.test.ts` ✅,
`npx tsc --noEmit --pretty false` ✅, targeted eslint ✅,
`npm run build` ✅ (existing Sentry/Prisma/OpenTelemetry dynamic dependency warning).

---

## 2026-05-10 · Procifry worker training pack и anti-hallucination evals

- Добавлен учебник [WB_PROCIFRY_AGENT_API.md](./WB_PROCIFRY_AGENT_API.md):
  алгоритм `catalog -> report -> freshness/dateCoverage -> вывод`, карта reports,
  worker-шпаргалки и шаблоны ответа при проблемах с данными.
- Добавлен core context [WB_PROCIFRY_SKILL_PACK.md](./WB_PROCIFRY_SKILL_PACK.md)
  для подключения всем WB-worker-ам.
- Добавлена machine-readable спецификация `src/server/agent/procifry-training.ts`:
  worker profiles, task -> worker -> report -> fields и обязательные eval cases.
- Добавлен тест `src/server/agent/procifry-training.test.ts`, который держит
  training spec в синхроне с `AGENT_REPORTS` и RBAC worker scopes.
- Добавлен smoke-скрипт `npm run smoke:procifry` для проверки `catalog` и
  ключевых reports по Лаврову/Бербеке без раскрытия API keys.
- `docs/AGENT_API_INTEGRATION.md` обновлен полным списком Procifry reports.

**Checks:** `npx vitest run src/server/agent/procifry-training.test.ts src/lib/agent-api.test.ts` ✅,
`npx tsc --noEmit` ✅, targeted eslint ✅, `node --check scripts/procifry-smoke.mjs` ✅,
`npm run build` ✅.

---

## 2026-05-10 · Procifry approvals: битый cost_update больше не блокирует решение

- `cost_update` parser теперь умеет восстановить `nmId` из названия товара
  вида `Браш-53 (144663672)`, если внешний worker прислал `nmId: 0`.
- Кнопка «Отклонить» в `/approvals` больше не зависит от `canExecute` и
  остается доступной для заявок с невалидным payload.
- Одобрение по-прежнему требует исполнимый payload; если восстановить `nmId`
  нельзя, заявку можно безопасно отклонить.

**Checks:** `npx vitest run src/server/agent/procifry-approval-cost.test.ts` ✅,
`npx tsc --noEmit` ✅, targeted eslint ✅.

---

## 2026-05-10 · Procifry dashboard summary: один день по кабинетам

- `POST /api/agent/v1/report` теперь поддерживает `dashboard_summary` с
  `params.tenantIds` и `params.multi_tenant=true`, чтобы WB Сборщик отчётов
  мог запросить сводку сразу по нескольким кабинетам.
- Однодневный запрос вида `dateFrom=2026-05-09`, `dateTo=2026-05-09`
  сохраняет `range.days=1` и больше не вынуждает сборщика уходить в default
  7-дневное окно.
- Ответ содержит суммарные KPI в `totals` / `data.totals` и разбивку по
  кабинетам в `data.cabinets[]`.
- Документация Agent API обновлена примером multi-tenant запроса за один день.

**Checks:** `npx vitest run src/server/agent/reports.test.ts` ✅,
`npx tsc --noEmit` ✅, targeted eslint ✅.

---

## 2026-05-08 · Dashboard PnL: логистика по дате исходного заказа

- В `raw_api_realization_reports` добавлено поле `srid`, чтобы строки
  реализации можно было связать с исходным заказом WB.
- Нормализация finance API, фоновые синки и backfill теперь сохраняют `Srid`
  из WB-отчета.
- `mv_daily_pnl_final` пересобрана: логистические строки без продажи
  переносятся на дату заказа из `raw_api_orders` по `Srid`; если связка не
  найдена, остается дата WB-отчета.
- Это убирает искажение дневной чистой прибыли, когда WB доначисляет
  логистику по заказам прошлых недель в текущий день.
- Дополнительно дозагружены заказы Лаврова с `2025-01-01`: WB Orders API
  вернул `49333` заказа. Оставшийся хвост `431` строк на `17749,53` — это
  логистика отмен/возвратов/брака, по которым WB не отдает заказ в orders API;
  они остаются на дате WB-удержания как единственной подтвержденной дате.
- По просьбе перепроверки заново скачаны все weekly realization Лаврова с
  `2026-01-01`: WB вернул `138336` строк. Расширенный backfill не нашел
  массовой связи хвоста с orders: точное совпадение отсутствует, нормализация
  `Srid` дает только `2` строки на `112,20`.
- API провала в расходы `/api/views/profit-report` переведен на
  `mv_daily_pnl_final` для логистики, payout и прибыли; raw WB оставлен только
  для расшифровки компонентов удержаний/штрафов.

**Checks:** `npm run typecheck` ✅, `npm run db:migration:check` ✅,
`npm run build` ✅, server build ✅, `npm run db:migrate` ✅,
backfill Лавров 2026-04-01..2026-05-08 ✅, orders backfill с 2025-01-01 ✅,
weekly backfill Лавров с 2026-01-01 ✅, server build ✅,
`getNetProfitBreakdown` logistics check ✅, `/api/health` ✅.

---

## 2026-05-08 · Dynamics: rename/delete product groups

- В разделе `/dynamics` добавлены действия управления склейкой:
  переименование выбранной склейки и удаление склейки.
- Удаление проходит через server action с `requireGroupAccess()` и удаляет
  только саму склейку; товары из справочника не удаляются.
- После переименования/удаления инвалидируются `productGroups` и `dynamics`,
  чтобы экран сразу подтягивал актуальный список.

**Checks:** `npm run typecheck` ✅, `npm run build` ✅.

---

## 2026-05-08 · Dashboard expenses drilldown: кликабельные статьи затрат

- В модалке «Провал в затраты» строки расходов стали кликабельными:
  выбранная статья подсвечивается слева, справа показывается контекст именно
  по ней.
- Правая панель теперь показывает источник поля, смысл статьи и как ее
  перепроверить в WB/БД.
- Для `Удержания WB` добавлена группировка причин по сохраненному
  `bonus_type_name`: WB Продвижение, кредитные списания, подписки, Джем и
  другие корректировки, с суммой, числом строк, отчетов и SKU.
- `WB Продвижение` теперь сворачивается в одну группу вместо отдельных
  карточек по каждому документу; кредитные списания показываются по кредитам с
  разбивкой на основной долг, проценты и всего.
- Для остальных статей выводится топ SKU по выбранному расходу, чтобы сразу
  видеть, какие товары дают основной вклад.

**Checks:** `npm run typecheck` ✅, `npm run build` ✅, server build ✅,
`/api/health` ✅.

---

## 2026-05-08 · Procifry autonomous advertising executor

- Добавлен agent endpoint `POST /api/agent/v1/advertising/action` для
  автономных рекламных действий без `/approvals`.
- Поддержаны действия: изменение ставок, исключение/возврат кластеров,
  массовая чистка рискованных кластеров, save/run/delete стратегий,
  pacing-правил и портфелей, пополнение рекламы с hard cap.
- Доступ ограничен worker-ами `wb-ads-analyst`, `wb-growth-manager`,
  `procifry-action-executor` и ролью `execute_approved_actions`.
- Каждое действие пишет строку в `procifry_agent_audit_log` с
  `resourceType=external_action`, `accessMode=executed`, `autonomous=true`.
- Добавлен env `PROCIFRY_AD_AGENT_MAX_DEPOSIT_RUB` для лимита автономного
  пополнения баланса.

**Checks:** `npm run test -- src/lib/agent-api.test.ts` ✅,
`npx tsc --noEmit` ✅, targeted eslint ✅, `npm run build` ✅.

---

## 2026-05-08 · Redistribution: новый UI «Что куда везти» (Этап 3 done)

Полностью переписан раздел `/redistribution` — старый клиент 1591 строка
заменён на простой UX «для школьника» по плану из
[`REDISTRIBUTION_REWRITE_PLAN.md`](./REDISTRIBUTION_REWRITE_PLAN.md). Auth v2
(Этап 1) и HTTP-миграция (Этап 2) — отдельные треки, серверная логика
`getRedistributionPlan()` и API endpoints не менялись.

**Структура нового экрана:**

- Заголовок «Что куда везти» + подзаголовок-объяснение, кнопка «Скачать
  Excel» в шапке (главное действие).
- 3 KPI-плитки вместо 8: «Сэкономите за месяц», «Перемещений», «Локализация
  X% → Y%». Без терминов КРП/ИРП/Snapshot/Priority Score.
- Блок «Статус робота» — читает из `tenants.wb_lk_*` через server action
  `getRobotSessionStatus()`. Тон зависит от свежести сессии: 🟢 готов,
  🟡 устаревает, 🔴 нужно перевойти. Тоном задаётся ясное действие.
- Карточки **топ-15** рекомендаций (вместо таблицы): размер, маршрут
  «откуда → куда», количество, сэкономит ₽/мес, прирост локализации,
  доплата WB до/после, покрытие в днях. Сортировка по приоритету.
- Образовательный блок: 4 шага «Как пользоваться» с конкретными
  инструкциями для кабинета WB (Конструктор тарифов → включить →
  Отчёт по остаткам → Перераспределить); памятка про комиссию 0.5%,
  72ч заморозки, 4-7 дней доставки, окна 09:00/12:00/16:00 МСК,
  лимиты складов.
- Свёрнутый блок «Расширенно» — placeholder для будущей RPA / Slot
  Monitor / Route Scan (после починки Auth v2).
- Excel-экспорт через ExcelJS: лист «Перевезти» (15 колонок: артикул,
  размер, откуда/куда, шт, сэкономит, локализация, доплата, покрытие)
  + лист «Как пользоваться» с 5-шаговой инструкцией. Filename:
  `redistribution_YYYYMMDD_HHMM.xlsx`.

**Новые/изменённые файлы:**

- `src/app/(dashboard)/redistribution/page.tsx` — server component (10
  строк, было 1591 строка клиентского монстра).
- `src/app/(dashboard)/redistribution/RedistributionPageClient.tsx` — новый
  чистый клиент (~430 строк).
- `src/app/(dashboard)/redistribution/redistributionExport.ts` — Excel-helper
  (~135 строк).
- `src/app/(dashboard)/redistribution/actions.ts` — server action для
  статуса робота (~70 строк).

**Что НЕ трогалось:**

- `src/server/analytics/redistribution.ts` (785 строк) — алгоритм
  donor-deficit, симуляция КРП — без изменений.
- API endpoints `/api/views/redistribution/*` — без изменений.
- Backend RPA infrastructure (slot-monitor / route-scan / redistribution-rpa)
  — без изменений, готов для будущей интеграции.

**Что осталось от плана:**

- Этап 1 (Auth v2): починить полный flow входа после anti-bot stealth
  (`cdb025c0` уже в проде, ждём ретест).
- Этап 2 (HTTP-миграция): нужен Network capture WB endpoints от пользователя.
- «Завести в WB автоматически» — сейчас в Advanced-блоке заглушка «в
  разработке». Появится когда Auth v2 + HTTP RPA будут готовы.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅.

---

## 2026-05-07 · Procifry approvals UI + cost_update executor

- Добавлена страница `/approvals` и пункт меню «Согласования» для заявок
  Procifry Agent API.
- Добавлены authenticated API routes:
  `GET /api/views/approvals`,
  `GET /api/views/approvals/:id`,
  `POST /api/views/approvals/:id/approve`,
  `POST /api/views/approvals/:id/reject`.
- `cost_update` approval теперь можно одобрить и применить: executor обновляет
  `unit_economics_manual_inputs.manual_fields` и
  `unit_economics_configs.cost_price`, ставит статус `executed` и пишет audit.
- Отклонение ставит статус `rejected` без изменения себестоимости.
- В UI показывается diff по SKU: текущие значения, предложенные агентом,
  итоговая дельта и сырой payload.

**Checks:** targeted vitest ✅, `npx tsc --noEmit` ✅,
targeted eslint ✅, `npm run build` ✅.

---

## 2026-05-07 · Procifry Agent API: external read sources connected

- Добавлены нормализованные read-only таблицы:
  `procifry_search_positions`, `procifry_competitor_cards`,
  `procifry_ab_tests`.
- `search_positions_summary`, `competitor_cards_summary`,
  `ab_tests_summary` теперь читают реальные persisted sources и в catalog
  идут как `available=true`.
- Пустой период больше не маскируется как недоступный report: API возвращает
  `ok=true`, `items=[]`, `sourceUpdatedAt` и `dateCoverage`.
- `advertising/dayparting` переведён на `withTenantContext`, чтобы Inngest не
  падал на RLS `uuid: ""` при чтении `advertising_dayparting_rules`.

**Checks:** `npm run db:migration:check` ✅, `npx tsc --noEmit` ✅,
targeted vitest ✅, `npm run test` 585/585 ✅, targeted eslint ✅,
`npm run build` ✅, `git diff --check` ✅.

---

## 2026-05-07 · Procifry Agent API: read-only catalog + worker reports

- Добавлен `GET /api/agent/v1/catalog`: список reports, поля, параметры,
  source tables, freshness и date coverage по tenant при наличии `tenantId`.
- `POST /api/agent/v1/report` расширен read-only отчётами для worker-ов:
  `stocks_summary`, `stock_history`, `oos_history`, `reviews_summary`,
  `questions_summary`, `card_content_summary`, `card_group_summary`,
  `price_history`, `advertising_campaigns`, `advertising_campaign_stats`,
  `finance_realization_detail`, `orders_sales_summary`, `fulfillment_summary`,
  `tariffs_rules_summary`, `worker_artifacts_summary`,
  `niche_category_summary`.
- Для `search_positions_summary`, `competitor_cards_summary`,
  `ab_tests_summary` контракт добавлен, но ответ явно помечает источник как
  неподключённый: в БД пока нет нормализованных таблиц позиций, конкурентов и
  A/B тестов.
- Добавлена серверная read-allowlist матрица worker → reports: Дима/Sasha/Growth
  видят all, остальные ограничены своим контуром.
- Для multi-tenant cost reports теперь требуется явный
  `params.multi_tenant=true`.

**Checks:** `npm run db:migration:check` ✅, `npx tsc --noEmit` ✅,
targeted vitest ✅, `npm run test` 584/584 ✅, `npm run build` ✅,
`git diff --check` ✅.

---

## 2026-05-07 · Dashboard: покрытие stock_sizes по SKU в проблемах склеек

- `/api/views/kpi-drilldown?metric=finance&groupId=...` теперь отдаёт
  `stockSizeAvailable` по каждому SKU: есть ли точная строка
  `raw_api_stock_sizes` в последнем снимке WB.
- Вкладка «Кто тянет вниз» показывает неполное покрытие stock_sizes:
  сколько SKU склейки покрыто точной SKU-разбивкой потерянных заказов,
  а сколько WB не вернул в `/stocks-report/products/sizes`.
- В колонке «Потери» SKU без `stock_sizes` показываются как `н/д`,
  чтобы не выдавать ноль за точный факт.

**Checks:** `npm run typecheck` ✅, `npm run lint` ✅,
`npm run test` ✅, `npm run build` ✅.

---

## 2026-05-07 · Settings: удалён старый WB ЛК блок + установка Chromium на проде

Жалоба пользователя: «Старый WB ЛК блок крутится и выдаёт ошибки
типа `browserType.launch: Executable doesn't exist`. Удали старый
блок, оставь только новый (auth v2)».

**Что сделано:**

1. **Установлен Chromium на проде** через `npx playwright install
   chromium` — корневая причина ошибки. После предыдущих деплоев
   `npm install` не подтягивал бинарник Playwright Chromium.
2. **Удалён старый UI-блок** «WB ЛК Доступ (RPA) · Ручное
   подтверждение по SMS» из Settings page (~145 строк):
   - Кнопки «Отправить» / «Подтвердить код» / «Простой вход: открыть
     CAPTCHA и войти»
   - Поля «номер телефона» + «SMS-код»
   - Ссылка на «Открыть экран серверного Chromium (noVNC)»
   - Ссылка на ручной вход в WB
   - Карточка `wbLkSessionFeedback` с результатом старого flow
3. **Заменено на компактную карточку «Вход в WB ЛК»** с одним
   компонентом `<WbLkAuthFlow>`:
   - Сохранён статус сессии сверху (если `wbLkSessionHealth` есть)
   - Краткое описание что делает робот
   - Одна кнопка → открывает модальный flow с inline CAPTCHA
   - Сохранённый номер показывается под кнопкой
4. **State и mutations старого flow остаются объявленными** в
   page.tsx (не блокируют сборку — `noUnusedLocals` выключен), но
   больше не отображаются в UI. В будущей чистке можно удалить
   `wbLkPhone`, `wbLkSmsCode`, `verifyWbLkSessionMutation`,
   `handleRequestWbSmsCode`, `handleConfirmWbSmsCode`,
   `handleInteractiveWbSessionCapture` и связанные.

**Checks:** `npx tsc --noEmit` ✅, `npm run test` 568/568 ✅, `npm run build` ✅.

---

## 2026-05-07 · WB ЛК Auth: интерактивный вход с inline CAPTCHA (auth v2 готов)

Шаги 1C+1D+1E плана auth v2 — полный end-to-end flow.

**Backend (1C):** `src/lib/wb-rpa/wb-lk-interactive-login.ts` — Playwright
flow с интеграцией auth-channel. Открывает Chromium, идёт на login,
заполняет телефон. В цикле детектит CAPTCHA / SMS / success:
- При CAPTCHA — `element.screenshot()` → push в channel как
  `{type: 'captcha_image', dataUrl}` → ждёт `awaitUserResponse`
  → fill + submit.
- При SMS — push `{type: 'sms_required'}` → ждёт `sms_code`.
- При success — `extractAndPersistWbTokenV3` + `persistStorageState` +
  обновление `tenants.wbLkSessionStatus = 'active'`.
- Поддерживает несколько раундов CAPTCHA в одной сессии.

**API endpoints (1D):**
- `POST /api/admin/wb-lk-auth/start` — принимает `{phone}`,
  создаёт session, запускает Playwright в background, возвращает
  `{sessionId}`.
- `GET /api/admin/wb-lk-auth/stream/[sessionId]` — Server-Sent Events
  стрим событий из channel: `event: status/captcha_image/sms_required/
  log/completed`.
- `POST /api/admin/wb-lk-auth/respond/[sessionId]` — POST с union
  `{type: 'sms_code'|'captcha_answer'|'cancel'}`, проксирует в channel.
- Все защищены `requireActiveTenant(['owner', 'admin'])` + проверкой
  что сессия принадлежит тенанту.

**UI (1E):** `src/app/(dashboard)/settings/WbLkAuthFlow.tsx` —
самостоятельный модальный flow:
- Кнопка «Войти в WB ЛК (с CAPTCHA в окне)» открывает модалку.
- Phase machine: `idle → starting → connecting → awaiting_phone →
  awaiting_captcha → awaiting_sms → finalizing → success/failed`.
- Подключается через `EventSource` к SSE-стриму.
- При phase `awaiting_captcha` — рендерит `<img src={dataUrl}>` с inline
  полем ввода и кнопкой «Отправить» → POST в `/respond`.
- При phase `awaiting_sms` — input с `autocomplete="one-time-code"` для
  6-значного кода.
- Лог событий под спойлером для отладки.
- Cancel при закрытии модалки чистит сессию на сервере.
- Интегрирован в Settings page как «🆕 Новый способ» (старый flow
  оставлен — ничего не сломано).

Что это даёт пользователю: первая жалоба «не пойму как пройти CAPTCHA»
закрыта — картинка появляется прямо в нашем UI. Жалоба «через 7 дней
вылетает» закрыта (1A). После успешного входа извлекается WBTokenV3 —
основа для будущей миграции операций на HTTP без Playwright (Этап 2).

**Что осталось от auth v2:**
- Этап 2: HTTP-клиент с Bearer WBTokenV3, миграция slot-monitor /
  route-scan / RPA операций на HTTP (340-500 строк).
- Этап 3: новый UI `/redistribution` (700-900 строк).

**Checks:** `npx tsc --noEmit` ✅ (наш код чистый), `npm run test`
568/568 ✅, `npm run build` ✅.

---

## 2026-05-07 · WB ЛК Auth: foundation для CAPTCHA flow + WBTokenV3

Шаги 1B и 1F плана auth v2 — backend-фундамент перед UI. Само
взаимодействие с Settings UI и Playwright login-flow придёт следующим
коммитом (1C+1D+1E).

**1B: In-memory channel** (`src/lib/wb-rpa/auth-channel.ts`)

Bidirectional message-bus между Playwright job и Settings UI через SSE.
EventEmitter per session, AsyncIterable для server-sent events,
Promise-based awaitUserResponse для обратной связи юзер → Playwright.

- API: `createAuthSession`, `getAuthSession`, `pushEvent`,
  `subscribeEvents`, `pushUserResponse`, `awaitUserResponse`,
  `closeSession`.
- Состояния: `connecting → awaiting_phone → awaiting_captcha →
  awaiting_sms → finalizing → success/failed`.
- События для UI: `status`, `captcha_image` (data URL), `sms_required`,
  `log`, `completed`.
- Ответы юзера: `sms_code`, `captcha_answer`, `cancel`.
- TTL сессии 30 мин, ответа 5 мин (defaults).
- Подписка на emitter происходит синхронно при `subscribeEvents()` —
  иначе события между созданием iterator и первым `.next()` теряются
  (фикс по результату упавших тестов).
- 11 unit-тестов, все проходят.

**1F: WBTokenV3 extraction** (`src/lib/wb-rpa/token-v3.ts`,
миграция `0065_wb_lk_token_v3.sql`)

WBTokenV3 — постоянный токен полного доступа к ЛК (не истекает
по WB design). После успешной авторизации извлекаем из cookies,
шифруем и сохраняем в БД для последующих HTTP-запросов в ЛК
без Playwright.

- `findWbTokenV3InCookies(cookies)` — pure-функция, ищет cookie с
  именем `WBTokenV3`.
- `extractAndPersistWbTokenV3(tenantId, context)` — снимает с живого
  Playwright context'а, шифрует тем же ключом что storage_state.
- `loadWbTokenV3(tenantId)` — для будущих HTTP клиентов.
- `clearWbTokenV3(tenantId)` — на случай logout.
- Schema: `tenants.wb_lk_token_v3` (text, encrypted),
  `wb_lk_token_v3_refreshed_at` (timestamptz).
- 6 unit-тестов на pure-helper.

**Checks:** `npx tsc --noEmit` ✅ (наш код, чужие test-only ошибки в
`rate-limit.test.ts` остаются), `npm run test` 568/568 ✅,
`npm run build` ✅.

---

## 2026-05-07 · WB ЛК Auth: убран жёсткий TTL 7 дней (сессия живёт пока живёт)

Корневая жалоба пользователя: «Через 7 дней сессия истекает — это
ненормально. В обычном браузере я зашёл по телефону и сессия не
вылетает». Расследование показало: TTL 7 дней — это **наша**
конфигурация в `storage-state.ts:14`, не WB. WB-куки сами по себе
живут гораздо дольше (с «Запомнить меня» — недели/месяцы).

Что изменилось:

- `STORAGE_STATE_TTL_DAYS = 7` → `STORAGE_STATE_HARD_TTL_DAYS = 90`
  (только для очистки древних сессий-мусора).
- Добавлены `STORAGE_STATE_STALE_DAYS = 30` для UI-warning «давно
  не обновлялось».
- Новая функция `getSessionFreshness(refreshedAt)` возвращает
  `{ageDays, status: 'fresh' | 'stale' | 'very-old' | 'missing'}`
  для прозрачного UI-статуса.
- `loadStorageStateSession()`: при истечении hard-TTL (>90 дней)
  сессия удаляется из БД (мусор не копится).
- Валидность сессии теперь — по реальному запросу в WB (Playwright
  сам падает с распознаваемой ошибкой), а не по нашему таймстампу.

Это первый шаг auth v2. Дальше: CAPTCHA via Screenshot+Input,
WBTokenV3 extraction, миграция RPA на HTTP.

**Checks:** `npx tsc --noEmit` ✅, `npm run test` 551/551 ✅, `npm run build` ✅.

---

## 2026-05-07 · Stocks 2.0: ИЛ теперь сходится с WB кабинетом до десятых

После средневзвешенной агрегации по `order_count` оставалось расхождение
~2 п.п. (наша 59.8% vs WB 62%). Корневая причина — **дневные слайсы в
funnel_stats**.

Диагностика на проде (tenant ИП Лавров, 8c5ec45d…):

```
period_start=05.02 .. period_end=07.05  (91 день, сводный)  → 72 SKU
period_start=07.05 .. period_end=07.05  (0 дней,  дневной)  → 58 SKU с loc=0
```

WB API для дневного отчёта `getDailyNomenclatureReport` отдаёт
`localizationPercent: 0` хардкодом (см. `wb-api/index.ts:1316`). Эти
записи попадают в БД с `localization_percent = 0` (не NULL), поэтому
фильтр `IS NOT NULL` их **не отсеивает**.

Когда у дневной и сводной записей одинаковый `period_end` (типичная
ситуация после свежего sync), `DISTINCT ON (nm_id) ORDER BY period_end
DESC` выбирает их **недетерминированно** (без secondary sort). В итоге
~29 SKU из 72 «теряли» свою настоящую локализацию и засчитывались как 0%.

Фикс — два условия в SQL:

1. `AND period_start::date <> period_end::date` — игнорируем дневные.
2. `ORDER BY nm_id, period_end DESC, period_start ASC` — secondary sort
   на случай, если в будущем тоже появится коллизия period_end.

Применено к двум SQL: главный агрегат и тренд за 13 недель.

Проверка на проде после фикса:

```
SELECT weighted_avg FROM (только сводные, period_start<>period_end):
   skus=72, plain_avg=45.8, weighted_avg=62.1, total_orders=23846
```

Это **точно** совпадает с WB кабинетом (62%).

**Checks:** `npx tsc --noEmit` ✅, `npm run test` 551/551 ✅, `npm run build` ✅.

---

## 2026-05-07 · Procifry Agent API: RBAC и approval-gate

- Существующий private Agent API расширен до Procifry RBAC: ключи теперь могут
  иметь `workerId`, `roles`, `tenantIds` и `cabinetOids`.
- Добавлен endpoint `/api/agent/v1/procifry`:
  - `POST` пишет безопасные artifacts/tasks/drafts/scenarios/recommendations и
    approval requests;
  - `GET` читает artifacts/approvals/audit по tenant + cabinet;
  - каждый запрос требует `worker_id`, `tenant_id`, `cabinet_oid`, период,
    `source`, `source_updated_at`, `confidence`, `access_mode`.
- Добавлена серверная worker-scope матрица для Димы/Ирины/Артёма/Вити/Оли и
  остальных ролей: воркер может писать только свои безопасные типы и только
  свои approval action types.
- Добавлены таблицы `procifry_worker_artifacts`,
  `procifry_approval_requests`, `procifry_agent_audit_log` с RLS и индексами.
- Прямое внешнее действие не выполняется через worker API: `external_action`
  требует `execute_approved_actions` и уже approved `approval_id`.
- Multi-tenant расчёт блокируется без явного `multi_tenant=true`.

**Checks:** `npm run db:migration:check` ✅, `npx vitest run src/lib/agent-api.test.ts` ✅,
`npx tsc --noEmit` ✅, `npm run test` 556/556 ✅, `npm run build` ✅.

---

## 2026-05-07 · Stocks 2.0: средневзвешенная локализация (фикс расхождения с WB)

Пользователь увидел в нашем интерфейсе ИЛ 37.1%, а в WB-кабинете —
больше 60%. Расхождение в 2 раза. Причина: я считал **арифметическое
среднее** локализации по SKU, тогда как WB показывает **средневзвешенное
по объёму заказов**. Если у популярных SKU высокая локализация, а у
мелких низкая — простое среднее ошибается в разы.

Пример:
- SKU «расческа» (1000 заказов, ИЛ 70%)
- SKU «новинка» (10 заказов, ИЛ 5%)
- Простое среднее: (70+5)/2 = 37.5% ← старая цифра
- Взвешенное: (1000×70 + 10×5)/1010 = 69.7% ← как у WB

Что изменилось:
- В SQL `localizationRows` добавлен `order_count`.
- `localizationByNm` теперь хранит `{pct, orders}` вместо просто `pct`.
- `avgLocalizationPercent` считается как `Σ(pct × orders) / Σ(orders)`.
  Если у всех SKU `order_count = 0` (свежий магазин без продаж),
  фолбэк на простое среднее, чтобы не вернуть NaN.
- В тренде (`localizationTrendRows`) — то же исправление: `SUM(pct ×
  orders) / SUM(orders)` вместо `AVG(pct)`. Под графиком в UI слово
  «среднее» оставлено в подсказке, но цифры теперь сходятся с кабинетом.
- Per-SKU `localizationPercent` в топ-10 не изменился — это уже была
  корректная per-SKU доля от WB.

**Checks:** `npx tsc --noEmit` ✅, `npm run test` 551/551 ✅, `npm run build` ✅.

---

## 2026-05-07 · Stocks 2.0: «Локализация» человеческим языком

Полностью переписаны тексты на странице `/stocks-v2/localization` —
из-под профжаргона WB (ИЛ, КРП, ИРП, «п.п.») вытащены человеческие
формулировки, понятные продавцу, который впервые открыл страницу.

- Подзаголовок: «Распределение остатков по федеральным округам · ИЛ
  → КРП» → «Сколько ваших товаров лежит рядом с покупателями — и
  сколько вы за это переплачиваете WB».
- Hero KPI: «Индекс локализации (ИЛ)» → «Заказы рядом с покупателем»;
  «КРП — сейчас» → «Доплата за дальность»; «До цели ≥ 60% / 29.3 п.п.»
  → «Сколько до бесплатной логистики / +29.3%». Под цифрой —
  пояснение «Из 100 заказов 30 закрываются ближайшим складом».
- Шкала КРП: «Шкала КРП — где мы сейчас» → «Сколько вы доплачиваете
  WB при разной локализации» + параграф объяснения.
- Таблица по ФО: «Спрос vs остатки по федеральным округам» → «Где у
  вас покупают и где лежат товары». Колонки переписаны: «Покупают тут»,
  «Лежит тут», «Разница», «Какие склады». Под таблицей: подсветка
  «Минус» розовым / «Плюс» голубым с описанием действий.
- Топ-10: «худшая локализация» → «которые везут дальше всех».
  Колонки: «Заказов рядом», «Доплата», «Заказов в день», «Лежит на WB».
- Тренд: «Динамика ИЛ» → «Как менялась локализация».
- Info-блок: пример с расчёской и сибирским покупателем; жаргон WB
  убран в скобки мелким шрифтом для тех кто читал справку.
- CTA: «План перераспределения» → «Что куда везти».
- Дашборд: хинт плитки «Локализация» — «ИРП = 0%» / «ИРП > 0%
  (платим за дальность)» → «WB не берёт доплату» / «платим WB
  доплату за дальность».

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅.

---

## 2026-05-07 · Stocks 2.0: динамика ИЛ за 13 недель

На странице `/stocks-v2/localization` появился график тренда ИЛ —
основная фича коммерческих сервисов (MPSTATS, Stat4Market) поверх
голого WB. Полезен потому что WB считает ИРП по 13-недельному окну,
и продавец должен видеть растёт/падает локализация.

- Новый SQL в `service.ts`: `WITH weekly_per_nm` берёт по каждому SKU
  последний снимок локализации в неделе (`DISTINCT ON (nm_id,
  date_trunc('week', period_end))`), затем `AVG()` по тенанту. Окно —
  последние 91 день (≈13 недель).
- Поле `localizationTrend: Array<{weekStart, ilPercent, nmCount}>`
  добавлено в `StocksV2Payload`.
- На UI: `<AreaChart>` из recharts (~3 КБ доп. JS, либа уже была в
  бандле для PnL/баланса). Шкала Y фиксируется до `max(60, max+5)`,
  чтобы цель ≥ 60% всегда была видна. Над графиком — Δ за период
  (зелёное при росте, розовое при падении). Tooltip показывает
  «X.X% (N SKU)».
- Если данных < 2 недель — корректный empty state с подсказкой.

**Checks:** `npx tsc --noEmit` ✅, `npm run test` 551/551 ✅, `npm run build` ✅.

---

## 2026-05-07 · Stocks 2.0: auto-mapping склад→ФО из БД

Хардкод-словарь `warehouse-fo.ts` теперь дополняется автоматическим
маппингом, построенным из реальных данных тенанта:

- Новый SQL в `service.ts`: для каждого склада определяем доминирующий
  регион заказов через `raw_api_stock_sizes` (по `SUM(orders_count)`),
  затем регион → ФО через `raw_api_region_sales`.
- Полученный `Map<office_name, fo_name>` используется как **override**
  для `resolveWarehouseFo()` — если склад нашёлся в БД, берём его
  оттуда, иначе fallback на хардкод-триггеры по названию.
- Результат: новые WB-склады, которых нет в хардкоде, автоматически
  попадают в правильный ФО как только у тенанта появятся заказы из
  этого склада. Хардкод остаётся защитой для холодного старта.

**Checks:** `npx tsc --noEmit` ✅.

---

## 2026-05-07 · Stocks 2.0: новый раздел «Локализация»

KPI-плитка «Локализация» на дашборде `/stocks-v2` вместо heatmap «По
складам» теперь ведёт на **отдельный экран `/stocks-v2/localization`** —
сфокусирован на ИЛ/КРП и распределении по федеральным округам.

**На странице:**

- Hero-панель с тремя KPI: текущий **ИЛ** (% локализации), **КРП**
  (надбавка к цене товара по сетке WB) и «до цели ≥ 60%».
- Шкала КРП — горизонтальная плитка из 11 шагов от `<5%→2.5%` до
  `≥60%→0%`. Подсвечивается текущий уровень.
- **Главная таблица «Спрос vs Остатки по ФО»** — по каждому ФО видно
  долю спроса (заказы из ФО), долю остатков (шт в этом ФО), Δ и
  раскрывающийся список физических WB-складов в округе. ЮФО+СКФО
  объединены в один регион «Юг» по правилам WB.
- Топ-10 SKU с худшей локализацией: артикул, бренд, % локализации, КРП,
  спрос/день, WB остаток.
- CTA «📦 План перераспределения» → `/redistribution` (там уже есть
  расчёт перемещений + симуляция КРП и экономии в рублях).
- Информационный блок: формула логистики WB после 23.03.2026,
  методика обновления (по понедельникам, окно 13 недель), ссылка на
  справку WB.

**Что изменилось в данных:**

- `StocksV2RegionRow.wbStockInDistrict` и `warehouseNames` (ранее были
  `0` / `[]` — TODO с этапа 5) теперь считаются: имя физ.склада →
  ФО маппится через новый словарь `warehouse-fo.ts` (триггеры по
  городам — ЦФО / СЗФО / Юг / ПФО / УФО / СФО / ДФО + СНГ для
  казахстанских / белорусских складов; неизвестное → 'Другие';
  виртуальные бакеты «В пути / Всего находится» исключаются).
- `regions[]` теперь объединяет ФО из обоих источников (спрос +
  остатки) — продавец видит даже округа где нет продаж, но есть
  остатки (или наоборот).
- В `StockSkuRow` добавлено поле `localizationPercent: number | null`
  (берётся из `funnel_stats.localization_percent`, последний снимок
  per nmId).
- `normalizeWbFoName()` — нормализует названия ФО из WB API (Юг и
  Северный Кавказ объединяются — у WB они считаются одним регионом
  для расчёта локализации).

**Бонус:** на этой же сборке поедет deploy-pending правка из
предыдущего коммита (`f1ddfd0` — сортировка колонок heatmap «По
складам» по убыванию остатков). На прод за один rebuild уходят обе
фичи.

**Checks:** `npx tsc --noEmit` ✅, `npm run test` 551/551 ✅, `npm run build` ✅.

---

## 2026-05-07 · Stocks 2.0: heatmap «По складам» — сортировка по остаткам

- Колонки в `/stocks-v2/by-warehouse` теперь упорядочены по убыванию
  суммарного остатка по всем SKU. Склады с нулевыми остатками уходят
  правее (но в группе с равной суммой остаются алфавитно). Виртуальные
  бакеты «В пути до получателей / возвраты на склад / Всего находится
  на складах» по-прежнему в самом конце.
- На скрине у пользователя 53 SKU с 68 складов: основная масса колонок
  была пустая и наполненные («Владивосток WB» и т.п.) терялись справа.
  Теперь они открываются первыми.
- Новый мемо `warehouseTotals` (Map<warehouseName, sum>); `allWarehouses`
  читает из него.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅.

---

## 2026-05-07 · Stocks 2.0: KPI плитки кликабельные

- 5 KPI-плиток на дашборде `/stocks-v2` (WB склады / Свой склад / В
  производстве / В пути / Локализация) теперь обёрнуты в `<Link>` и ведут
  в соответствующие подразделы:
  - WB склады, Локализация → `/stocks-v2/by-warehouse` (heatmap по физ.
    складам и распределение).
  - Свой склад → `/stocks-v2/own-stock`.
  - В производстве, В пути → `/stocks-v2/batches` (lifecycle партий).
- Добавлены hover-эффект (приподнятие, изумрудный border, лёгкая подсветка
  фона), focus-visible ring и `aria-label` для скринридеров.
- Изменения только в `Tile`-компоненте `StocksV2PageClient.tsx` — пропс
  `href` опционален; плитки без него остаются `<div>`.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅.

---

## 2026-05-07 · Dashboard: склейки только для анализа

- В `/overview` блок «Контекст дашборда» переведён в компактный режим:
  всегда видна только полоса выбора склейки с ключевыми статами, детали
  раскрываются по кнопке «Подробнее».
- Из дашборда удалено управление склейками: создание, переименование,
  добавление и удаление товаров. Управление оставлено в `/dynamics`,
  из раскрытого блока есть ссылка «Управление в динамике».
- Детальные вкладки в дашборде остались read-only: товары склейки,
  сравнение склеек, проблемные SKU, бренды / ABC.
- Фикс после прода: `/api/views/kpi-drilldown` больше не считает тяжёлую
  финразбивку заранее для всех метрик. Для finance/buyouts внутри склейки
  используется оптимизированная unit-economics выборка, чтобы вкладки
  «Кто тянет вниз» и «Бренды / ABC» не падали по statement timeout.
- Вкладки анализа склейки уточнены под SKU: «Кто тянет вниз» теперь
  показывает фото, WB-артикул, vendor code, маржу, рекламу, остаток и
  причину просадки; «ABC товаров» вынесена отдельно и показывает A/B/C
  на уровне SKU с действиями; «Бренды» вынесены в отдельный срез и не
  подменяют ABC.
- Плитка «Проблем» в контексте склейки стала кликабельной: раскрывает
  детали и открывает вкладку «Кто тянет вниз». Внутри добавлены карточки
  расшифровки флагов склейки: минусовая прибыль, низкий выкуп, высокий
  CPO или риск по остаткам.
- Риск по остаткам теперь раскладывается до SKU: `/api/views/kpi-drilldown`
  отдаёт потерянные заказы, сумму потерь и дни остатка из
  `raw_api_stock_sizes`; таблица «Кто тянет вниз» показывает эти колонки
  и поднимает товары с потерянными заказами выше обычной низкой отдачи.
- Если `raw_api_stock_sizes` не загружен и есть только общий флаг
  `stockRisk`, UI прямо показывает, что точной SKU-разбивки потерь нет,
  и оставляет список кандидатов по низкому остатку/дням/экономике.
- Для выбранной склейки добавлено сравнение периодов: текущий диапазон
  сравнивается с предыдущим равным диапазоном по выручке, прибыли,
  выкупу, рекламе, остаткам и потерям. API `/product-groups/summary`
  теперь отдаёт `previous`, `delta`, `deltaPct` и `comparisonPeriod`.
- `/api/views/kpi-drilldown?metric=finance&groupId=...` теперь отдаёт
  SKU-метрики `orders`, `buyouts`, `cancels` и `buyoutRate` из
  `raw_api_funnel_stats`, чтобы низкий выкуп был виден не только на
  уровне всей склейки.
- Вкладка «Кто тянет вниз» получила фильтры причин: все, минус, реклама,
  выкуп, остатки, потери и маржа. Карточки проблем стали кликабельными:
  по нажатию сразу открывается соответствующий SKU-срез с фото,
  артикулами, выкупом и конкретным действием по строке.
- Синк `stock_sizes` теперь сначала включает SKU из созданных склеек,
  потом дополняет кандидатов топом по продажам и остаткам. Дефолтный лимит
  поднят с 36 до 64 SKU, чтобы у склеек Лаврова была точная SKU-разбивка
  потерянных заказов, а не только общий флаг по складам.

**Checks:** `npm run typecheck` ✅, `npm run lint` ✅, `npm run test` ✅,
`npm run build` ✅.

---

## 2026-05-06 · P87 Этап 7 — Stocks 2.0 финал: Excel + cost helpers

Финальная (седьмая) фаза rewrite раздела «Остатки». Добавлены полезные
мелочи и pure-функции под cost distribution. **P87 → done**.

- **Excel-экспорт «Лист закупки»** на дашборде `/stocks-v2`. Кнопка
  «Скачать Excel» (рядом с «Перейти к партиям») — динамический импорт
  ExcelJS (~150 КБ только когда жмут), генерирует `.xlsx` с 14
  колонками (артикул, бренд, статус, остатки по слоям, спрос, дней
  хватит, рекомендация в шт + сумма, себестоимость, ABC). Сортировка
  critical-first, цветные строки (rose / amber для срочных и предупре-
  ждений), итоговая строка по дефицитным SKU. Файл
  `purchase-list_YYYYMMDD_HHMM.xlsx`.
- **Pure helpers** для cost distribution:
  - `distributeOverheadShare(lineGoods, allLinesGoods, lineQty,
    allLinesQty, overheadTotal)` — pro-rata распределение shipping +
    customs на одну line партии. По доле goods-value, fallback на
    долю qty при `allLinesGoods === 0`.
  - `computeLandedCostPerUnit(lineGoods, lineQty, overheadShare)` —
    итоговый per-unit cost с разнесённым overhead.
- **Inline-логика в `updateBatchStatus`** (Stage 3) заменена на эти
  helper'ы. Та же бизнес-логика, но теперь покрыта тестами и
  переиспользуема.
- **10 новых тестов** в `forecasting.test.ts` (общее 551, было 541) —
  edge cases: нулевой overhead, единственная line (получает 100%),
  пустые costs (fallback на qty), отрицательные/NaN-входы.
- **revalidatePath('/stocks-v2/by-warehouse')** добавлен во все
  mutation actions (createBatch / updateBatchStatus / deleteBatch /
  consumeOwnStock / adjustBatchInventory) — heatmap по физ.складам
  WB теперь обновляется автоматически при любых изменениях партий и
  собственного склада.

**P87 закрывается** — раздел «Остатки» полностью переписан с нуля по
запросу пользователя «должен разобраться школьник». Архитектура: 3
слоя данных (WB / свой / в пути), 4 экрана (дашборд / партии /
свой склад / heatmap), безболезненный onboarding через светофор-статус
и понятный план закупки в ₽.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 551/551 ✅.

---

## 2026-05-06 · P87 Этап 6 — снос legacy `/stocks`

Шестая фаза. После того как новый стек `/stocks-v2` собран целиком
(этапы 0-5: дашборд, партии, свой склад, heatmap), старая страница
`/stocks` со всем backend'ом удалена. Полная замена.

- **Удалены** ~3 200 строк legacy-кода:
  - `src/app/(dashboard)/stocks/page.tsx` + `StocksPageClient.tsx` (1041
    строка) + `actions.ts` (179 строк).
  - `src/app/api/views/stocks/route.ts`.
  - `src/server/analytics/stocks.ts` (`getStocksPlanner`, ~2000 строк).
- **Sidebar**: убран дубль «Остатки 2» из Этапа 2; единственный пункт
  «Остатки» теперь ведёт сразу на `/stocks-v2`.
- **Permanent redirect** `/stocks` → `/stocks-v2` (HTTP 308) в
  `next.config.ts` — старые закладки/ссылки продолжат работать.
- **Migration `0063_drop_stock_planning_inputs.sql`** удаляет таблицу
  `stock_planning_inputs` (была пуста в проде, миграция данных не
  нужна). Определение убрано из `src/lib/db/schema.ts` — оставлен
  комментарий-надгробие со ссылкой на новые таблицы.
- **Inngest cron `stock-alerts`** адаптирован под новые источники:
  - `ownStock` ← `SUM(remaining_quantity)` из `own_stock_batches`,
  - `inTransitChina` ← `SUM(quantity − received_quantity)` из
    `production_order_lines × production_orders` где status ∈
    `('shipped', 'customs')`,
  - `inProductionQty` ← то же где status ∈ `('ordered', 'in_production')`.

После Этапа 6 в кодовой базе нет ни одной ссылки на `stockPlanningInputs`,
`getStocksPlanner` или `/stocks` — всё на новом стеке.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 541/541 ✅.

---

## 2026-05-06 · P87 Этап 5 — Stocks 2.0: heatmap «По складам»

Пятая фаза. Раскладывает остатки WB по физическим складам в виде
heatmap-матрицы — показывает где какого товара сколько лежит и где
есть перекос для перераспределения (что напрямую влияет на ИРП).

- Новый роут `/stocks-v2/by-warehouse`. Использует существующий
  `/api/views/stocks-v2` endpoint без изменений — данные `wbStockByWarehouse`
  уже считались в Этапе 1.
- Heatmap: SKU в строках (sticky-колонка с фото и spec), физ.склады в
  колонках (Коледино, Электросталь, Тула…), горизонтальный скролл для
  длинного списка. Каждая ячейка раскрашивается по «дням запаса в этом
  конкретном складе» (qty / avgDailyDemand):
  - 🔴 красный — 0 шт при наличии спроса (склад пустой в этом регионе),
  - 🟠 амбер — менее 7 дней,
  - 🟢 emerald — 7-90 дней (норма),
  - 🔵 sky — больше 90 дней (затарка),
  - 🔘 серый — нет спроса вообще.
- Фильтры: Все / 🔴 Дефицит / 🔵 Затарка / ⚖ Перекос (max склад ≥ 5×
  min при общем количестве ≥ 10). «Перекос» — кандидаты на
  перераспределение для повышения локализации.
- Текстовый поиск по vendorCode / brand / nmId.
- Виртуальные buckets («В пути до получателей», «Всего на складах»)
  отсортированы в конец, чтобы реальные склады шли первыми.
- Дашборд получил третью header-кнопку «🗂 По складам».

После Этапа 5 у пользователя есть полный набор инструментов: дашборд →
партии → свой склад → распределение по физ.складам. Этап 6 — снос
старой страницы.

**Также фикс**: `OverviewPageClient.tsx:150` падал на `group.id` (TS
говорил group может быть undefined в onSuccess) — обернул в guard,
чтобы build не блокировал P87 деплой.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 541/541 ✅.

---

## 2026-05-06 · P87 Этап 4 — Stocks 2.0: свой склад (`/stocks-v2/own-stock`)

Четвёртая фаза. Подключаем UI для `own_stock_batches` +
`own_stock_movements` — теперь у продавца есть полноценный учёт того
что лежит у него физически: партии on-hand, история приходов и
расходов, FIFO-списание со ссылкой на причину.

- **Server actions** в `src/app/(dashboard)/stocks-v2/actions.ts`:
  - `listOwnStock` — партии с `remaining > 0` сгруппированные по SKU
    (totalRemaining, totalCost, raw partition list) с JOIN на products.
  - `listOwnStockMovements(limit=50)` — последние N движений.
  - `createManualReceipt({ nmId, quantity, costPerUnit?, notes? })` —
    создаёт `own_stock_batches` (sourceType='manual') + запись в
    movements (reason='receipt').
  - `consumeOwnStock({ nmId, quantity, reason, notes? })` — FIFO
    списание. Reason: `shipped_to_wb`, `fbs_sale`, `write_off`. Берёт
    партии по `received_at ASC`, обновляет `remaining_quantity`, пишет
    отрицательные movements. Валидирует что totalAvailable ≥ qty.
  - `adjustBatchInventory({ batchId, newQuantity, notes? })` —
    корректировка одной партии (после инвентаризации). Не разрешает
    выставить больше чем `received_quantity`. Дельта пишется в
    movements (reason='inventory_adjust').
- **UI**: страница `/stocks-v2/own-stock` с тремя секциями:
  - Заголовок с агрегатом (всего шт + ₽).
  - Список SKU on-hand: каждая карточка с фото / артикулом /
    остатком / себестоимостью; кнопка «Списать» открывает форму
    с выбором куда (WB/FBS/брак) + qty + notes; кнопка «N партии»
    раскрывает список конкретных партий с датой поступления, исходным
    qty, costPerUnit, и иконкой ✓ для inline-корректировки.
  - Журнал движений: лента с reason-бэйджами (зелёные приходы, красные
    списания, амбер инвентаризация), датой, артикулом, дельтой.
- **Manual receipt form** для ручного прихода SKU не из production_order
  (например, остаток с предыдущей закупки или находка).
- Дашборд получил два ярлыка-ссылки в header: «🏪 Свой склад» и
  «🌏 Партии» — для быстрого перехода без навигации через sidebar.

After this stage цикл «создать партию → провести по lifecycle → принять
→ увидеть на своём складе → списать на WB» работает end-to-end.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 541/541 ✅.

---

## 2026-05-06 · P87 Этап 3 — Stocks 2.0: партии (`/stocks-v2/batches`)

Третья фаза rewrite раздела «Остатки». Подключаем UI для существующих
в БД таблиц `production_orders` + `production_order_lines` — теперь
пользователь может создавать партии у поставщика, отмечать их прогресс
по lifecycle и при доставке автоматом получать запись на собственном
складе.

- **Server actions** в `src/app/(dashboard)/stocks-v2/actions.ts`:
  - `listBatches(tenantId)` — header + lines + JOIN с products для фото
    и vendorCode + аггрегаты totalQty / totalCost.
  - `createBatch(payload)` — создаёт header (title, supplier, currency,
    shipping, customs, ETA, tracking, notes) и N line items в одной
    транзакции. Validation: qty>0, nmId>0, минимум одна валидная line.
  - `updateBatchStatus(id, status)` — lifecycle ordered → in_production
    → shipped → customs → delivered, автоматически пишет timestamp.
    **При delivered**: помечает receivedQuantity = quantity на каждой
    line, создаёт `own_stock_batches` записи (одна per SKU) с pro-rata
    распределением shipping+customs на per-unit cost, плюс записи в
    `own_stock_movements` (reason=`receipt`).
  - `deleteBatch(id)` — каскадно удаляет lines, **запрещён** для
    delivered (нужно сначала списать со своего склада).
  - `listSkusForBatchForm(tenantId)` — список активных SKU (vendor /
    brand / photo) для автокомплита.
- **UI**: страница `/stocks-v2/batches` с двумя секциями («Активные» /
  «Доставлено»). Каждая карточка партии — timeline с 5 шагами (с галкой
  на пройденных), список SKU c per-line `qty × cost`, кнопки
  «следующий статус» (зелёная) и «удалить» (для не-delivered, красная).
  Inline-форма создания: title / supplier / currency / shipping /
  customs / ETA / tracking + многострочный список SKU с автокомплитом
  по vendorCode/brand/nmId + per-line qty + costPerUnit. Итог партии
  считается на лету: «N шт · X ₽ + доставка/таможня Y ₽».
- **Дашборд** теперь имеет рабочую кнопку «📦 Перейти к партиям» (вместо
  заглушки из Этапа 2).

После Этапа 3 при создании+delivered партии цифры «В производстве» и
«В пути» на дашборде ожиают уведомления через revalidatePath; при
delivered цифра «Свой склад» начинает заполняться через own_stock_batches.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 541/541 ✅.

---

## 2026-05-06 · P87 Этап 2 — Stocks 2.0: дашборд `/stocks-v2`

Новый роут `/stocks-v2` со страницей-дашбордом — первое визуальное в
рамках полного rewrite раздела «Остатки» (см. P87). Старая `/stocks`
параллельно живёт; в sidebar теперь два пункта: «Остатки» (старая,
amber) и «Остатки 2» (новая, emerald).

- **5 KPI tiles** в одном grid: WB склады (с расчётом «на ~N дней»
  через weighted-avg по демэнду), Свой склад, В производстве, В пути,
  Локализация (с подписью ИРП = 0% / > 0%).
- **«🔴 Срочно — закончится скоро»** — карточка с топ-8 SKU статуса
  `critical`. Каждая строка: фото, артикул, остаток на WB, спрос/день,
  «На X дней», рекомендованное количество к закупке + сумма в ₽.
  Внизу сводка: N SKU · X шт · Y ₽. Кнопка «Создать партию» disabled
  до Этапа 3.
- **3 status counters** под critical-блоком: warning / ok / overstock
  с понятными подписями («Покрытия меньше N дней»).
- **Regions strip** — bar-чарт доли спроса по федеральным округам.
- **Footer**: худший SKU по daysLeft (если есть critical) + информер
  про следующие этапы.

UI собран на семантических токенах темы (bg-card, text-foreground,
*-foreground/-muted/-border) — корректно работает в light/dark.

Сценарии edge case обработаны: пустой response (OperatorState
«Остатков пока нет»), 0 critical SKU («Дефицита нет — все SKU закроют
lead-time»), отсутствие cost_price (показываем «себест. не задана»
вместо ошибки).

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 541/541 ✅.

---

## 2026-05-06 · Dashboard KPI enhancements

Добавлены KPI из итогового аудита без раздувания сетки новыми карточками:

- «Заказы»: добавлен средний чек (`orderSum / orders`).
- «Выкупы»: добавлена прибыль на 1 выкуп (`netProfit / buyouts`), процент
  выкупа оставлен в бейдже карточки.
- «Реклама»: добавлен CPO (`ad spend / attributed ad orders`), если WB
  отдаёт рекламные заказы.
- «Остатки WB»: добавлены потерянные заказы/сумма и запас/оборачиваемость
  из последнего WB stock analytics snapshot (`raw_api_stock_sizes`, fallback
  на `raw_api_stock_offices`). `lostOrders` нормализуется по модулю, потому
  что WB может отдавать потерю отрицательным знаком.
- Уточнены подписи: «Расходы и удержания», «ROI по чистой прибыли»,
  «Локализация, наша оценка».

**Checks:** `npm run typecheck` ✅, `npm run build` ✅, `npm run lint` ✅.

---

## 2026-05-06 · P87 Этап 1 — Stocks 2.0: backend сервис

Новый сервис `getStocksV2(tenantId, opts)` собирает данные для 4-х
будущих экранов раздела «Остатки». Архитектурно — три слоя
availability'а на каждый SKU: `wbStock` + `ownStock` + `inProduction` +
`inTransit` = `totalAvailable`.

- **Pure-форкастинг** в `src/server/analytics/stocks-v2/forecasting.ts`:
  EWMA-демэнд, sample std dev, safety stock = Z×σ×√L (ISM formula),
  ROP = avgDaily×lead+safety, days-left, светофор-статус,
  recommendQty/cost, ABC-классификация (Pareto 80/95 с top-1 always A),
  Z-score per bucket (2.33/1.65/1.28 → 99/95/90 % service level).
- **Сервис** `src/server/analytics/stocks-v2/service.ts` параллельно
  пуллит 8 query (products + cost_price JOIN, raw_api_stocks,
  own_stock_batches, production_order_lines+orders, raw_api_funnel_stats
  daily, raw_api_realization_reports revenue, raw_api_region_sales, и
  funnel localization_percent). Строит per-SKU rows + KPI agg +
  региональный расклад с долей спроса по федеральным округам.
- **API route** `GET /api/views/stocks-v2?targetDays=30&leadTimeDays=46&
  demandPeriodDays=30`. Старый `/stocks` пока работает на старом стэке —
  заменим в Этапе 6.
- **Тесты:** 35 новых кейсов в `forecasting.test.ts` — ступени, граничные
  значения (NaN, 0%, single-item ABC), сравнения Z-score'ов.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 541/541 ✅
(было 506).

---

## 2026-05-06 · Dashboard KPI E2E audit

Зафиксирован полный аудит текущих KPI дашборда: формулы в коде, WB-источники,
GitHub/OpenAPI-практика, статус `OK / conditional`, риски и рекомендации.

- Добавлен документ
  `docs/audits/DASHBOARD_KPI_E2E_AUDIT_2026-05-06.md`.
- В `getNetProfitBreakdown` исправлена отдача `taxBaseRevenue` и
  `payoutBeforeCost`: SQL уже считал поля, но не выбирал их в результат.
- Provisional tail в breakdown больше не использует грубый fallback
  `15% + 50 ₽`; теперь берёт исторический payout-ratio по SKU, как KPI.

**Checks:** `git diff --check` ✅, `npm run build` ✅, `npm run lint` ✅.

---

## 2026-05-06 · P87 Этап 0 — Stocks 2.0: миграции БД

Закладка под полный rewrite раздела «Остатки» (см. P87 в backlog). Задача
от пользователя: «должен разобраться школьник», старая вкладка не нужна.
Решено собирать с чистого листа на трёх слоях: WB / свой склад / партии в
пути.

- **`production_orders`**: убраны per-SKU поля (`nm_id`, `quantity`,
  `cost_per_unit`, `total_cost`) — header теперь чистый. Добавлены
  `title`, `currency`, `shipping_cost`, `customs_cost` (распределяются
  на line items пропорционально). Это позволяет одной партии содержать
  много SKU как в реальном карго-контейнере.
- **`production_order_lines`** (новая) — одна строка = один SKU в партии,
  с `received_quantity` для partial receipts (часть приняли, остаток в
  пути).
- **`own_stock_batches`** (новая) — учёт партий на собственном складе.
  Immutable `received_quantity` + decreasing `remaining_quantity`. FIFO/
  FEFO списание делается через `own_stock_movements`.
- **`own_stock_movements`** (новая) — журнал поступлений и расходов с
  reason: `receipt | shipped_to_wb | fbs_sale | write_off |
  inventory_adjust`. Audit trail для всего что происходит на складе.

Миграции `0061_production_orders_multi_sku.sql` +
`0062_own_stock_batches.sql`. Legacy `createProductionOrder` server action
адаптирован под header + одна line — для совместимости со старым `/stocks`
UI, который снесём в Этапе 6.

В проде на момент миграции `production_orders` и `stock_planning_inputs`
обе пусты, поэтому миграция данных не нужна.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, vitest 506/506 ✅.

---

## 2026-05-06 · Dashboard — SPP fallback теперь по снимкам WB-карточек

В ходе аудита SPP выяснилось: за выбранный период показатель считается
правильно из финального WB-отчёта (`spp_rub / (revenue + spp_rub)`), но
fallback без финданных опирался на `raw_api_prices.spp`. У WB это поле
часто приходит `0`, поэтому fallback мог показывать ложный ноль.

- KPI fallback переключён на последний слот `raw_api_price_snapshots`:
  если снимок получен через публичную карточку WB, берём `implied_spp`,
  иначе fallback на `spp` из API цен.
- Добавлен ручной операторский скрипт
  `scripts/snapshot_spp.ts`: получает цены кабинета, публичные цены WB
  по `card.wb.ru/cards/v4/detail`, пишет `raw_api_prices` и
  `raw_api_price_snapshots` для всех кабинетов или одного `--tenant-id`.

**Checks:** `node_modules/.bin/tsx --check scripts/snapshot_spp.ts` ✅,
`npm run build` ✅.

---

## 2026-05-06 · P86 — реальный объём WB per nmId из warehouse_remains

Колонка «Литраж факт. WB» в `/economics-v2` для части SKU (особенно
комбо-упаковок типа «Малышки - черная/розовая») показывала 0.50 л, тогда
как в кабинетной xlsx-выгрузке WB та же позиция шла как 1.17 л. Эндпоинт
`/api/analytics/v1/warehouse-measurements`, на который мы опирались, для
комбо-SKU часто пустой.

Подключили `/api/v1/warehouse_remains` (асинхронный отчёт «Остатки на
складах») — он отдаёт авторитетный `volume` per nmId, идентичный
xlsx-выгрузке. Эмпирически проверено пробником: для тестового кабинета
все 54 SKU вернулись с правильным объёмом в 1-2 секунды polling-а.

- `wb-api/index.ts:getWarehouseRemains(token, { groupByNm })` — task →
  poll (4s × 30 max) → download. Парсит `{ nmId, volume, warehouses[] }`.
- Schema: `products.wb_warehouse_volume_liters NUMERIC(8,3)` +
  `wb_warehouse_volume_updated_at TIMESTAMPTZ`. Миграция
  `drizzle/0059_products_wb_warehouse_volume.sql`. `WB_SYNC_SOURCE_SEQUENCE`
  расширен (17 → 18 источников) — `warehouse_remains` попадает в nightly
  sync автоматически.
- Sync step `sync-warehouse-remains` в `inngest/sync-wb.ts` — после
  `sync-stocks`. WB rate-limit ~1 task/min per token, поэтому шаг
  изолирован: если WB вернул ошибку, общий sync продолжается.
- API view `/api/views/economics-template`: новый helper
  `getWbWarehouseVolumeByNm` читает свежий объём из `products`. Приоритет:
  `products.wb_warehouse_volume_liters` → `warehouse-measurements`
  fallback → `null`. Подсветка колонки в UI заработает автоматически.
- Тесты `wb-sync-sources.test.ts` обновлены под новое число источников.

Чтобы данные начали приходить — нужен один проход sync-warehouse-remains
после деплоя; функция уже подключена в существующий nightly profile.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, `vitest` 506/506 ✅.

---

## 2026-05-06 · P85 — авто-ИРП из WB localizationPercent

ИРП больше не нужно вбивать руками для активных SKU. WB endpoint
`/api/analytics/v3/sales-funnel/products` отдаёт
`statistic.selected.localizationPercent` per nmId — берём оттуда долю
локальных заказов, прогоняем через официальную сетку из справки WB
(>=60% → 0; <5% → 2.5%) и подставляем как ИРП. Ручной ввод сохраняет
приоритет (индивидуальные условия с WB).

- **Sync:** `WbFunnelItemSchema` + `getNomenclatureReport` парсят
  `selected.localizationPercent`. Daily-funnel пишет 0 (DETAIL_HISTORY это
  поле не отдаёт).
- **БД:** колонка `raw_api_funnel_stats.localization_percent NUMERIC(6,2)`,
  миграция `drizzle/0058_funnel_localization_percent.sql` + journal entry.
- **API view:** `/api/views/economics-template` через
  `getLocalizationPercentByNm` (DISTINCT ON по `period_end DESC`)
  подмешивает свежий localization per nmId в каждую строку.
- **Расчёт:** новая функция `resolveIrpFromLocalization` в
  `economics/constants.ts` (клиентская копия серверной
  `redistribution.ts:resolveKrpByLocalization`). `row-summary.ts` теперь
  даёт `irpPercent` через приоритет manual > auto > 0, плюс новые поля
  `irpPercentSource` и `localizationPercent` в `RowSummary`.
- **UI:** в форме «ИРП для расчёта логистики МП» рядом с инпутом
  показывается chip `«авто 2.50% (WB локализация 8%)»` зелёным когда
  значение auto, серая подпись `«WB локализация 62%, авто = 0%»` когда
  пользователь ввёл своё, амбер `«нет данных WB — введите вручную»`
  для SKU без funnel-данных. Placeholder инпута тоже показывает
  auto-значение.
- **Тесты:** 7 новых кейсов в `row-summary.test.ts` (ступени, manual
  override, FBS-зануление, null vs 0% локализации). Существующий тест
  funnel mapping расширен новым полем.

Чтобы данные начали приходить в БД — нужен один проход WB sync funnel
после деплоя; функция уже подключена в существующий nightly/medium sync.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, `npm run test` ✅
(505/505).

---

## 2026-05-06 · /economics-v2 — UX-полировка и фикс лагов

Три точечные правки по фидбэку пользователя после формульного аудита.

- **Подсветка «Литраж факт. WB»:** ячейка краснеет, если WB замерил
  объём больше, чем у нас в карточке (мы переплачиваем за логистику),
  и зеленеет, если WB меньше карточки. При совпадении — без подсветки.
- **Подсветка колонки «Выкуп» у новых SKU:** если у товара нет истории
  выкупов (и продавец не ввёл процент вручную) — `summary.buyoutPercent`
  становится 0, и ячейка теперь подсвечивается жёлтым. Это явный сигнал
  «введите процент вручную для прогноза», иначе расчёт логистики
  использует только forward-плечо без reverse и сильно занижается.
- **Фикс лагов мыши/ввода в таблице:** `buildRowSummary` (тяжёлая
  pure-функция, ~330 строк вычислений на одну строку) ранее вызывался
  прямо в `filteredRows.map(...)` на каждом ререндере. На 100-200 SKU
  это давало заметные подвисания при keystroke и hover. Заменили на
  предвычисленный `summariesByNm: Map<nmId, RowSummary>` через
  `useMemo([filteredRows, manualFieldsCache, summaryDeps])` — теперь
  пересчёт идёт только когда реально меняются входные данные.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, `npm run test` ✅
(498/498).

---

## 2026-05-06 · /economics-v2 — два формульных фикса по итогам аудита

В ходе сверки всех ~50 колонок таблицы юнит-экономики с пользователем
обнаружено два расхождения с ожидаемой бизнес-логикой; остальные формулы
подтверждены как корректные (среднее по складам для логистики/хранения,
расчёт «к оплате на р/с» от `priceBeforeWb` как компенсация СПП, выручка
в заказах от `priceBeforeWb`, наценка до СПП как коэффициент).

- **Эквайринг 3% (`acquiring_3` и `acquiring`):** база смещена с
  `sellerPriceBeforeDiscount` (исходная цена ДО скидки продавца) на
  `priceBeforeWbDiscount` (после скидки продавца, до WB). Та же база, что у
  комиссии WB. Эквайринг становится меньше на величину скидки продавца.
  Hint в `columns.ts` синхронизирован.
- **Прибыль с вложенного рубля % (`invested_rub_profit_percent`,
  `summary.batchProfitabilityPercent`):** делитель смещён с
  `batchCostPriceTotal` (только закупка × qty) на `batchCostTotal`
  (`fullCost × qty` = с доставкой/упаковкой/фулфилментом). Соответствует
  hint и общему смыслу «прибыль на вложенный рубль партии».

Тесты `row-summary.test.ts` обновлены: ожидания `acquiring`,
`marketplacePlusStorageTotal`, `toSettlementAccount`, `revenueAfterTax`
пересчитаны на новую базу; добавлен новый тест
`batchProfitabilityPercent against batchCostTotal`.

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, `npm run test` ✅
(498/498).

---

## 2026-05-06 · Dashboard auto-refresh after WB sync

- Added conservative dashboard fallback refresh every ~5 minutes while the overview tab is open, with per-tab jitter to avoid synchronized request spikes.
- Added lightweight sync-run polling: about every 60 seconds normally, about every 15 seconds while a sync is pending/running; when the latest sync finishes, the dashboard query is invalidated immediately.
- Forced dashboard client fetches to `cache: no-store` and enabled refetch on window focus/reconnect, so an open tab does not sit on stale React Query data.
- Renamed the top dashboard button from “Синхронизировать с WB” to “Обновить дашборд”, because it refreshes the screen and does not start a WB sync job.
- Made buyout rate visible as a separate line in the “Выкупы” KPI card instead of only a small inline badge.
- Aligned buyout-rate calculation with WB funnel semantics: buyouts divided by closed outcomes (`buyouts + cancels/rejections`) instead of all placed orders, because recent open orders are not final yet.
- Clarified conversion labels across the dashboard: the metric is now named “Просмотр → заказ” and explicitly means orders divided by WB card views.
- Fixed dashboard localization semantics: KPI now uses the latest meaningful redistribution snapshot before the selected period end, and daily chart uses the latest snapshot per day instead of averaging manual/empty runs.
- Clarified stock KPI display: “in way” is now split into `to client / from client`, matching WB stock snapshot fields and avoiding one opaque transit number.

**Checks:** `npm run typecheck`, `git diff --check`.

---

## 2026-05-06 · WB paid-storage sale date alignment

- Fixed Finance API normalization for paid-storage postings: rows with only `paidStorage` are shifted by one WB report day so `sale_dt` matches the date shown in weekly detailed XLSX reports.
- Resynced Berbeka `raw_api_realization_reports` for `2026-01-01..2026-05-06` after the fix and refreshed `mv_daily_pnl_final`.
- Reconciled Berbeka weekly detailed reports again: storage now matches WB XLSX exactly, `319 251.95 ₽`.

**Checks:** `npm run test -- src/lib/wb-api/index.test.ts`, `npm run typecheck`, `npm run build`, production `/api/health`.

---

## 2026-05-06 · WB paid storage sync hardening

- Removed `paid_storage` from the frequent 2-hour medium sync profile; the source remains available in nightly/manual full sync and in the dedicated historical backfill script.
- Capped regular `paid_storage` sync to a short rolling window, default `8` days via `WB_PAID_STORAGE_SYNC_LOOKBACK_DAYS`, so scheduled sync does not re-run the full 91-day nightly range.
- Added an abortable source timeout for `paid_storage`, default `600000` ms via `WB_PAID_STORAGE_SOURCE_TIMEOUT_MS`, so a stuck WB task-flow is finalized through the existing retained-snapshot recovery instead of hanging forever.

**Checks:** `npm run typecheck -- --pretty false`, `git diff --check`.

---

## 2026-05-06 · P83 Slice 11 — снят монолит `UnitEconomicsTemplateTable`

Завершение декомпозиции P83. После того как `/economics-v2` стабильно отработал
в проде (saving / fetching / dark theme — Slices 0-10), легаси-монолит удалён
полностью.

- Удалены: `src/components/dashboard/UnitEconomicsTemplateTable.tsx` (4178 строк),
  `unit-economics-template-helpers.ts`, его vitest-файл, `EconomicsTemplatePageClient.tsx`
  и весь каталог `src/app/(dashboard)/economics-template/`.
- 12 групп тестов helpers перенесены без изменений сигнатур в
  `src/components/economics/helpers.test.ts` (все функции уже жили в новом
  стеке как `economics/helpers.ts`).
- В `next.config.ts` добавлен permanent (HTTP 308) redirect
  `/economics-template` → `/economics-v2` — для закладок и SEO.
- `/economics` теперь редиректит сразу на `/economics-v2` (был двойной hop
  через `/economics-template`).
- Sidebar: убран дублирующий пункт «Юнит-экономика 2». Остался один
  «Юнит-экономика» → `/economics-v2`.
- `revalidatePath('/economics-template')` заменён на `/economics-v2` в
  `economics/actions.ts` (3 места) и `settings/actions.ts` (1 место).

**Checks:** `npx tsc --noEmit` ✅, `npm run build` ✅, `npm run test` ✅ (496/496,
+5 относительно Slice 10 за счёт перенесённых helper-тестов).

---

## 2026-05-06 · WB ads history API backfill hardening

- Optimized WB advertising cost history allocation by extracting `nmId` from campaign names when WB names start with an article id, avoiding unnecessary campaign-detail API calls.
- Added `--source auto|fullstats|history` to `scripts/backfill_ads_costs.ts`, so cost-history reconciliation can explicitly use WB history API instead of `fullstats`.
- Wrapped ads and paid-storage backfill writes in tenant RLS context, so production RAW inserts/deletes run under the correct cabinet scope.
- Normalized ad history order-weight SQL bounds to ISO timestamptz strings for postgres-js compatibility.
- Deduplicated WB ad history rows by `tenantId + nmId + date + placement` before upsert, summing same-day costs so both the manual backfill script and scheduled sync cannot hit the same conflict key twice.
- Capped WB `stock_offices` / `stock_sizes` analytics sync to the latest 31-day window inside wider backfills, matching WB API limits and preventing `excess limit on days` failures.

**Checks:** `npx --yes tsx scripts/backfill_ads_costs.ts` usage smoke, `npm run typecheck`, `git diff --check`.

---

## 2026-05-05 · Weekly WB finance reconciliation fixes

- Reconciled 10 Lavrov weekly detailed WB Excel reports against production `raw_api_realization_reports`.
- Confirmed rows, quantity, buyer-paid revenue, seller-discount price, `ppvz_for_pay`, storage, penalties, deductions, acquiring, returns, and acceptance match WB exports.
- Fixed Finance API import mapping: `delivery_rub` now stores only WB delivery service; `rebillLogisticCost` is added to `additional_payment` as compensation instead of being mixed into logistics.
- Fixed Finance API cashback mapping: WB weekly export's loyalty compensation comes as `cashbackDiscount`, with `cashbackAmount` left at zero in current payloads.
- Normalized Finance API `saleDt` timestamps to WB date-only values before persistence, so boundary rows match weekly Excel exports instead of moving across month edges through timezone conversion.
- Brought manual realization backfill and the legacy finance job in line with the main sync, including cashback/acceptance/percentage fields on upsert.
- Aligned daily PnL advertising source selection with KPI cards: if `raw_api_ad_costs` exists for the period, daily rows no longer mix in `raw_api_ad_clusters` fallback days.
- Added an expenses drill-down modal on the dashboard with exact expense buckets, WB report fields, CSV export, and top-SKU expense rows.
- Added the drill-down entry point directly to the top KPI `Затраты` card, so users do not have to scroll to the lower expenses section.
- Added drill-down modals for already verified top KPI cards: `Заказы`, `Выкупы`, and `Финансы`, with totals and SKU-level rows for the selected period.
- Aligned profit-report advertising source selection with KPI cards so expense drill-down uses the same ad total as the main dashboard.
- Unblocked the release lint gate by replacing two synchronous `setState`-in-effect patterns in economics helper UI with derived state.

**Checks:** `npm run lint`, `npm run typecheck`, targeted `npm test -- src/lib/wb-api/index.test.ts`, `npm run build`.

---

## 2026-05-05 · /economics-v2 — финальный фикс «данные пропадают» (P83)

После Slice 9 (`b8f5e8f`, flush-on-unmount) пользователь продолжал терять
ручные правки при переходе с `/economics-v2` на дашборд и обратно. Разбор
с диагностическими логами показал две независимые причины:

1. **Next.js App Router soft-navigation НЕ размонтирует компонент**
   `EconomicsTable` при клике на пункт sidebar — `useEffect cleanup` для
   flush-on-unmount никогда не срабатывал в этом сценарии. Последние
   500 мс ввода (debounce) терялись.

2. **TanStack Query кэшировал прошлый ответ** API
   `economics-template-v2` (queryKey тот же) и при возврате на страницу
   мгновенно отдавал stale-snapshot. Bootstrap-effect в `EconomicsTable`
   парсил эти устаревшие `manualInputsByNm` и **затирал свежий
   localStorage** старыми значениями — пользователь видел «откат».

Фиксы (`2a2d8d27` + `cc3a28c7`):

- В `EconomicsTable.tsx` добавлены listener'ы `visibilitychange`
  (срабатывает при soft-nav когда страница уходит из видимой области)
  и `pagehide` (browser close / hard nav). Оба триггерят немедленный
  flush всех pending `queueManualFieldsSave` / `persistCostPrice` —
  без отмены debounce-таймеров. Старый unmount-handler сохранён как
  финальная страховка.
- В `EconomicsV2PageClient.tsx` для `useQuery` явно выставлены
  `staleTime: 0`, `refetchOnMount: 'always'`, `refetchOnWindowFocus:
  'always'` — каждый возврат на страницу гарантированно делает свежий
  fetch до того, как bootstrap прочитает данные.

Подтверждено в проде: записи в `unit_economics_manual_inputs` /
`unit_economics_configs` совпадают с тем, что показывает UI после возврата
на страницу. Диагностические `console.log` убраны — оставлены только
`console.error` на падении сохранения и `logger.error` на сервере.

**Checks:** `tsc --noEmit` ✅, `npm run build` ✅. Деплой
`metric-pulse-app-01`, проверка `/api/health` ✅.

---

## 2026-05-05 · Switch realization sync to WB Finance API

- Replaced deprecated `GET /api/v5/supplier/reportDetailByPeriod` usage with `POST /api/finance/v1/sales-reports/detailed`.
- Added camelCase Finance API normalization back into the existing internal `raw_api_realization_reports` shape, keeping PnL formulas and storage schema unchanged.
- Kept weekly report periodicity by default and preserved `rrdId` pagination.

**Checks:** targeted `npm run test -- src/lib/wb-api/index.test.ts`, `npm run typecheck`, targeted `npm run lint -- ...`, `npm run test`, `npm run build`.

---

## 2026-05-05 · Restore WB payout profit formula

- Reverted the erroneous net-profit operating base change from seller-discount price back to the original WB payout formula: `ppvz_for_pay` first, then the existing fee fallback.
- Left the tax base unchanged: `tax_base_revenue = retail_amount`, i.e. buyer-paid amount after WB discount.
- Rebuilt `mv_daily_pnl_final` through migration `0055_daily_pnl_restore_wb_payout_profit`.

**Checks:** `npm run db:migration:check`, `npm run typecheck`, targeted `npm run lint -- ...`, `npm run test`, `npm run build`.

---

## 2026-05-05 · Split tax base and profit base

- Restored tax base to buyer-paid `retail_amount` after WB discount.
- Changed net-profit operating base to seller-discount price: `retail_price_withdisc_rub` first, fallback to `retail_amount`.
- Rebuilt `mv_daily_pnl_final`: `tax_base_revenue` and `payout_before_cost` now intentionally use different WB bases.

**Checks:** `npm run db:migration:check`, `npm run typecheck`, targeted `npm run lint -- ...`, `npm run test`, `npm run build`.

---

## 2026-05-05 · Seller-discount base for net profit

- Superseded by the next entry: tax base stays `retail_amount`; seller-discount price is used only for net-profit operating base.
- `tax_base_revenue` for WB realization rows now uses `retail_price_withdisc_rub` first, falling back to `retail_amount` only when WB does not provide the seller-discount price.
- Rebuilt `mv_daily_pnl_final` with the same `sale_dt` day grouping, but with seller-discount tax base.
- Realization backfill and scheduled finance sync now persist `retail_price_withdisc_rub`, so manual catch-up runs do not lose the seller-discount price.
- AУСН detail auto-calculation is aligned back to `retail_price_withdisc_rub`.

**Checks:** `npm run db:migration:check`, `npm run typecheck`, targeted `npm run lint -- ...`, `npm run test`, `npm run build`.

---

## 2026-05-05 · Excel-экспорт и импорт для юнит-экономики v2 (`0e659d4`)

Добавлены полноценный Excel-экспорт и импорт для страницы `/economics-v2`:

- **Экспорт «Скачать Excel»**: 3-листовая рабочая книга ExcelJS.
  - Лист «Данные» — все ~70 колонок, заголовки покрашены по группе (9 цветов),
    ячейки ввода выделены жёлтым, чередующиеся строки, формат `#,##0.00`,
    автофильтр, закреплена первая строка.
  - Лист «Данные для ввода» — 31 колонка для импорта (15 ручных полей +
    4 ценовых сценария × 4 поля). Строка 1 = машиночитаемые ID (7pt, серые),
    строка 2 = русские заголовки (жирные), данные с 3-й строки.
  - Лист «Справочник формул» — русские формулы + реальные ссылки на ячейки
    Excel (например `=J2+K2+L2+M2+N2` для `full_cost`) для верификации расчётов.
- **Импорт «Загрузить Excel»**: разбирает лист «Данные для ввода» по ID-строке,
  обновляет `manualFieldsCache` и сохраняет в localStorage + PostgreSQL через
  `persistManualFieldsForNm`. Пустые ячейки пропускаются (не затирают данные).
- Развёрнуто на `metric-pulse-app-01`, порт 3457, SHA `0e659d4`.

## 2026-05-05 · Модульная таблица юнит-экономики — полировка после Slice 5 (P83)

Серия багфиксов и UX-правок поверх Slices 0-5, по живому фидбеку с продакшна:

- **Slice 6 (`6e01682`) — UX-полировка тёмной темы.** Manual-инпуты переведены
  на amber-alpha (`bg-amber-500/15` + `border-amber-500/50`) — видны и в
  light, и в dark, без зависимости от приглушённого compat-shim'а
  `bg-amber-50`. Активная строка усилена до `bg-emerald-500/15` + 4 px
  emerald-полоса слева на photo-ячейке (быстро видно активный SKU).
  Detail-панели больше не растягиваются по всей ширине 80 колонок: внутренний
  контент `position: sticky; left: 0; max-width: min(1280px, 100vw - 120px)`,
  карточка остаётся в видимой viewport-области при горизонтальной прокрутке.

- **Slice 7 (`a3a7eaf`) — inline-инпуты + restore + сценарии-строки.**
  Активная строка теперь редактируется прямо в ячейках: cost_price,
  delivery_to_ff, packaging, fulfillment, buyout, marketing_internal/external,
  content_cost, other_costs, cpo/cps_plan, purchase_qty_total, turnover_days
  становятся `<NumberInput>` без открытия sub-панели — как в монолите.
  Кнопка «Вернуть» в `HiddenProductsPanel` теперь сразу убирает SKU из
  локального списка скрытых, родитель вызывает `router.refresh()` для
  обновления основной таблицы. **Финансовая деталь возвращена к схеме
  монолита**: вместо 5-вкладочной `FinancePanel` по клику на «Цена»
  вставляются 4 строки сценариев (excellent / good / average / poor), каждая
  со своим набором полей цены/скидок/выкупа и read-only вычислениями под
  свой scenarioId. `FinancePanel.tsx` удалён.

- **Slice 8 (`e5391fa`) — hide-SKU «глазик».** В колонке Фото каждой строки
  появилась маленькая красноватая кнопка `EyeOff`: confirmation → server
  action `toggleProductVisibility(tenantId, nmId, true)` → SKU исчезает из
  таблицы и расчётов. Замыкает цикл «скрыть/посмотреть скрытые/вернуть».
  Photo-колонка расширена 80 → 100 px под кнопку + 40 px изображение.

- **Slice 9 (`b8f5e8f`) — критфиксы.** (1) Manual-сохранения теряли последние
  500 мс ввода при быстром переходе со страницы: unmount-cleanup отменял
  таймеры через `clearTimeout` без выполнения. Перестроил структуру timer-ref
  на `Map<nmId, { timeout, payload }>` и заменил cancel на **flush** —
  pending saves теперь синхронно выстреливают через `queueManualFieldsSave` /
  `persistCostPrice` перед размонтированием. (2) Sticky-колонка Фото имела
  `z-40` на `<th>` и `z-20` на `<td>` — это перекрывало sidebar при
  expanded-состоянии (label «Фото» торчал поверх боковой навигации).
  Понизил до `z-20` (header) и `z-[5]` (cell).

Status: P83 закрыт по бизнес-фичам, монолит `/economics-template` ещё не
снят (Slice 10 — редирект `/economics-template → /economics-v2` + удаление
`UnitEconomicsTemplateTable.tsx` — отложен до отдельной сессии после
наблюдения за стабильностью v2 в проде).

**Checks:** `tsc --noEmit` ✅, `npm run build` ✅, tests 491/491 ✅.

---

## 2026-05-05 · Realization sale_dt and AУСН tax base

- Added `sale_dt` to WB realization rows and ingestion so weekly reports can be attributed to the actual sale day instead of the report week `date_from`.
- Updated the realization backfill script to write `sale_dt` and run through explicit RLS tenant/admin context.
- Rebuilt `mv_daily_pnl_final` to group final finance data by `sale_dt` with fallback to `date_from` until rows are resynced.
- Changed WB realization tax base for revenue-based regimes to `retail_amount` per the current business rule: tax is calculated from the amount paid by the buyer in our source data, not from `retail_price_withdisc_rub`.
- AУСН detail auto-calculation now uses `retail_amount` for realization detail rows.
- Waiting for the user's April weekly Excel realization reports to finish final reconciliation against WB exports.

**Checks:** `npm run db:migration:check`, `npm run typecheck`, targeted `npm run lint -- ...`, `npm run test`, `npm run build`.

---

## 2026-05-05 · Daily PnL MV refresh under strict RLS

- Fixed `mv_daily_pnl_final` refresh after realization sync: strict RLS requires the admin tenant sentinel while rebuilding the materialized view.
- Manual production refresh restored April finance KPI source data for `ИП Лавров`.

**Checks:** `npm run typecheck`, `npm run lint -- src/inngest/sync-wb.ts`, `npm run test`, `npm run build`.

---

## 2026-05-05 · Dashboard buyouts source alignment

- `Выкупы` KPI now uses the exact WB funnel snapshot for units whenever full selected-period funnel coverage is available, matching `Сумма выкупов` and `Выкуп %` source semantics.
- This prevents the card from mixing finance/tail PnL units with WB funnel ruble amount.

**Checks:** `npm run typecheck`, `npm run lint -- src/server/analytics/services/economics.ts`, `npm run test`, `npm run build`.

---

## 2026-05-04 · Dashboard KPI grouping and buyout sum

- Overview KPI cards are now grouped by business meaning: `Финансы`, `Затраты`, `Маржа`, `Заказы`, `Выкупы`, `Реклама`, `Хранение`, `Остатки WB`, `Диагностика`, `SPP WB`.
- Composite KPI cards now show signed top/bottom values instead of unlabeled numbers.
- `buyoutSum` is now exposed in the dashboard KPI payload so the `Выкупы` card can show both units and buyout amount.

**Checks:** `npm run typecheck`, `npm run lint -- src/components/dashboard/KPICards.tsx src/server/analytics/services/economics.ts`, `npm run test`, `npm run build`.

---

## 2026-05-04 · Модульная таблица юнит-экономики — Slice 4 + Slice 5 (P83)

### Slice 4 — паритет с монолитом (`9bf04a8`)

`/economics-v2` догнал монолит `/economics-template` по фичам:
- **Toolbar:** input глобальной скидки WB; кнопка «Пересчитать себестоимость»
  (`recalculateCostPriceEverywhere`); кнопка «В цвета модели (N)» открывает
  `VariantPickerModal` (выбор SKU той же модели по `buildVariantFamilyKey`)
  и копирует ручные поля + `costPrice` через `saveUnitEconomicsManualFields` +
  `updateCostPrice`; кнопка «Экспорт Excel» — динамический импорт ExcelJS,
  3 листа (`Юнитка_данные` / `Колонки_для_правок` / `Формулы_для_правок`).
- **Warehouses-панель:** добавлен сабпанель «Склады: логистика и хранение WB»
  с per-warehouse карточками (имя WB-тарифа, логистика до/от клиента, возврат
  продавцу, хранение) и сводками: средняя логистика, среднее хранение,
  средний возврат, выкуп для расчёта МП, поле ИРП. Расчёт ставок вынесен
  в pure-функцию `computeWarehouseRates()` (`warehouse-rates.ts`).
- Новые модули: `VariantPickerModal.tsx`, `excelExport.ts`,
  `warehouse-rates.ts`. Утилита `normalizeFamilyToken` экспортирована из
  `utils.ts`.

### Slice 5 — тёмная тема (`86fbf00`)

Перевод модульной таблицы на семантические токены, которые уже определены
в `globals.css` через `:root` / `.dark`:
- `bg-white` → `bg-card`
- `bg-slate-50/...` → `bg-muted/...`
- `bg-slate-100` → `bg-muted`
- `text-slate-{7,8,9}00` → `text-foreground`
- `text-slate-{5,6}00` → `text-muted-foreground`
- `border-slate-{1,2,3}00` → `border-border`

Удалены gradient-stops с `to-white` (в dark давали белые пятна): заменены на
плоские tinted-фоны (`bg-emerald-50` / `bg-amber-50` / `bg-indigo-50` /
`bg-sky-50`), для которых compat-shim в `globals.css` уже даёт `.dark`
overrides. Saturated-бордеры приглушены (`border-emerald-200/80` →
`border-emerald-500/30`), backdrop модалки `bg-slate-900/60` →
`bg-foreground/30` — работает в обеих темах.

Монолит и `/economics-template` не тронуты.

**Checks:** `tsc` ✅, `npm run build` ✅, tests 491/491 ✅.

---

## 2026-05-04 · Dashboard cache invalidation for hidden SKU changes

- Hidden SKU changes now invalidate the dashboard cache and `/overview`, so KPI cards that exclude hidden products (`Заказы`, `Сумма заказов`, funnel-derived metrics) do not keep stale values after hiding or restoring products from Economics.

**Checks:** `npx eslint src/app/(dashboard)/economics/actions.ts src/app/(dashboard)/settings/actions.ts`, `npm run build`.

---

## 2026-05-04 · Data freshness banner coverage fix

- Fixed `DataFreshnessBanner` false partial-coverage warning: the banner now loads enough sync history and prefers a usable sync run that actually covers the selected analytics range instead of only checking the latest hourly one-day fast sync.

**Checks:** `npm run build`, `npx eslint src/components/dashboard/DataFreshnessBanner.tsx`. Full `npm run lint` is currently blocked by pre-existing issues in `src/components/economics/table/HiddenProductsPanel.tsx` and `src/components/economics/table/EconomicsTable.tsx`.

---

## 2026-05-01 · Модульная таблица юнит-экономики — Slice 3 (P83)

Раскрывающиеся панели деталей активного SKU.

- **`SkuMetaBlock.tsx`** — компактная мета-полоса (бренд, артикул WB, ШК,
  артикул продавца, селектор схемы FBW/FBS); зеркалит `renderSkuMetaBlock`
  из монолита (~строки 2594-2647).
- **`WarehousesPanel.tsx`** — редактор выбора складов (до `MAX_WAREHOUSES`),
  ввод стоимости доставки до каждого склада, ручной редактор склада,
  «Очистить склады», расчёт средней доставки до маркетплейса. UI-only состояние
  (открытость панели, draft нового склада) живёт внутри компонента; данные
  меняются через `onUpdate(nextManualFields)`. Зеркалит панель складов
  монолита (~строки 3851-3991).
- **`FinancePanel.tsx`** — финансовый редактор с 5 вкладками:
  - **fact** — фактические продажи (read-only).
  - **costs** — себестоимость, доставка до ФФ, упаковка, фулфилмент, ИРП;
    `costPrice` сохраняется в БД отдельно через `updateCostPrice` по `onBlur`.
  - **price** — 4 ценовых сценария (`excellent` / `good` / `average` / `poor`)
    с собственными `RowSummary` через `buildScenarioSummary`, переключатель
    активного сценария, селектор схемы FBW/FBS.
  - **pnl** — постатейный P&L за 1 единицу.
  - **batch** — закупка, оборачиваемость, маркетинг, контент, прочие, CPO/CPS
    + батч-итоги.
  Все формулы — verbatim из `RowSummary`/`buildRowSummary` (без изменений).
- **`EconomicsTable.tsx`** обновлён:
  - Placeholder-строка деталей удалена; вместо него — `SkuMetaBlock` +
    `WarehousesPanel` (для `detailMode === 'warehouses'`) или `FinancePanel`
    (для `detailMode === 'finance'`).
  - Клик по «Артикул WB» → `toggleDetailForRow('warehouses', nmId)`.
  - Клик по «Цена» → `toggleDetailForRow('finance', nmId)`.
  - Тот же режим на активной строке → сворачивает (`detailMode = null`).
  - Live-редактирование `manualFields`: localStorage сразу,
    `saveUnitEconomicsManualFields` debounced 500 мс через `manualSaveQueueRef`
    (последовательная запись по nmId), `costPrice` debounced 500 мс отдельно
    через `updateCostPrice`.
- **`index.ts`** — barrel-реэкспорт `SkuMetaBlock` / `WarehousesPanel` /
  `FinancePanel`.

Монолит `UnitEconomicsTemplateTable.tsx` и страница `/economics-template`
не тронуты.

**Checks:** `tsc --noEmit` ✅, `npm run build` ✅, tests 491/491 ✅.
Браузерная проверка: dev-сервер компилирует `/economics-v2` без ошибок;
страница auth-gated, маршрут редиректит на `/login` (ожидаемо). Полный
prod-build проходит компиляцию каждого роута, включая `/economics-v2`.

---

## 2026-05-01 · Модульная таблица юнит-экономики — Slices 0-2 (P83)

### Slice 0 — building blocks (`66ac61c`)

Создан каталог `src/components/economics/table/` с самодостаточными модулями,
которые являются фундаментом для постепенного замещения монолита
`UnitEconomicsTemplateTable.tsx` (4 178 строк):

- **`columns.ts`** — полная схема 80 столбцов (`COLUMNS`), маппинг формул
  (`COLUMN_FORMULA_HINTS`), набор разделителей групп
  (`STRONG_GROUP_SEPARATOR_COLUMNS`), хелперы `resolveStrictWidthClasses` /
  `normalizeColumnLabel`.
- **`utils.ts`** — `compareBySellerArticle`, `buildVariantFamilyKey`,
  `resolveWbVolumeLiters`, `createEconomicsExportFileName`.
- **`cellValue.ts`** — чистая функция `resolveCellText(columnId, row, summary,
  manualFields) → string | INTERACTIVE_COLUMN` для всех 80 id.
- **`NumberInput.tsx`** — переиспользуемый amber-стилизованный ввод.
- **`HiddenProductsPanel.tsx`** — панель со списком скрытых SKU + «Вернуть».
- **`TableHeader.tsx`** — sticky `<thead>` с tooltip-подсказками формул.
- **`index.ts`** — barrel-реэкспорт.

### Slices 1-2 — EconomicsTable + /economics-v2 (`7d8ae80`)

- **`EconomicsTable.tsx`** — новый модульный компонент:
  - 80 столбцов read-only через `resolveCellText` + `TableHeader`.
  - Тулбар: поиск, 4-режимный фильтр, сброс, панель скрытых, счётчик.
  - Активная строка с highlight; `HiddenProductsPanel` подключён.
  - Тариф-карты строятся из `acceptanceTariffs` / `returnTariffs`.
  - Ручные поля инициализируются из `manualInputsByNm`, затем localStorage.
  - Placeholder-строка деталей SKU (Slice 3 подключит склады + финансы).
- **`EconomicsV2PageClient.tsx`** обновлён: теперь рендерит `EconomicsTable`
  вместо монолитного `UnitEconomicsTemplateTable`.
- Монолит на `/economics-template` не тронут.

**Checks:** `tsc --noEmit` ✅, `npm run build` ✅, tests 491/491 ✅.

---

## 2026-05-01 · Модульная таблица юнит-экономики — Slice 0 (building blocks)

Commit `66ac61c`.

Создан каталог `src/components/economics/table/` с самодостаточными модулями,
которые являются фундаментом для постепенного замещения монолита
`UnitEconomicsTemplateTable.tsx` (4 178 строк):

- **`columns.ts`** — полная схема 80 столбцов (`COLUMNS`), маппинг формул
  (`COLUMN_FORMULA_HINTS`), набор разделителей групп
  (`STRONG_GROUP_SEPARATOR_COLUMNS`), хелперы `resolveStrictWidthClasses` /
  `normalizeColumnLabel`.
- **`utils.ts`** — `compareBySellerArticle`, `buildVariantFamilyKey`,
  `resolveWbVolumeLiters`, `createEconomicsExportFileName`.
- **`cellValue.ts`** — чистая функция `resolveCellText(columnId, row, summary,
  manualFields) → string | INTERACTIVE_COLUMN` для всех 80 id; покрывает ту же
  логику, что `renderReadOnlyCell` в монолите, без зависимости от React/DOM.
- **`NumberInput.tsx`** — переиспользуемый amber-стилизованный ввод для ручных
  полей.
- **`HiddenProductsPanel.tsx`** — панель со списком скрытых SKU + кнопка
  «Вернуть»; прямой перенос из монолита с чистой сигнатурой пропсов.
- **`TableHeader.tsx`** — sticky `<thead>` с tooltip-подсказками формул из
  `COLUMN_FORMULA_HINTS`; принимает опциональный `columns` override.
- **`index.ts`** — barrel-реэкспорт всех модулей.

Монолит не тронут; `/economics-template` и `/economics-v2` работают как раньше.

**Checks:** `tsc --noEmit` ✅, tests 491/491 ✅.

---

## 2026-04-30 · Юнит-экономика 2 — новый двухпанельный UI (маршрут /economics-v2)

- Создан новый маршрут `/economics-v2` с полностью новым UI поверх ранее извлечённого pure-logic фундамента (`buildRowSummary`, `types.ts`, `helpers.ts` и др.).
- Добавлены компоненты: `EconomicsShellV2` (главный shell), `ProductList` (левая панель со списком SKU + поиск), `ProductHeader` (шапка детальной панели).
- Добавлены 5 вкладок с полным покрытием всех 71 колонки legacy-таблицы:
  - `TabFact` — фото, габариты, фактические продажи, выкупаемость (read-only)
  - `TabCosts` — ввод себестоимости, выбор и настройка складов
  - `TabPrice` — 4 ценовых сценария с редактированием, переключение FBW/FBS, активный сценарий
  - `TabPnL` — расчётный P&L по активному сценарию (комиссия, логистика, хранение, маржа, рентабельность)
  - `TabBatch` — партийный расчёт, маркетинговые расходы
- Хук `useManualFields` — debounced-сохранение в localStorage + server action с задержкой 500 мс. При смене товара состояние сбрасывается по React-паттерну setState-during-render (без setState в useEffect).
- Добавлен пункт «Юнит-экономика 2» в сайдбар → `/economics-v2`.
- Старый маршрут `/economics-template` и компонент `UnitEconomicsTemplateTable` не тронуты — новый UI сосуществует параллельно.
- Использованы только семантические CSS-токены (`bg-background`, `text-foreground`, `border-border` и др.) — без хардкода цветов.

**Checks:** `npx tsc --noEmit` ✅, `npx eslint` ✅, `npm run build` ✅ (роут `/economics-v2` в выводе сборки).

---

## 2026-04-29 · Sidebar icon clipping fix

- Fixed visible right-edge clipping of icon tiles in the collapsed (76px) sidebar after the metric pulse redesign merge. Root cause: `<nav>` carried the shared `.dashboard-scroll` utility, which sets `scrollbar-gutter: stable both-edges`. On a 76px column, that gutter reserved ~28-32px on top of the existing `px-3` padding, leaving only ~22px for the 40px (`w-10`) icon tiles wrapped in `overflow-hidden` Link blocks — so the right half of every tile was cropped.
- Replaced `.dashboard-scroll` on the sidebar `<nav>` with a new `.sidebar-scroll` rule (overlay-thin scrollbars, no stable gutter), keeping the original utility intact for wider scroll regions. Icon tiles are now centered (18px each side) in the 76px collapsed state and stay correct in the 338px hover-expanded state.

**Checks:** `npx tsc --noEmit` ✅, `npx eslint src/components/layout/Sidebar.tsx` ✅, `npm run build` ✅ (no warnings/errors).

---

## 2026-05-05 · April advertising reconciliation

- Reconciled Lavrov April `2026-04-01..2026-04-30` WB advertising cost history export against `raw_api_ad_costs`: Excel total `413436.00` RUB, app total before correction `358315.00` RUB. The missing tail was `55121.00` RUB (`2026-04-28` partial + full `2026-04-29..2026-04-30`).
- Production data correction: replaced Lavrov April ad costs from the full WB "История затрат" XLSX (`type=xlsx_history`, 628 aggregated rows, total `413436.00` RUB) and refreshed `mv_daily_pnl_final`.
- Limited automatic ads sync to a separate default `7` day lookback (`WB_ADS_SYNC_LOOKBACK_DAYS`, capped at `31`) instead of the full nightly `91` day range, so WB ads history covers delayed postings/retries without constantly replaying old months.
- Hardened replace-style sync sources: `region_sales` now fetches all WB windows before deleting old rows, and `stock_offices`/`stock_sizes` replace the current snapshot only after a non-empty WB response.

**Checks:** `npm run lint`, `npm run typecheck`, `npm test -- src/lib/wb-api/index.test.ts src/server/jobs/wb-sync-sources.test.ts src/server/jobs/sync-runtime.test.ts`, `npm run build`.

## 2026-04-29 · Test alignment with daytime ads sync exclusion

- Updated `src/server/jobs/wb-sync-sources.test.ts` to match the deliberate removal of `'ads'` from `WB_SYNC_FAST_SOURCES` in commit `3d69325` ("Reduce daytime advertising sync pressure"). The test had been asserting `WB_SYNC_FAST_SOURCES.toContain('ads')` and was failing under `npm run test`. Replaced that assertion with an explicit `not.toContain('ads')` check plus a comment documenting the rationale, so the intent (ads moved to lower frequency to ease WB ads API daytime load) is locked into the test surface.

**Checks:** `npm run test` ✅ (`459/459`), `npm run lint` ✅, `npx tsc --noEmit` ✅, `npm run build` ✅, `npm audit --omit=dev` ✅ (0 vulns), `npm run db:migration:check` ✅ (52/52).

---

## 2026-04-28 · Advertising spend reconciliation hardening

- Switched `raw_api_ad_costs` sync to prefer WB `GET /adv/v1/upd` history rows over `GET /adv/v3/fullstats`, so spend totals match WB "История затрат" exports and include campaigns outside fullstats statuses.
- Split ad spend history pulls into 31-day windows and passed abort signals through `/adv/v1/upd`, matching the current WB method limit and preventing long sync runs from hanging past source timeout.
- Kept `fullstats` as fallback when history loading fails, preserving SKU-level ad stats where the primary history path is unavailable.
- Removed `ads` from the hourly fast sync and reduced the default advertising balance cron to every 2 hours, leaving ad spend backfill to the nightly/retry contour so WB seller-level limits are not consumed during the day.
- Production data correction: imported Lavrov April `2026-04-01..2026-04-28` ad costs from WB "История затрат" XLSX into `raw_api_ad_costs` (`type=xlsx_history`, 542 aggregated rows, total `358315.00` RUB). Daily DB totals now match the export with `0.00` RUB diff for all 28 days; audit sync run `9002d737-cfae-4746-a2d5-abc7be40eed7`.

**Checks:** `npm run build`, `npm run test -- --run src/lib/wb-api/index.test.ts src/server/jobs/advertising-balance-sync.test.ts`, `git diff --check`.

---

## 2026-04-25 · Production runtime audit follow-ups

- Switched the production Inngest unit from `inngest-cli dev` to signed self-hosted `inngest-cli start` with `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, local sqlite state, and `INNGEST_BASE_URL=http://127.0.0.1:8288`; secrets are loaded from `EnvironmentFile`, not CLI args.
- Added `SuccessExitStatus=143` and longer graceful stop timeout for web/Inngest systemd units to remove false restart failures on normal SIGTERM; Inngest uses `KillMode=control-group` so `npx` and child `inngest-cli` stop together.
- Removed `drizzle-kit` from repo dev dependencies and replaced release validation with `npm run db:migration:check`; full `npm audit` is now expected to be clean, not only `--omit=dev`.
- Added proactive pacing for WB advertising endpoints via `WB_AD_API_MIN_INTERVAL_MS` and for WB review/question publishing via `WB_FEEDBACK_ANSWER_MIN_INTERVAL_MS`.
- Documented current Telegram split: ops watchdog sends Telegram alerts only when `TELEGRAM_OPS_CHAT_ID` is configured; product Telegram bot remains a parked MVP in `docs/AGENT_API_INTEGRATION.md`.

**Checks:** `npm run db:migration:check`, `npm audit`, `npm run lint`, `npm run test`, `npm run build`, production postdeploy and health after deploy.

---

## 2026-04-24 · Lavrov dashboard RLS query timeout fixed

- Fixed the dashboard hot path under forced RLS: `getDailyPnL`, `getKpis`, and `getUnitEconomics` now materialize small cutoff/margin/cost CTEs before joining them to recent sales rows. This prevents PostgreSQL from choosing a bad nested-loop plan that repeatedly scans `raw_api_realization_reports` and hits `statement_timeout=30s` for tenant `ИП Лавров`.
- Confirmed the root cause with production app-user execution: the original `getDailyPnL` call timed out at `30127ms`; the same CTE shape with `MATERIALIZED` completed in ~306ms under RLS.

**Checks:** `npm run lint` ✅, `npm run test` ✅ (`451/451`), `npm run build` ✅, `npm audit --omit=dev --audit-level=moderate` ✅.

---

## 2026-04-24 · Production post-migration audit fixes

- Closed public noVNC ingress: `/wb-vnc/` now returns `404`; RPA display access stays SSH-tunnel only.
- Hardened production firewall persistence: internal app/Supabase/Inngest/RPA ports are rejected before UFW/Docker forwarding rules.
- Restored Postgres safety timeouts: `statement_timeout=30s`, `idle_in_transaction_session_timeout=1min`.
- Enabled restore-tested nightly backups: separate restore DB, postgres-owned `.env.backup`, repeatable restore reset for both `public` and `drizzle` schemas, successful restore sanity check with 55 tables.
- Added production env guardrails for `ALLOWED_HOSTS`, `TELEGRAM_WEBHOOK_SECRET`, and backup restore expectations; real Telegram delivery still requires replacing the placeholder bot token/chat id.
- Cleared stale `sync_runs` entry stuck in `running` since `2026-04-20`.
- Cleared the remaining stale `tenants.wb_lk_storage_state_path` reference after verifying the legacy file was already absent.
- Removed direct `uuid` dependency from app code and forced `exceljs` transitive `uuid@14`; production `npm audit --omit=dev` is clean. Full audit still reports a dev-only `drizzle-kit`/`@esbuild-kit` esbuild advisory with no safe stable upgrade.

**Checks:** `npm run lint` ✅, `npm run test` ✅ (`451/451`), `npm run build` ✅, external health via punycode ✅, `/wb-vnc/vnc.html` → `404`, backup restore-test ✅.

---

## 2026-04-24 · Private agent API v1 added for Telegram/reporting integrations

- Added shared dashboard builder `src/server/analytics/dashboard-summary.ts` and reused it from the existing dashboard route, so the new agent/reporting surface does not fork KPI logic from `/api/views/dashboard`.
- Added `src/lib/agent-api.ts` with service-to-service auth and allowlists:
  - simple single-client env mode via `AGENT_API_KEY`,
  - advanced multi-client env mode via `AGENT_API_CLIENTS`,
  - per-client `reports` and `tenantIds` restrictions,
  - timing-safe API key comparison.
- Added `POST /api/agent/v1/report` for private automation clients. Current built-in reports:
  - `dashboard_summary`
  - `unit_economics_summary`
  - `sync_status`
- Added `src/server/agent/reports.ts` to build structured JSON responses plus `summaryText`, so Telegram bots can either forward the short answer directly or format the raw numbers themselves.
- Extended the existing grammY Telegram bot to answer linked-tenant read-only commands directly:
  - `/dashboard [days]`
  - `/unit <nmId> [days]`
  - `/economics <nmId> [days]`
  - `/sync`
  The bot resolves the tenant by `telegramChatId`, refuses unlinked chats, and rejects ambiguous multi-tenant chat bindings.
- Added unit coverage in `src/lib/agent-api.test.ts` for env parsing, auth, and access restrictions.
- Added unit coverage in `src/server/bot/agent-commands.test.ts` for command parsing and report-message formatting.
- Updated `.env.example`, `README.md`, and `docs/THREAT_MODEL.md` to document the new private API and its security model.

**Intended scope:** internal/private integrations first. This is not a public raw-SQL API and does not expose direct database access.

## 2026-04-24 · Login 502 fixed by nginx proxy buffer tuning

- Added tracked `ops/nginx/enterprise-wb-analytics` production reverse-proxy config.
- Increased Next proxy response-header buffers to handle large auth `Set-Cookie` headers during login.
- Updated production installer and server docs so nginx no longer returns `502 upstream sent too big header` on `POST /login`.

---

## 2026-04-24 · Login crash fixed after Next standalone route-group manifest issue

- Added versioned `ops/prepare-next-standalone.sh` to prepare production standalone output before Next starts.
- Added tracked `ops/systemd/enterprise-wb-analytics.service` that calls the script instead of fragile inline `ExecStartPre` shell.
- Updated production install script and server topology docs so the `/login` manifest guard survives future deploys.

---

## 2026-04-24 · Production migration finalized and old goalbot retired

- **Production target changed** — current production is `metric-pulse-app-01` (`202.181.148.140`) at `/srv/projects/enterprise-wb-analytics`; DNS for `про-цифры.рф` points to the new IP.
- **Old host decommissioned** — `goalbot` (`194.147.149.157`) no longer hosts this project. Removed/disabled: project directory, `enterprise-wb-*` systemd units/timers, Supabase Docker containers/volume/network, nginx site refs, logrotate config and project logs.
- **Network hardening** — new server keeps public ingress on `22/80/443`; internal ports `3457`, `54321`, `54322`, `54324`, `8288`, `8289`, `50052`, `50053`, `6080`, `5900` are blocked externally by `enterprise-wb-network-hardening.service`.
- **Ops docs/scripts renamed** — `SERVER_GOALBOT.md` -> `SERVER_PRODUCTION.md`, `ops/install-on-goalbot.sh` -> `ops/install-on-production.sh`, `scripts/postdeploy-goal-bot-check.mjs` -> `scripts/postdeploy-production-check.mjs`, npm script `postdeploy:goal-bot` -> `postdeploy:production`.
- **Runtime checks updated** — postdeploy/watchdog now check `enterprise-wb-network-hardening.service` and `postgresql@17-main.service` instead of retired `vpn-xray.service`.
- **Claude memory synced** — `SERVER_PRODUCTION.md`, `DEPLOY_PROCEDURE.md`, and `BACKUP_POLICY.md` copied to local project memory through `scripts/sync-claude-memory.mjs`.

**Checks:** external health `ok:true`; DNS A-record `202.181.148.140`; `POSTDEPLOY_SMOKE_AUTH_MODE=skip npm run postdeploy:production` ✅; old host check confirms project/units/Docker/nginx refs absent; external port probe confirms internal ports timeout.

---

## 2026-04-23 · Release gate + ops hardening before server migration

- **`drizzle/meta/0036..0044_snapshot.json`** — repaired the snapshot parent chain so `npm exec drizzle-kit check -- --config=drizzle.config.ts` is green again instead of failing on metadata collision. SQL migrations were not changed.
- **`src/lib/advertising/bandits/linucb.test.ts`**, **`src/server/advertising/bandit-winner.ts`** — removed the last lint blockers (`prefer-const`, unused import) to restore a clean ESLint baseline.
- **`scripts/ops-watchdog.mjs`** — watchdog no longer crashes when Telegram delivery is not configured. It now degrades to log-only mode, keeps health/systemd/sync evaluation active, writes alerts locally, and exits green.
- **`ops/install-on-goalbot.sh`** — installer now validates runtime env before enabling guardrail timers:
  backup timer stays disabled until `BACKUP_RESTORE_DATABASE_URL` points to a different database than `DATABASE_URL`;
  watchdog warns when Telegram delivery env is missing instead of creating a permanently red timer setup;
  rerunning the installer on the same day no longer fails on already-rotated logs;
  when backup stays intentionally disabled, the installer resets stale `enterprise-wb-analytics-backup.service` failed state.
- **`scripts/postdeploy-goal-bot-check.mjs`** — postdeploy validation now checks not only core long-running services but also backup/watchdog timers, but expects `enterprise-wb-analytics-backup.timer` to stay inactive until a separate restore DB exists, and rejects `failed` ops guardrail services after deploy.
- **Live deploy follow-up** — while running the real postdeploy command, fixed two runtime bugs in `scripts/postdeploy-goal-bot-check.mjs`: remote env probing now uses a valid heredoc invocation over `ssh`, and the generated remote `systemctl` loops now render as valid multiline shell instead of `do;` syntax errors.
- **`scripts/dev-runtime.mjs`, `scripts/smoke-operator-runtime.mjs`** — runtime smoke no longer depends on port `3000` being free. The self-contained local runtime now allocates a free local app port automatically and passes it through `Next + Inngest + smoke`, fixing a real `predeploy:gate` hang observed on a desktop where another project already occupied `:3000`.
- **`src/lib/output-retention.ts`, `src/server/jobs/redistribution-rpa.ts`, `scripts/smoke-operator-flow.mjs`** — added artifact retention for `output/wb-rpa/failures` and `output/playwright/operator-smoke-*` so screenshots and traces stop growing forever. Defaults: keep RPA failure PNGs for 7 days / max 1000 files; keep Playwright smoke dirs for 3 days / max 20 dirs.
- **`scripts/postdeploy-goal-bot-check.mjs`** — postdeploy smoke is still strict by default (`POSTDEPLOY_SMOKE_AUTH_MODE=login`), but now supports explicit `auto` or `skip` modes for first bring-up on a fresh server without forcing ad-hoc code edits.
- **Docs/env contract sync** — updated `.env.example`, `README.md`, `docs/PRODUCTION_DEPLOYMENT.md`, `docs/RELEASE_CHECKLIST.md`, `docs/PROJECT_GUIDE.md`, `docs/THREAT_MODEL.md` to match the current code:
  encrypted WB LK storage in DB instead of file-path env contract,
  release status should be taken from the live gate output rather than a stale static snapshot,
  watchdog/backup env requirements are now documented accurately.

**Checks:** `npm run lint` ✅, `npm run typecheck` ✅, `npm run test` ✅ (`432/432`), `npm run build` ✅, `npm exec drizzle-kit check -- --config=drizzle.config.ts` ✅.

---

## 2026-04-21 · P73 — Hybrid CPM + ROAS bidding modes

### P73 — 4 режима ставок (DRR / CPM / ROAS / Hybrid)

- **`src/lib/advertising/bidding/strategies.ts`** — чистые функции расчёта давления ставки по режиму:
  `computeBidPressure({ mode, metrics, targets })` → `{ direction: 'up'|'down'|'hold', magnitude: 0..1, reason, contributingMode }`.
  Хелперы: `computeCpm`, `roasFromDrrPct`, `normalizeBiddingMode`, `normalizeTargets`.
  Константы: `BIDDING_MODES`, `DEFAULT_BIDDING_MODE='drr'`, `DEFAULT_TARGET_CPM_RUB=200`, `DEFAULT_TARGET_ROAS=4`.
  Hybrid-политика: любой `down` перекрывает `up` (безопасность расхода важнее разгона);
  при множественном down выбирается с наибольшей magnitude; при всех up — с наименьшей (консервативно).
- **`src/lib/advertising/bidding/strategies.test.ts`** — 25 unit-тестов на все 4 режима + edge cases (null metrics, zero views, hybrid tie-break).
- **`drizzle/0048_advertising_strategy_modes.sql`** — 3 новых колонки в `advertising_auto_bid_strategies`:
  `bidding_mode VARCHAR(16) DEFAULT 'drr'` (CHECK constraint на 4 режима),
  `target_cpm_rub NUMERIC(10,2) DEFAULT 200`, `target_roas NUMERIC(8,2) DEFAULT 4`.
  Существующие стратегии получают `drr` по default — полная обратная совместимость.
- **`src/lib/db/schema.ts`** — добавлены поля `biddingMode/targetCpmRub/targetRoas` в `advertisingAutoBidStrategies`.
- **`src/server/advertising/workspace.ts`** — `AdvertisingAutoBidStrategyRecord` + `SaveAdvertisingAutoBidStrategyInput` + `mapStrategyRecord` + `validateStrategyInput` + insert/update теперь знают про 3 новых поля.
  В `executeStrategyRun` (classic-branch) вместо жёстких `hasAcosPressure/hasCpcPressure` условий используется `computeBidPressure` с выбранным режимом; `cpc_above_max` сохранён как hard cap поверх любого режима; `orders_below_min` — тоже hard guardrail. Self-learning branch не затронут.
  Magnitude применяется как множитель к stepUp/stepDown с нижней границей 0.5× — плавное масштабирование шага по силе давления.
- **`src/components/advertising/workspace/tabs/StrategiesTab.tsx`** — `StrategyRecord` + `StrategyDraft` расширены; в форме стратегии добавлен селектор режима с пояснением и условные поля «Целевая CPM, ₽/1000 показов» (для cpm/hybrid) и «Целевой ROAS» (для roas/hybrid); поле ДРР блокируется для cpm/roas режимов.

**Acceptance criteria (все выполнены):**
- ✅ 4 режима с unit-тестами расчётов (25 тестов)
- ✅ UI переключения режима в StrategiesTab
- ✅ Migration path: default=`drr`, legacy-поведение сохранено

**Checks:** typecheck clean, 432/432 tests pass (+25 новых strategies.test.ts), `npm run build` ✅.

---

## 2026-04-21 · P72c/d — BanditInsights UI + LinUCB + A/B split-тесты

**Commits:** `721d008` (P72c), `dfe050c` (P72d). Сервер: `dfe050c`, паритет ✅.

### P72c — BanditInsights UI + LinUCB contextual bandit

- **`src/lib/advertising/bandits/linucb.ts`** — disjoint LinUCB (Chu et al. 2011):
  `createLinUCBArm`, `linUCBScore` (theta = A⁻¹b, UCB = θᵀx + α√xᵀA⁻¹x),
  `pickLinUCB`, `updateLinUCBArm` (A += xxᵀ, b += rx). Гауссово решение,
  d ≤ 16, O(d³) на pick. `buildLinUCBFeatures([log(price+1), log(orders30d+1), sin/cos(week)])`.
  `LINUCB_MIN_OBSERVATIONS = 500`, `LINUCB_DEFAULT_ALPHA = 1.0`.
- **`src/lib/advertising/bandits/linucb.test.ts`** — 11 unit-тестов:
  создание arm, score при A=I, pick детерминирован, иммутабельность,
  сходимость θ→reward на 200 обновлениях, feature builder (размерность,
  монотонность, NaN-safe, sin²+cos²=1).
- **`src/components/advertising/autopilot/BanditInsights.tsx`** — `'use client'` компонент:
  читает `StrategyBanditState`, вычисляет `probabilityArmIsBest` (Monte-Carlo 2000 итераций,
  фиксированный seed только для display), показывает таблицу arm/E[reward]/P(best)/obs,
  shadow delta (% совпадений с epsilon-greedy), бейдж «LinUCB доступен» при ≥500 набл.

### P72d — A/B split-тесты + авто-выбор победителя

- **`src/lib/advertising/bandits/ab-compare.ts`** — Bayesian A/B сравнение Thompson vs baseline:
  Monte-Carlo P(thompson > baseline), `AB_CONFIDENCE_THRESHOLD = 0.95`,
  `AB_MIN_OBSERVATIONS = 50`. Baseline arms: синтетическое Beta из
  `LearningArmState.runs/rewardSum` (Laplace-сглаживание). Результат:
  `insufficient_data | thompson_wins | no_winner`.
- **`src/lib/advertising/bandits/ab-compare.test.ts`** — 8 unit-тестов.
- **`src/lib/advertising/notifications.ts`** — добавлен тип `ab_test_won`:
  `AdAlertType`, `AdAlertPayload`, `ALERT_THROTTLE_MS = 7d`, `formatAdAlert` case.
- **`src/server/advertising/bandit-winner.ts`** — `checkBanditWinner` (pure, без IO),
  `notifyBanditWinner` (fire-and-forget Telegram с throttle `subkey=strategyId`),
  `strategyIdToSeed` (djb2 hash).
- **`src/server/advertising/workspace.ts`** — интеграция P72d:
  после обновления bandit posterior вызывается `checkBanditWinner`;
  при `shouldSwitch=true` — `effectiveAutopilotConfig.policy` переключается на winner
  (записывается в `lastSummary`); fire-and-forget `notifyBanditWinner` в обоих путях
  (skipped и applied).

**Tests:** 407/407 ✅ · **Build:** ✅ · **Typecheck:** ✅

---

## 2026-04-21 · P0-03b Slice 13 — flip-the-switch: strict RLS policies (P0-03b закрыт)

**Миграция `drizzle/0047_rls_strict.sql` применена в prod.** Policy `tenant_isolation` на 50 таблицах заменена с IS-NULL bypass (из `0040_rls_enable.sql`) на **строгую** версию:

```
USING (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
       OR tenant_id = current_setting('app.tenant_id', true)::uuid)
```

**Что это значит:**

- Роль `enterprise_wb_analytics_user` (BYPASSRLS=false) без `SET LOCAL app.tenant_id` теперь видит **0 строк** на всех 50 tenant-scoped таблицах.
- `withTenantContext(db, tenantId, tx => …)` (Slices 1-12 + sweep) корректно ограничивает доступ: только строки своего тенанта.
- `withAdminContext(db, tx => …)` (Slice 12) выставляет admin sentinel UUID и видит данные всех тенантов — используется для schedulers, user bootstrap, tenant switch, invitation accept.
- Superuser `postgres` (BYPASSRLS=true) всегда обходит policy — миграции и admin psql не затронуты.

**Pre-requisite checks:**

- Slices 1-12 + pre-Slice-13 sweep замержены, задеплоены (main = `9f93a93`).
- `grep -rn 'db.\(select\|insert\|update\|delete\|execute\|query\|transaction\)' src/ | grep -v 'withTenantContext\|withAdminContext\|rls.test\|\.test\.\|from tenants$\|from users$'` — пусто (оставшиеся call-sites: `sync-wb.ts:373` на `tenants` + `REFRESH MATERIALIZED VIEW CONCURRENTLY` — оба exempt).

**Deploy sequence:**

1. Backup: `ssh goalbot 'su - postgres -c "pg_dump --format=custom --compress=9 ..."'` → `/srv/backups/enterprise-wb-analytics/pre-slice-13-20260421-074806/database.dump` (11M, SHA `87477900ca3ca0a1bff9e611a64003bdd0c24de8fa1d194b79708143f41b2ca6`, 488 TOC entries).
2. Push `main` (`9f93a93`) → `ssh goalbot 'git pull --ff-only'`.
3. Apply SQL: `ssh goalbot 'su - postgres -c "psql -d enterprise_wb_analytics_prod -f drizzle/0047_rls_strict.sql"'` → `DO`.
4. Restart: `systemctl restart enterprise-wb-analytics.service enterprise-wb-analytics-inngest.service` → оба `active`.

**Verify:**

- `curl http://localhost:3457/api/health` → `{"ok":true,"checks":{"app":"ok","db":"ok","supabase":"ok","inngest":"ok"}}`.
- `SELECT policyname, qual FROM pg_policies WHERE policyname = 'tenant_isolation' LIMIT 1;` → показывает новый qual с sentinel `00000000-0000-0000-0000-000000000000`.
- Под `enterprise_wb_analytics_user` без `app.tenant_id`: `SELECT count(*) FROM products;` → **0** ✅ (strict isolation).
- Под real tenant `ae0b36db-…`: `SELECT count(*) FROM products;` → **101** ✅ (scoped).
- Под admin sentinel: `SELECT count(*) FROM products;` → **176** ✅ (все тенанты).
- journalctl: 0 RLS denial / permission-denied ошибок за первые 3 минуты после рестарта.

**Files:**

- `drizzle/0047_rls_strict.sql` (78 LOC): `DO $$ … FOREACH tbl IN ARRAY[…50 tables…] LOOP DROP POLICY … CREATE POLICY …`.
- `drizzle/meta/0047_snapshot.json` + `drizzle/meta/_journal.json` — entry `idx=47, tag=0047_rls_strict`.
- `docs/operations/SLICE_13_RLS_STRICT_MIGRATION.md` — draft миграции + rollback SQL.

**Rollback:** `docs/operations/SLICE_13_RLS_STRICT_MIGRATION.md` → раздел "Rollback SQL" (возврат к IS-NULL bypass). Backup `pre-slice-13-20260421-074806` доступен для полного restore.

**Status:** P0-03b → **done ✅**. Defense-in-depth RLS enforcement теперь **реально** работает в runtime, а не «на бумаге».

**Commit:** `9f93a93` feat(security): P0-03b Slice 13 — strict RLS policies с admin sentinel

---

## 2026-04-20 · P0-03b pre-Slice-13 sweep — обёртка 4 файлов

Механический cleanup-commit перед flip-the-switch Slice 13 (strict RLS). Без логических изменений: только `db.*` → `tx.*` внутри контекст-хелпера.

**Файлы:**

- `src/server/analytics/stocks.ts`: `getStocksPlanner` — 7 call-sites → `withTenantContext`.
- `src/server/analytics/redistribution.ts`: `getRedistributionPlan` — 3 call-sites → `withTenantContext`.
- `src/server/analytics/advertising.ts`: `getAdvertisingOverview` — 7 call-sites → `withTenantContext`.
- `src/inngest/sync-wb.ts`: `mv_refresh_runs` INSERT + UPDATE → `withAdminContext`. `REFRESH MATERIALIZED VIEW CONCURRENTLY` оставлен с `db.execute` + inline-комментарий `// withAdminContext: cannot use — CONCURRENTLY is prohibited inside a transaction`.

**Pre-requisite grep check результат:**
- 4 файла sweep: пусто.
- `sync-wb.ts:373` `db.query.tenants.findFirst` — известный false-positive (`tenants` без RLS).

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Commit:** `2c1e432`

---

## 2026-04-20 · P0-03b Slice 12 — admin sentinel pattern (`withAdminContext`)

Pre-requisite для Slice 13 (flip-the-switch strict RLS). Введён **sentinel UUID** `00000000-0000-0000-0000-000000000000` как легальный способ cross-tenant операций. Policy в будущей миграции 0047 будет включать exception для этого UUID.

**`src/lib/db/index.ts`:**

- `ADMIN_TENANT_SENTINEL` константа.
- `withAdminContext(db, fn)` — helper, открывающий транзакцию и выставляющий `SET LOCAL app.tenant_id = sentinel`.

**Admin-path call-sites (обёрнуты в `withAdminContext`):**

- `src/lib/auth/tenant-access.ts` → `requireTenantAccess` читает `userTenants` под `withTenantContext(tenantId)` (tenantId известен). `requireGroupAccess` читает `productGroups` by groupId (tenantId ещё не известен) — `withAdminContext`.
- `src/lib/auth/user-bootstrap.ts` → `syncActiveTenantForUser` — cross-tenant `userTenants` lookup by userId (`withAdminContext`). Второй lookup по (userId + preferredTenantId) — тоже `withAdminContext` (для единообразия pre-tenant flow).
- `src/app/(dashboard)/settings/actions.ts` → `getAvailableTenants` (список всех tenants пользователя) + `addCabinet` (insert userTenants для нового tenant до membership) → `withAdminContext`.
- `src/app/(dashboard)/cabinets/user-actions.ts`:
  - `inviteMember` — insert invitations под `withTenantContext(tenantId)`.
  - `getTeamData` — Promise.all[userTenants + invitations] под `withTenantContext(tenantId)`.
  - `acceptInvitation` — вся транзакция (update invitations by token + insert userTenants + update users) под `withAdminContext` (token-based cross-tenant lookup).
  - `removeTeamMember` — delete invitations / userTenants под `withTenantContext(tenantId)`.
- `src/inngest/stale-sync-alert.ts` — cross-tenant aggregate syncRuns (`max(finishedAt)` per tenantIds) → `withAdminContext`.
- Advertising schedulers (cross-tenant итерация стратегий/правил/портфолио):
  - `runDueAdvertisingAutoBidStrategies` (`workspace.ts`) — `withAdminContext`.
  - `runDueAdvertisingPacingRules` (`pacing-portfolios.ts`) — `withAdminContext`.
  - `runDueAdvertisingPortfolios` (`pacing-portfolios.ts`) — `withAdminContext`.
  - `runPortfolio` internal `db.update(advertisingBidPortfolios)` — `withTenantContext(portfolio.tenantId)`.

**Tests:** `src/lib/auth/tenant-access.test.ts` mock `@/lib/db` дополнен stubs для обоих helpers.

**`docs/operations/SLICE_13_RLS_STRICT_MIGRATION.md`** — pre-checked draft миграции (DO-block на 50 таблиц с sentinel-exception), pre-requisites checklist + rollback SQL. Лежит в docs/ (не в drizzle/) чтобы не попасть в автоматический migrate до Slice 13.

**Out of scope (pre-existing debt, cleanup до Slice 13 в отдельном коммите):**

- `src/server/analytics/stocks.ts` (`getStocksPlanner`, ~7 call-sites).
- `src/server/analytics/redistribution.ts` (~3 selects).
- `src/server/analytics/advertising.ts` (~5 `db.execute`).
- `src/inngest/sync-wb.ts:1603/1620/1623` (materialized view refresh + claim SQL).

Без этого Slice 13 вернёт 0 строк из этих функций. Нужен отдельный «cleanup sweep» перед flip-the-switch.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Deploy:** `f868ec3` → prod goalbot. Health: app/db/supabase/env ok; inngest=error (P1 out of scope).

## 2026-04-20 · P0-03b Slice 11 — analytics engine + signal-* services обёрнуты

Крупнейший слайс P0-03b. Покрыт весь аналитический слой (engine.ts + 6 signal-* сервисов, суммарно ~4800 LOC, ~50 DAO call-sites). Пункт 5 плана (analytics services) закрыт полностью.

**`src/server/analytics/engine.ts` (973 LOC, 7 call-sites):**

- `AnalyticsEngine.getSignals(tenantId)` — raw SELECT'ы по `raw_api_stocks` + `raw_api_product_metadata` обёрнуты. Блок save-risk-signals (existingProcessed select + delete active + insert new) — одна транзакция `withTenantContext`.
- `AnalyticsEngine.getGroupDynamics(tenantId, groupId, ...)` — большой raw-SQL (CTE: realization + provisional sales + ads + storage + funnel + stocks) обёрнут в `withTenantContext(db, tenantId, tx => tx.execute(query))`. `product_group_members` SELECT (не под RLS, это junction-table без tenant_id) оставлен на `db.execute`.

**`src/server/analytics/services/signal-core.ts` (778 LOC, 13 call-sites):** `getActiveSignals` / `recordSignalTimelineEvent` (dedupe-select + insert) / `getSignalTimeline` (leftJoin signalOperatorTimeline x riskSignals) / `getSignalWorkflowMembers` (userTenants leftJoin users — users не под RLS, но user_tenants под RLS) / `getLatestSignalEscalations` / `getSignalDetails` (riskSignals select + `Promise.all`[products, rawApiProductMetadata, rawApiStocks] внутри withTenantContext) / `assignSignalOwner` (3 обёртки) / `updateSignalWorkflowState` (2) / `addSignalNote` / `updateSignalStatus` — все обёрнуты. `dispatchSignalCollaborationNotification` читает только `tenants` — не под RLS, без обёртки.

**`src/server/analytics/services/signal-feed.ts` (1 call-site):** `bulkUpdateSignalStatus` (db.update riskSignals) обёрнут.

**`src/server/analytics/services/signal-notifications.ts` (5 call-sites):** `getSignalNotifications` — `Promise.all[userTenants select + signalOperatorTimeline leftJoin riskSignals leftJoin signalNotificationReceipts]` обёрнут в одну tx. `markSignalNotificationsRead` / `acknowledgeSignalNotifications` — каждая функция теперь выполняет select + insert + update внутри одной `withTenantContext`.

**`src/server/analytics/services/signal-saved-views.ts` (498 LOC, 7+ call-sites):** `resolveSignalSavedViewSharedOwner` (userTenants leftJoin users) / `getSignalSavedViewForMutation` (signalSavedViews select) / `getSignalSavedViews` (signalSavedViews leftJoin users) — все обёрнуты. 6× `db.transaction(...)` в `saveSignalSavedView` / `updateSignalSavedView` / `setSignalSavedViewDefault` / `toggleSignalSavedViewPin` / `moveSignalSavedView` заменены на `withTenantContext(db, tenantId, async (tx) => {...})`. `duplicateView` check в updateSignalSavedView и `db.delete` в deleteSignalSavedView — тоже обёрнуты.

**`src/server/analytics/services/signal-sla-execution.ts` (1042 LOC, 8 call-sites):** `createSignalAutomationSuppression` — saved_view branch (savedView select + existing suppressions select + insert) обёрнут в одну withTenantContext-транзакцию; queue_owner branch — также. `clearSignalAutomationSuppression` (2 ветки, каждая — update signalAutomationSuppressions). `executeSignalSla` — `Promise.all[signals select, members (уже обёрнуто)]`, `recentEvents` dedup query, `insertedRun` (insert signalAutomationRuns returning), `completion update` + `failure update` в try/catch — все обёрнуты. Пришлось локализовать `payload.savedViewId` / `payload.sharedOwnerUserId` в constant'ы для TS narrowing внутри callback.

**`src/server/analytics/services/signal-automation-queries.ts` (1110 LOC, ~14 call-sites в 6 функциях):** функции-обёртки — `getSignalAutomationRuns` / `getSignalAutomationRunDetails` / `getSignalAutomationSuppressions` / `getSignalAutomationControlEvents` переписаны в виде `return withTenantContext(db, tenantId, async (tx) => { ... все внутренние db.* → tx.* ... });`. `recordSignalAutomationControlEvent` (insert signalAutomationControlEvents returning) — точечная обёртка.

**Admin-path deferred (Slice 12):** нет новых элементов — все cross-tenant schedulers остаются тем же списком (stale-sync-alert, advertising auto-bid runners, reviews-qa auto-replies, getAvailableTenants, addCabinet, user-bootstrap).

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Deploy:** `183de92` → prod goalbot. Health: app/db/supabase/env ok; inngest=error (P1 out of scope).

**Кумулятивно после Slices 1-11:** ~220 runtime call-sites в 36 файлах — все крупные tenant-scoped DAO слои покрыты. Остаётся только Slice 12 (admin-pattern) + Slice 13 (flip-the-switch).

## 2026-04-20 · P0-03b Slice 10 — redistribution services обёрнуты в withTenantContext

Пункт 2 плана P0-03b окончательно закрыт (kernel redistribution services полностью покрыт).

**`src/server/redistribution/route-scan.ts` (889 LOC, ~19 call-sites):**

- `loadBlockingRouteMap(tenantId)` — select `redistributionRouteAvailability` с фильтром blocking statuses обёрнут.
- `saveRouteAvailabilityResult({...})` — вся функция переписана в одну `withTenantContext(db, tenantId, tx => …)` транзакцию: upsert routeAvailability + insert events + upsertWarehouseRegistry.
- Internal helper `upsertWarehouseRegistry` → переименован в `upsertWarehouseRegistryOnTx(tx, tenantId, …)` и принимает внешний tx как первый параметр. Теперь используется из двух call-sites (`saveRouteAvailabilityResult` + `refreshTenantWarehouseRegistryFromStocks`), оба передают свой внутренний tx.
- `refreshTenantWarehouseRegistryFromStocks(tenantId)` — 2 select'а `raw_api_stock_sizes` + `raw_api_stocks` + upsertWarehouseRegistryOnTx обёрнуты в общий `withTenantContext`.
- `getRouteScanOverview(tenantId)` — `Promise.all` из 11 `tx.select`'ов (warehouse counts, route counts, blocked/opened routes, hourly events, monitor runs, removed warehouses, latest timestamps, total known counts) обёрнут в единую транзакцию.
- `runRouteScanForAllTenants` оставлен **admin-path**: `db.select({id}).from(tenants)` — `tenants` не под RLS, это cross-tenant scheduler (в цикле вызывает уже-обёрнутый `runRouteScanForTenant`).

**`src/server/redistribution/slot-monitor.ts` (311 LOC, ~5 call-sites):**

- `loadSlotMonitorCandidates(tenantId, limit)` — select blockedRoutes + per-route lookup в `redistributionItems` внутри loop обёрнуты в один `withTenantContext` (все параллельные селекты — под SET LOCAL).
- `runSlotMonitorForTenant.recordRun` closure — insert `redistributionSlotMonitorRuns` обёрнут.
- `db.select tenants` (для получения wbLkStorageState) оставлен без обёртки — `tenants` не под RLS.
- `runSlotMonitorForAllTenants` — admin-path, `db.select({id}).from(tenants)` cross-tenant.

**Остаётся для Slice 12 (admin pattern):** `runRouteScanForAllTenants` / `runSlotMonitorForAllTenants` — в сегодняшней постановке они НЕ читают RLS-таблицы напрямую (только `tenants`), так что flip-the-switch их не ломает; но внутри `runSlotMonitorForTenant` вызывается внешний `runRedistributionRouteProbeRpa` (Inngest job), там уже обёртки применены в Slice 6c.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Deploy:** `5f9587c` → prod goalbot. Health: app/db/supabase/env ok; inngest=error (P1 out of scope).

**Кумулятивно после Slices 1-10:** ~169 runtime call-sites в 29 файлах.

## 2026-04-20 · P0-03b Slice 9 — economics-template/route.ts обёрнут в withTenantContext

Пункт 4 плана P0-03b частично закрыт (route — done, AnalyticsEngine остаётся в Slice 11).

**Покрыто (6 call-sites) в `src/app/api/views/economics-template/route.ts` (1109 LOC):**

- `getBuyoutFactsByNm(tenantId, dateFrom, dateTo, nmIds)` — вспомогательная функция с raw SQL CTE по `raw_api_orders` + `raw_api_sales`, `db.execute` обёрнут в `withTenantContext(db, tenantId, tx => tx.execute(sql\`…\`))`.
- Route handler: `manualInputRows` — `db.select unitEconomicsManualInputs where tenantId+inArray(nmIds)` обёрнут.
- Route handler: Promise.all из 4 tariff/commission select'ов (`wbTariffSnapshots` x3 + `wbCategoryCommissionSnapshots`) обёрнут одной `withTenantContext(db, tenantId, tx => Promise.all([4 tx.select(...)]))` транзакцией. Token fetch и buyoutFacts остаются параллельными на уровне внешнего `Promise.all`.

**Не покрыто в этом слайсе (intentionally):**

- `AnalyticsEngine.getUnitEconomics(tenantId, …)` — вложенный сервис, отложен на Slice 11 (`src/server/analytics/engine.ts`).

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Deploy:** `066c846` → prod goalbot (git pull + build + restart). Health: app/db/supabase/env ok; inngest=error (P1 out of scope).

**Кумулятивно после Slices 1-9:** ~145 runtime call-sites в 27 файлах.

## 2026-04-20 · P0-03b Slice 8 — cross-cutting lib обёрнут в withTenantContext

Первый слайс после полного покрытия advertising layer. Цель — зачистить маленькие cross-cutting утилиты в `src/lib/*` и `src/server/catalog/*`, прежде чем переходить к более крупным слайсам (economics-template, redistribution services, analytics engine, admin pattern).

**Покрыто (~4 call-sites):**

- `src/lib/idempotency.ts`:
  - `db.query.idempotencyKeys.findFirst(where key+tenantId)` — обёрнут в `withTenantContext(db, tenantId, tx => tx.query.idempotencyKeys.findFirst(...))`.
  - `db.insert(idempotencyKeys).values(...).onConflictDoNothing()` после handler — обёрнут.
  - `idempotency_keys` под RLS → `current_setting('app.tenant_id')` теперь выставляется вокруг обоих обращений.
- `src/server/catalog/observed-products.ts`:
  - `listObservedProductOptions(tenantId)` — `db.execute(observedCatalogQuery)` обёрнут (raw SQL по `products` + 6 `raw_api_*` через `CTE observed_raw/catalog_nm/…`).
  - `reconcileObservedProducts(tenantId)` — read + insert вся функция обёрнута в одну `withTenantContext(...)` транзакцию (SELECT missing nmIds + INSERT products).

**Admin-path отложен на Slice 12 (spec-UUID/admin-pool pattern):**

- `src/lib/wb-rpa/storage-state.ts` — читает/обновляет только `tenants` (не под RLS). Пропущен.
- `src/server/bot/service.ts` — `db.query.tenants.findFirst` (не под RLS). Пропущен.
- `src/lib/telegram-update-dedup.ts` — таблица `telegram_processed_updates` без `tenant_id` (global update_id PK). Не в scope RLS.
- `src/lib/auth/user-bootstrap.ts` — `db.query.users.findFirst` / `db.update(users)` / `db.select(userTenants)` выполняются ДО существования tenant-контекста. `users` не под RLS, но `user_tenants` — под RLS с бездействующим IS-NULL bypass. Нужен admin pattern.
- `src/lib/auth/tenant-access.ts` — `requireTenantAccess` читает `userTenants` (cross-tenant по user_id), `requireGroupAccess` читает `productGroups` до резолва tenantId. Оба — классический admin-path.

**Tests:** `src/lib/idempotency.test.ts` mock `@/lib/db` дополнен stub `withTenantContext: (db, tenantId, fn) => fn(txStub)`.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Deploy:** `f2bfaee` → prod goalbot (`git pull && npm ci && npm run build && systemctl restart`). Health: app/db/supabase/env ok; inngest=error (P1 INNGEST_DEV, out of scope).

**Кумулятивно после Slices 1-8:** ~139 runtime call-sites в 26 файлах.

## 2026-04-20 · P0-03b Slice 7c-2 — advertising workspace.ts (reads) обёрнут; advertising layer полностью покрыт

Завершение advertising layer. Покрыты 6 оставшихся read-only точек в `src/server/advertising/workspace.ts`:

- `getClusterPerformanceByNm` — raw SQL CTE по `raw_api_sales` + `raw_api_ad_clusters`.
- `getAdvertisingBidWorkspace` → `fallbackDailyRows` — `db.execute` на `raw_api_ad_clusters`, обёрнут.
- `getAdvertisingAlertsList` → `dailyRowsRaw` — daily aggregation raw SQL.
- `getAdvertisingAlertsList` → `productRows` — drizzle select products, conditional.
- `getAdvertisingAlertsList` → `skuRowsRaw` — leftJoin raw SQL по ad_clusters+products.
- `getAdvertisingAutoBidWorkspace` — parallel 3 selects (strategies + runs + changes) в одной tx.

**Все ~33 call-sites advertising layer теперь покрыты** (balance + clusters + pacing-portfolios + workspace).

**Остаётся admin-path для Slice 6d:** `runDueAdvertisingAutoBidStrategies`, `runDueAdvertisingPacingRules`, `runDueAdvertisingPortfolios` (cross-tenant schedulers).

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивно после Slices 1-7c-2:** ~135 runtime call-sites в 24 файлах.

## 2026-04-20 · P0-03b Slice 7c-1 — advertising workspace.ts (mutations) обёрнут в withTenantContext

Третий advertising подслайс, часть 1 из 2. Покрыты все mutations (insert/update/delete) и ключевые selects в `src/server/advertising/workspace.ts` (2 838 LOC). Read-only `db.execute` с raw-SQL (6 точек) остаются для подслайса 7c-2.

**Покрыто в 7c-1 (~16 tx-wraps):**

- `runClusterAutoRetest`:
  - `db.select advertisingClusterActions` cooldown-фильтра — обёрнут.
  - 2× `db.transaction(async tx => insert advertisingClusterActions)` (success + failure branches) → `withTenantContext(db, strategy.tenantId, ...)`.
- `applyAdvertisingBidChanges` — `db.transaction(tx.insert advertisingBidChanges).onConflictDoNothing` заменён на withTenantContext.
- `saveAdvertisingAutoBidStrategy` (update + insert ветки) — обёрнуты. `validated.id!` после guard.
- `deleteAdvertisingAutoBidStrategy` — обёрнут.
- `executeStrategyRun`:
  - `insert advertisingAutoBidRuns returning` — обёрнут.
  - Promise.all `db.query.tenants.findFirst` (skip — tenants не RLS) + `db.select rawApiStocks sum` — второй обёрнут.
  - `strategyGuardrail.passed === false` ветка: `insert advertisingGuardrailEvents` + 2× update (`runs` + `strategies`) — 2 tx-обёртки.
  - Cluster-level guardrail fire-and-forget insert — обёрнут.
  - `proposals.length === 0` ветка: 2× update в одной tx.
  - Success path: `insert advertisingBidChanges.onConflictDoNothing` + `update advertisingAutoBidRuns` в одной tx; следующая tx — `update advertisingAutoBidStrategies`.
  - Catch (error) path: 2× update (runs + strategies) в одной tx.
- `runAdvertisingAutoBidStrategyNow` — select strategy обёрнут.

**Остаётся для 7c-2 (6 read-only db.execute/select):**

- `getClusterPerformanceByNm` (line ~600, raw SQL).
- `applyAdvertisingBidChanges` intermediate `db.execute(sql)` (line ~1198).
- `getAdvertisingBidWorkspace` `dailyRowsRaw` (line ~1640) + `db.select products` (line ~1681).
- `getAdvertisingBidWorkspace` `skuRowsRaw` (line ~1805).
- `getAdvertisingStrategyInsights` parallel 3 selects (line ~1936).

**Admin-path (admin pattern Slice 6d):**

- `runDueAdvertisingAutoBidStrategies` cross-tenant scheduler (line ~2834).
- `db.query.tenants.findFirst` в executeStrategyRun — tenants не в RLS, остаётся как есть.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивно после Slices 1-7c-1:** ~128 runtime call-sites в 24 файлах. Все advertising layer mutations обёрнуты.

## 2026-04-20 · P0-03b Slice 7b — advertising pacing-portfolios обёрнут в withTenantContext

Подслайс 7b advertising layer. Покрыт `src/server/advertising/pacing-portfolios.ts` (1 125 LOC, ~20 call-sites на tenant-scoped таблицах).

**Покрыто:**

- `getNmSpendForDay`, `getSpendForNmIdsForDay` — selects по `rawApiAdClusters` (внутри каждой обёртка).
- `getAdvertisingPacingWorkspace` — Promise.all select rules + changes в одной tx.
- `saveAdvertisingPacingRule` — update existing + insert new (2 tx ветки); `validated.id!` restore после pre-existing `if (validated.id)` guard, который TS стал трактовать как string|undefined из-за tighter inference в async closure.
- `deleteAdvertisingPacingRule` — delete.
- `runPacingRule` — 2 update (skipped + active paths).
- `runAdvertisingPacingRuleNow` — select rule.
- `resolvePortfolioNmIds` — select products (для brand-фильтра).
- `getAdvertisingPortfolioWorkspace` — Promise.all select portfolios + changes в одной tx.
- `saveAdvertisingPortfolio` — update + insert с тем же `validated.id!`.
- `deleteAdvertisingPortfolio` — delete.
- `runPortfolio` — 3 update (no_nm_ids / no_changes / final-status).
- `runAdvertisingPortfolioNow` — select portfolio.

**Skip с обоснованием:**

- `getTenantWbToken` — select `tenants`, не под RLS.
- `runDueAdvertisingPacingRules` dueRules cross-tenant + `runDueAdvertisingPortfolios` duePortfolios cross-tenant — **admin-path** (scheduler читает across all tenants; нет single tenantId). Slice 6d (admin pattern).

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивно после Slices 1-7b:** ~112 runtime call-sites в 23 файлах. В advertising остался workspace.ts (2 838 LOC, 33 call-sites) — Slice 7c.

## 2026-04-20 · P0-03b Slice 7a — advertising balance + clusters обёрнуты в withTenantContext

Седьмой слайс (подслайс 7a) RLS runtime enforcement. Первый из трёх подслайсов по advertising service layer.

**Покрыто:**

- `src/server/advertising/balance.ts` (8 из 9, +1 pre-existing null-check fix):
  - `getAdvertisingBalance` — upsert `advertisingBalanceSnapshots`.
  - `getAdvertisingBalanceCached` — select snapshot.
  - `getAutoRefillSettings` — select settings.
  - `upsertAutoRefillSettings` — insert/onConflictDoUpdate.
  - `depositManual` — insert log.
  - `checkAndRunAutoRefill` — cooldown select + daily cap select объединены в одну tx; затем auto-refill insert в отдельной tx (после WB API call).
  - `settings.campaignId!` — восстановлена pre-existing guard narrow (проверка `if (!settings.campaignId) return` на line ~211), чтобы TS не ругался на nullable.
  - Skip: `getTenantWbToken` select tenants (не RLS).
- `src/server/advertising/clusters.ts` (6 из 7):
  - `listAdvertisingClusters` — totalRowsRaw `db.execute` (cluster_base CTE) + rowsRaw `db.execute` обёрнуты в withTenantContext отдельно.
  - `getClusterActionLogs` — select advertisingClusterActions.
  - `toggleClusterMinus` — 2 insert advertisingClusterActions (success + failure paths).
  - Skip: `getTenantWbToken` select tenants.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивно после Slices 1-7a:** ~92 runtime call-sites в 22 файлах. Advertising service осталось: pacing-portfolios.ts (22 wraps, 7b) + workspace.ts (33 wraps, 7c).

## 2026-04-20 · P0-03b Slice 6c — redistribution-rpa + redistribution-digest обёрнуты в withTenantContext

Шестой слайс (подслайс 6c) RLS runtime enforcement. Закрывает последние два крупных Inngest-файла: RPA handler (1 289 LOC) и daily digest (334 LOC).

**Покрыто:**

- `src/server/jobs/redistribution-rpa.ts` (11 call-sites):
  - `markRedistributionItemStatus` — сигнатура расширена полем `tenantId`, обёртка withTenantContext внутри helper. Оба вызова из `runRedistributionUploadRpa` передают tenantId.
  - `failedSamples` select в `runRedistributionUploadRpa` — обёрнут.
  - 7 step.run точек handler'а: `load-run` select / `load-run-items` select / `mark-running` (runs + items в одной tx) / `mark-completed` (runs + items) / `mark-failed` (runs + items).
- `src/server/jobs/redistribution-digest.ts` (7 call-sites, 1 skipped):
  - `fetch-tenants` select `tenants` — **skip** (tenants не под RLS).
  - `create-run` insert redistributionRuns, `items-N` chunked insert redistributionItems, `mark-exported` / `mark-sent` / `mark-telegram-error` / `rpa-queue` (items update + inngest.send вне tx) / `mark-failed` updates — все обёрнуты через `withTenantContext(db, tenant.id, ...)`.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивно после Slices 1-6c:** ~78 runtime call-sites в 20 файлах. Критический путь Inngest почти полностью покрыт; остаются admin sweeps (stale-sync-alert, scheduled sync, cross-tenant reads) для Slice 6d.

## 2026-04-19 · P0-03b Slice 6b — Inngest sync-wb.ts (главный WB sync handler) обёрнут в withTenantContext

Шестой слайс (подслайс 6b) RLS runtime enforcement. Крупнейший файл в Inngest-слое — `src/inngest/sync-wb.ts` (950+ LOC, главный обработчик `wb/sync.requested`, держит 15+ recordSource блоков за один sync run на тенант).

**Паттерн:** оборачиваем на уровне recordSource step.run / chunk-loop. Каждый блок получает одну `withTenantContext` tx, внутри — `tx` вместо `db`. `wbApi.*` HTTP-вызовы, file IO, inngest.send, AnalyticsEngine.getSignals остаются вне tx (не держим коннекшн на долгие IO-операции).

**Обёрнутые блоки (tenant-scoped RLS-таблицы):**

- `persistProgress` + `mark-sync-run-running` + `finalize-sync-run` + `mark-sync-run-failed` — 4 точки на `syncRuns.update` (включая error path).
- `countRetainedSnapshotRows` — 3 select по `rawApiPaidStorage`/`rawApiAdCosts`/`rawApiAdClusters` (snapshot recovery).
- `sync-realization-reports` — chunked insert `rawApiRealizationReports` в одной tx.
- `sync-products-metadata` — insert `products` + archive `UPDATE products` (`db.transaction` → `withTenantContext`, внутри tx.execute со списком nm_id).
- `sync-detailed-content-metadata` — insert `rawApiProductMetadata`.
- `sync-prices` — insert `rawApiPrices`.
- `sync-orders` — insert `rawApiOrders`.
- `sync-funnel` — delete + chunked insert `rawApiFunnelStats` (`db.transaction` → `withTenantContext`).
- `sync-stocks` — delete + chunked insert `rawApiStocks` (`db.transaction` → `withTenantContext`).
- `sync-stock-offices` — insert `rawApiStockOffices`.
- `sync-stock-sizes` — parallel select (`rawApiSales` groupBy + `rawApiStocks` groupBy) **в одной tx**; затем insert `rawApiStockSizes`.
- `sync-tariffs` — insert `wbTariffSnapshots` (3 типа) + `wbCategoryCommissionSnapshots` в одной tx.
- `sync-region-sales` — delete + chunked insert `rawApiRegionSales` (в двух tx: delete, затем insert loop).
- `sync-sales` — chunked insert `rawApiSales`.
- `sync-paid-storage` — chunked insert `rawApiPaidStorage`.
- `sync-ads` — chunked insert `rawApiAdCosts`.
- `sync-ad-clusters` — nested loop, withTenantContext per keywords-batch (внутри внешнего per-itemsChunk loop с try/catch на WB batch failures).

**Не обёрнуто намеренно:**

- `db.query.tenants.findFirst` (get-tenant-token) — `tenants` не под RLS.
- `db.execute(sql\`INSERT INTO mv_refresh_runs ...\`)` (mv_refresh_runs, atomic claim) — таблица **не** в `0040_rls_enable.sql` (admin/infra-level), skip.
- `db.execute(sql\`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_pnl_final\`)` — global MVIEW refresh, не per-tenant.
- `db.execute(sql\`UPDATE mv_refresh_runs ...\`)` rollback claim — та же `mv_refresh_runs`, skip.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивно после Slices 1-6b:** ~60 runtime call-sites в 18 файлах. Критическая часть Inngest-слоя готова к flip-the-switch. Остаётся 6c (redistribution-rpa + redistribution-digest), 6d (admin sweeps + cross-tenant reads), большая часть advertising service layer и cross-cutting lib.

## 2026-04-19 · P0-03b Slice 6a — простые Inngest jobs (sync-orders/sync-finances/wb-ads-retry/wb-scheduled-sync) обёрнуты в withTenantContext

Шестой слайс (подслайс 6a) RLS runtime enforcement. Первый слайс Inngest-layer — критический путь для flip-the-switch, т.к. все jobs исполняются под `enterprise_wb_analytics_user` (`BYPASSRLS=false`).

**Покрыто (per-tenant mutations на tenant-scoped таблицах):**

- `src/server/jobs/sync-orders.ts` — chunked insert `raw_api_orders` во внутренний tx на каждый tenant (step `sync-tenant-{id}-orders`).
- `src/server/jobs/sync-finances.ts` — insert `raw_api_realization_reports` во внутренний tx.
- `src/server/jobs/wb-ads-retry.ts` — два step-точки покрыты: select `sync_runs` active-run check + insert `sync_runs` returning — каждый в свой tx. Tenants select остаётся на корневом db (не-RLS).
- `src/server/jobs/wb-scheduled-sync.ts` — execute `INSERT INTO sync_runs ... RETURNING id` per-tenant в tx.

**Skip с обоснованием:**

- `src/inngest/on-failure.ts` — только `db.query.tenants.*` (не-RLS), обёртка бесполезна.
- `src/inngest/stale-sync-alert.ts` — читает `sync_runs` с `inArray(tenantId, [...])` (cross-tenant sweep). **Admin-path**: no single tenantId. Сейчас работает через IS-NULL bypass; после flip-the-switch потребуется spec-UUID admin pattern или per-tenant loop. Отложено в Slice 6d (admin pattern).
- `src/inngest/sync-wb.ts`, `src/server/jobs/redistribution-rpa.ts`, `src/server/jobs/redistribution-digest.ts` — Slice 6b/6c (большие файлы, 30+11+8 call-sites).

**Test fix:** `src/server/jobs/sync-orders.test.ts` мокал `@/lib/db` без `withTenantContext`. Добавлен мок, проксирующий callback как `fn(mockDb)` — поведение handler идентично прежнему, моки onConflictDoUpdate/values срабатывают как раньше.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивно после Slices 1-6a:** ~37 runtime call-sites в 17 файлах.

## 2026-04-19 · P0-03b Slice 5 — economics service (6 public методов) обёрнут в withTenantContext

Пятый слайс RLS runtime enforcement. Первый service layer рефактор — `src/server/analytics/services/economics.ts` (2 531 LOC, вызывается из overview/economics/dynamics/stocks/explorer actions через `AnalyticsEngine.getDailyPnL / getUnitEconomics / getNetProfitBreakdown / getOrderHighlights / getKpis / getDashboardDataTrust`).

**Паттерн:** минимальная замена — `await db.execute(query)` → `await withTenantContext(db, tenantId, async (tx) => tx.execute(query))`. SQL-query объекты, их построение и постобработка не тронуты. Обёртка включает только запросы к tenant-scoped таблицам.

**Точечные обёртки (6 из 7 `db.execute` в файле):**

- `getDailyPnL` (line 450) — pnl query по raw_api_orders / raw_api_sales / raw_api_funnel_stats / raw_api_ad_costs / raw_api_realization_reports / raw_api_paid_storage.
- `getUnitEconomics` (line 718) — unit-экономика с воронкой.
- `getNetProfitBreakdown` (line 764) — breakdown rows. Первый `db.execute` (line 757, читает `tenants`) оставлен без обёртки — `tenants` не под RLS.
- `getOrderHighlights` (line 1107) — snapshot по funnel+products.
- `getKpis` (line 1570) — KPI с трендами. Единственный `db.execute` в большой функции (внутри conditional блока).
- `getDashboardDataTrust` (line 2251) — data-trust audit.

**Что не затронуто:**

- `tenants` selects — не RLS, не нужны.
- `engine.ts` static-делегаты остаются — продолжают работать без изменения сигнатуры, т.к. обёртка применяется внутри service.
- Внутренние builder-функции (`buildTaxAmountSql`, `buildNetProfitSql`) не трогают db.

**Архитектурная заметка:** сервис использует **собственную транзакцию на каждый public method**. Если route делает несколько сервисных вызовов (напр., `getKpis + getDailyPnL`), каждый открывает свой `withTenantContext`. Это корректно для RLS-изоляции, но на уровне transactional consistency ≠ single tx. Если потребуется, в будущих слайсах можно вынести `withTenantContext` на route-уровень и passed tx внутрь service — но это дорогой refactor сигнатур.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивный итог после Slices 1-5:**

- `grep -rn 'withTenantContext(' src/` — **~31 runtime call-sites в 13 файлах**.
- Покрытие: explorer / redistribution / economics (actions + service) / dynamics / stocks / settings (sync + bulk + notifications + visibility).
- **Следующие крупные цели:** `engine.ts` getSignals/getGroupDynamics + signal-* services, advertising services (workspace.ts 1700+ LOC), Inngest handlers (sync-wb.ts 950+ LOC), server/jobs, admin-paths (cabinets/user-actions).

## 2026-04-19 · P0-03b Slice 4 — dashboard actions (dynamics/stocks/settings/sync/bulk) обёрнуты в withTenantContext

Четвёртый слайс RLS runtime enforcement. Покрыты server actions под `src/app/(dashboard)/*` — входные точки для пользовательских мутаций из UI.

**Покрыто (tenant-scoped таблицы из `0040_rls_enable.sql`):**

- `src/app/(dashboard)/dynamics/actions.ts`:
  - `getGroups(tenantId)`, `createGroup(tenantId, name)` — `product_groups` внутри tx.
  - Member-operations (`addMemberToGroup`, `addMembersToGroup`, `removeMemberFromGroup`, `getGroupMembers`) НЕ обёрнуты: `product_group_members` **не в RLS-списке** (нет `tenant_id` колонки), защита идёт через FK product_groups → tenant + `requireGroupAccess`. Будет адресовано в Slice 6 (admin pattern для `requireGroupAccess`, который читает product_groups до tx).
- `src/app/(dashboard)/stocks/actions.ts`:
  - Все 5 actions (`upsertStockPlanningInput`, `getProductionOrders`, `createProductionOrder`, `updateProductionOrderStatus`, `deleteProductionOrder`) обёрнуты. Таблицы `stock_planning_inputs` и `production_orders` обе в RLS.
- `src/app/(dashboard)/settings/bulk-actions.ts`:
  - `bulkUpsertCosts(tenantId, items)` — весь цикл chunked-upsert по `unit_economics_configs` в одной tx.
- `src/app/(dashboard)/settings/sync-action.ts`:
  - `triggerWbSync` — `insert syncRuns returning` в tx, `inngest.send` вне tx, fail-path `update syncRuns` в отдельной tx.
  - `getLatestSyncRun`, `getSyncRunsHistory` — select в tx.
  - `expireStaleSyncRuns` (internal helper) — update в tx.
  - `getTenantSyncPrerequisites` — `select from tenants` без обёртки (`tenants` не под RLS).
- `src/app/(dashboard)/settings/actions.ts`:
  - `getTenantSettings` — partial wrap: `select from userTenants` обёрнут (user_tenants в RLS), `select from tenants` остаётся (не под RLS).
  - `updateInAppSignalNotificationPreferences` — `update userTenants` в tx.
  - `toggleProductVisibility` — `update products` в tx.

**НЕ покрыто в Slice 4 — намеренно:**

- `settings/actions.ts`: `verifyWbLkSession`, `validateWbToken`, `saveApiToken`, `updateTenantSettings` — все пишут в `tenants` (root, не под RLS). Обёртка не даёт RLS-защиты, skip.
- `settings/actions.ts`: `getAvailableTenants`, `switchActiveTenant`, `addCabinet` — **admin-path**: чтение `user_tenants leftJoin tenants` без единого `tenantId`, создание нового tenant. Будет в Slice 6 (spec-UUID/admin-pool pattern).
- `cabinets/user-actions.ts` — admin-path, Slice 6.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

**Кумулятивный итог после Slices 1-4:**

- `grep -rn 'withTenantContext(' src/` — **~25 runtime call-sites в 12 файлах** (было 0 перед P0-03b).
- Покрытие routes+actions-слоя: explorer/redistribution/economics/dynamics/stocks/settings (sync + bulk + notifications + visibility) + reviews-qa (out-of-scope обоснованно).
- Не покрыто: economics-template route (1109 LOC), analytics engine+services (Slice 5), advertising, Inngest+jobs, cross-cutting lib, admin-paths.
- Policy flip-the-switch НЕ готов — Inngest-прод до сих пор видит всё через IS-NULL bypass.

## 2026-04-19 · P0-03b Slice 3 — economics server actions обёрнуты в withTenantContext; reviews-qa зафиксирован как out-of-scope

Третий слайс RLS runtime enforcement. Покрыты 4 server actions в `src/app/(dashboard)/economics/actions.ts` — все трогают `unitEconomicsConfigs`, `unitEconomicsManualInputs`, `products` (все три — tenant-scoped таблицы в `0040_rls_enable.sql`).

**Что сделано:**

- `src/app/(dashboard)/economics/actions.ts`:
  - `updateCostPrice(tenantId, nmId, costPrice)` — `db.insert(unitEconomicsConfigs).onConflictDoUpdate` внутри `withTenantContext`.
  - `saveUnitEconomicsManualFields(tenantId, nmId, manualFields)` — `db.insert(unitEconomicsManualInputs).onConflictDoUpdate` внутри `withTenantContext`.
  - `getHiddenProducts(tenantId)` — `db.select(products)` с `isHidden=true` внутри `withTenantContext`, `.map` наружу.
  - `restoreHiddenProduct(tenantId, nmId)` — `db.update(products)` внутри `withTenantContext`.
  - `recalculateCostPriceEverywhere(tenantId)` не затронут — это чистый `revalidatePath`, без DB.
  - Все `requireTenantAccess` / `requireTenantAccess(role)` и `revalidatePath` остаются вне tx — побочки и проверки не внутри транзакции.

**Reviews-QA — зафиксирован как out of scope для P0-03b:**

После анализа выяснилось, что весь reviews-qa stack работает **не** с tenant-scoped таблицами:

- `/api/views/reviews-qa/reply/route.ts` — `db.select(tenants)`: таблица `tenants` **не в RLS** (root, без `tenant_id`).
- `/api/views/reviews-qa/publish/route.ts` — thin wrapper, прямых `db.*` нет; вызывает `publishWbReply` (HTTP к WB API).
- `/api/views/reviews-qa/auto/route.ts` — `db.select/update(tenants)`: `tenants` не в RLS.
- `src/server/reviews-qa/wb-feedback.ts` (678 LOC) — единственный `db.select` — `db.select(tenants.wbApiToken).from(tenants).where(id)` для получения токена, всё остальное — HTTP к `feedbacks-api.wildberries.ru`.
- `src/server/reviews-qa/auto-reply.ts` (171 LOC) — `runDueReviewsQaAutoReplies()` читает `tenants.reviewsAutoReplyEnabled` для шедулера (admin-path over root table), всё per-tenant — HTTP.

Итог: обёртка `withTenantContext` не добавляет реальной RLS-защиты reviews-qa, т.к. RLS-policy не применяется к `tenants`. Tenant-binding для reviews-qa уже сделан в round 1 (`requireTenantMatchesActive` body=cookie). План P0-03b обновлён, reviews-qa снят из списка целевых слайсов.

**Обновление плана:**

- Пункт 3 плана (reviews-qa): переформулирован как «out of scope — no tenant-scoped footprint».
- Следующий слайс — Slice 4: `src/app/api/views/economics-template/route.ts` (1 109 LOC, 6+ прямых `db.select` по `unitEconomicsManualInputs` / `wbTariffSnapshots` / `wbCategoryCommissionSnapshots` + raw SQL в `getBuyoutFactsByNm` по `raw_api_orders` / `raw_api_sales`). Плюс в будущих слайсах: `analytics/engine.ts` и `services/economics.ts` (те, что дергаются внутри `AnalyticsEngine.getUnitEconomics`).

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

## 2026-04-19 · P0-03b Slice 2 — redistribution routes (direct db.*) обёрнуты в withTenantContext

Второй слайс RLS runtime enforcement. Покрыты 5 API-роутов `/api/views/redistribution/*`, где handler делал `db.select/insert/update` напрямую. Три тонких роута (`export`, `route-scan`, `slot-monitor`) вызывают только сервисы — они остаются в Slice 2b (когда будут обёрнуты сами сервисы).

**Что сделано:**

- `src/app/api/views/redistribution/run-status/route.ts` — GET: два `tx.select` (runs + item status counts) объединены в один `withTenantContext`, возвращают `{ run, itemStatuses }` наружу.
- `src/app/api/views/redistribution/run-preview/route.ts` — GET: выбор run по runId/latest + select items — в одном tx, затем unwrapping для 404 / payload построение вне tx.
- `src/app/api/views/redistribution/run-csv/route.ts` — GET: select run metadata + items внутри одного tx. CSV-билд и FS fallback вынесены из tx, чтобы не держать коннекшн на время `readFile`.
- `src/app/api/views/redistribution/run-action/route.ts` — POST: лукап run в tx; в `reject`-ветке — tx с двумя `update` (runs + items); в `queue_rpa` — tx с двумя `update`. Inngest.send между чтением и вторым tx (HTTP-побочка НЕ в транзакции).
- `src/app/api/views/redistribution/run-create/route.ts` — POST: objединённая tx для `insert run returning + chunked insert items` (атомарно, как и было через `db.transaction`); затем FS `saveRunCsvFile` вне tx; затем отдельная tx на `update run` с csv metadata. `getRedistributionPlan` и `applyRouteAvailabilityFilterToPlan` пока остаются на корневом `db` — их обёртка в Slice 2b вместе с `src/server/redistribution/*.ts`.

**Паттерн:** tx-ловушка открывается строго вокруг DB-операций. Сеть (`inngest.send`), файловая система (`writeFile`/`readFile`), парсинг и сервисные вычисления — вне tx, чтобы не держать коннекшн и не блокировать транзакцию на IO.

**Не затронуто в этом слайсе:**

- `src/app/api/views/redistribution/export/route.ts`, `route-scan/route.ts`, `slot-monitor/route.ts` — тонкие обёртки над сервисами без прямых `db.*`. Будут покрыты в Slice 2b через обёртку сервисов (`getRedistributionPlan`, `applyRouteAvailabilityFilterToPlan`, `getRouteScanOverview`, `runRouteScanForTenant`, `runSlotMonitorForTenant`).
- `src/server/redistribution/*.ts` (1 200+ LOC двух файлов route-scan/slot-monitor) — Slice 2b.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

## 2026-04-19 · P0-03b Slice 1 — pilot explorer route обёрнут в withTenantContext

Первый слайс RLS runtime enforcement (см. P0-03b в `ENTERPRISE_LAUNCH_CHECKLIST.md`). До этого коммита `withTenantContext` существовал, но в runtime не вызывался ни разу (grep находил только `src/lib/db/rls.test.ts`) — policy `tenant_isolation` защищала данные только благодаря IS-NULL bypass в формуле.

**Что сделано:**

- `src/app/api/views/explorer/route.ts` (64 → 67 LOC) — весь `GET`-хендлер обёрнут в `withTenantContext(db, tenantId, async (tx) => …)`. Все 5 вариантов (`orders`/`realizations`/`ads`/`funnel`/`prices`) теперь исполняются через транзакцию с `SET LOCAL app.tenant_id`. App-level `eq(tenantId)` фильтры оставлены как defense-in-depth — не удаляем до ужесточения policy. Валидация `type` вынесена до открытия транзакции, чтобы 400 не держал коннекшн.
- `src/lib/db/index.ts` — сигнатура `withTenantContext` ужесточена: `database: DrizzleDatabase`, `fn: (tx: DrizzleTransaction) => Promise<T>` (экспортируем новые type-алиасы). Раньше был duck-typed interface `{ transaction, execute }` и внутренний `as unknown` каст → при попытке передать реальный `db` TS выдавал TS2345. Теперь tx внутри fn имеет корректный `PgTransaction<PostgresJsQueryResultHKT, schema>` тип и `tx.select/insert/update/delete` работают без кастов.

**Не затронуто:**

- Остальные 61 файлов, импортирующих `@/lib/db`, продолжают работать через IS-NULL bypass. Это сознательно — slice-by-slice миграция по плану P0-03b (11 слайсов), flip-the-switch policy (`0041_rls_strict.sql`) только после Slice 9.
- Существующий unit-тест `src/lib/db/rls.test.ts` — mock db передаётся через `as never`, сигнатурное ужесточение не ломает его.

**Checks:** typecheck ✅, test 385/385 ✅, build ✅.

## 2026-04-19 · Audit remediation round 1 — tsc clean, typecheck gate, reviews-qa tenant binding

Следствие полного аудита от 2026-04-19 (семь P1/P2 находок). Закрыта безопасная локальная часть; оставшиеся P1 требуют отдельных решений на проде.

**Закрыто:**

- **tsc clean на main.** 27 TS-ошибок в тест-файлах починены:
  - `src/lib/encryption.test.ts` — `AppError` теперь импортируется как type (`AppErrorType`) для использования в `as`-кастах, т.к. `const { AppError } = await import(...)` — это value, не type.
  - `src/server/jobs/*.test.ts` (6 файлов) — подпись `_handler` на фиктивном job-объекте изменена с `=> unknown` на `=> Promise<any>` с `eslint-disable-next-line`, чтобы типизированный доступ к полям `result` работал.
  - `src/server/jobs/sync-orders.test.ts` — добавлен `!` assertion на `mock.calls[0]!` под strictNullChecks.
- **typecheck wired в release gate.** Новый npm-скрипт `typecheck: tsc --noEmit` + новая проверка в `scripts/release-baseline.mjs` между `lint` и `test`. Теперь red tsc валит `predeploy:gate`, а не просто висит незамеченным.
- **Reviews-QA: tenant_id из body vs cookie выровнен.** Новый хелпер `requireTenantMatchesActive(bodyTenantId, roles)` в `src/lib/auth/tenant-access.ts` проверяет, что `active_tenant_id` cookie совпадает с `payload.tenantId`. Прокинут в `publish`, `reply`, `auto` routes вместо прежнего `requireTenantAccess(payload.tenantId, roles)`. Риск устранён: mutation, rate-limit и idempotency теперь ключуются по одному и тому же tenant; оператор с доступом к нескольким кабинетам не может действовать в неактивном контексте через body-override. При несовпадении — 400 `Активный кабинет не совпадает с телом запроса`.

**Checks:** lint ✅, typecheck ✅, build ✅, test 356/356 ✅. `release-baseline --report-only`: PASS lint/typecheck/build/test, FAIL worktree (локальные правки, ожидаемо) + drizzle (структурная коллизия 0036..0044, pre-existing).

**Не закрыто — требует отдельных решений (см. аудит 2026-04-19):**

- **P1 Inngest prod в dev-режиме** (`INNGEST_DEV=1`, пусто `INNGEST_SIGNING_KEY`) — код `src/app/api/inngest/route.ts` уже имеет корректный fail-closed guard (`503` без signing key), но только если `INNGEST_DEV` не выставлен. Нужно решение: self-hosted Inngest или Inngest Cloud. Правка env на сервере.
- **P1 RLS runtime не применяется.** `withTenantContext` определён в `src/lib/db/index.ts`, но в runtime НЕ вызывается (grep нашёл только `src/lib/db/rls.test.ts`). Policy на проде допускают `app.tenant_id IS NULL`. Нужна адаптация dao-слоя под RLS — крупный рефакторинг.
- **P1 drizzle journal collision** — snapshots `0036..0044` идентичны (ручные SQL-миграции без `drizzle-kit generate`). Требуется либо regenerate snapshot chain, либо baseline-reset. Риск: нельзя честно проверить schema drift.
- **P2 local DB отстаёт на 19 миграций** от prod — `npm run db:migrate` при корректной `DATABASE_URL`.

## 2026-04-19 · Thompson Sampling shadow-mode в workspace.ts (P72b)

`StrategyAutopilotConfig` расширен полями `policy` (`epsilon_greedy` | `thompson_beta` | `thompson_normal`, default `epsilon_greedy`) и `rewardKind` (`position_hit` | `economic_delta`, default `position_hit`). Все существующие стратегии продолжают работать на epsilon-greedy без изменений.

`StrategyLearningState.bandit?` — опциональный posterior (Beta-Bernoulli или Normal-Normal) с полной round-trip сериализацией/десериализацией в `readLearningStateFromSummary`. Санитизация пропусков, негативных значений и невалидной policy даёт безопасный дефолт.

Новый `src/lib/advertising/bandits/integration.ts` — мост между чистой математикой (P72a) и runtime:

- `createEmptyBanditState`, `ensureBanditStateMatches` — инициализация и migration при смене policy/rewardKind (без миксованных posteriors).
- `pickBanditShadow` — детерминированный выбор arm'а с независимым seed (salt `'bandit'`).
- `computeBanditReward` — `position_hit` → {0, 1}, `economic_delta` → `log(targetAcos/observedAcos)`, clipped [-3, 3].
- `updateBanditPosterior` — онлайн Beta-update или Welford Normal-update, инкремент `shadowDelta` (matches/mismatches/total).

`executeStrategyRun` (workspace.ts) теперь:

- Считает `banditShadow` параллельно с epsilon-greedy `learningTarget`, но **применяет всё равно epsilon-greedy** (без регрессий для существующих стратегий).
- Обновляет posterior для реально отработавшего arm'а (`learningTarget.key`), а не для того, что выбрал bandit — честное обучение на наблюдённых данных всех arm-ов.
- Обновление только при `runStatus ∈ {applied, skipped}`; guardrail-suppressed runs posterior не трогает (чтобы bandit не штрафовал arm за то, что выключили tenant autopilot).
- Логирует `summary.banditShadow` для будущего dashboard (P72c): `{ policy, pickedKey, appliedKey, matchedApplied, samples, rewardKind, observedAcosPct }`.

Без миграций БД — новый state живёт в существующем jsonb-поле `lastSummary.learningState.bandit`. Zero-risk deploy: если policy не включена, код-путь банд не вызывается.

- Checks: build ✅, tests **385/385** (+29 новых), lint clean.

## 2026-04-19 · Bandit math foundation для autopilot (P72a)

`src/lib/advertising/bandits/` — новый модуль с чистой математикой Thompson Sampling:

- **`prng.ts`** — детерминированный mulberry32 PRNG, samplers Normal (Box-Muller), Gamma (Marsaglia-Tsang), Beta (через Gamma).
- **`thompson.ts`** — Beta-Bernoulli и Normal-Normal posterior, arg-max выбор arm'а, Monte-Carlo оценка `P(arm is best)`, онлайн-обновление через Welford.

Модуль additive: без изменений БД, без правок `workspace.ts` и существующего `self-learning.ts`. Интеграция запланирована на P72b (shadow-mode).

Открытые вопросы P72 закрыты в design doc [`docs/advertising/BANDIT_AUTOPILOT_DESIGN.md`](advertising/BANDIT_AUTOPILOT_DESIGN.md): выбор алгоритма (Beta vs Normal), reward design (position_hit / economic_delta), cold start через priors Beta(1,1)/Normal(0,1), интеграция с P65 guardrails (update posterior только при `runStatus ∈ {applied, skipped}`).

P72 декомпозирован на подслайсы P72a (done), P72b (integration + shadow-mode), P72c (BanditInsights UI + LinUCB), P72d (A/B split, объединён с P74).

- Checks: bandit tests 28/28 ✅, full suite 356/356 ✅, build ✅, lint baseline.

## 2026-04-19 · BidWorkspaceContext — React Context for shared state (P71)

`src/components/advertising/workspace/context/BidWorkspaceContext.tsx` создан (76 LOC).

Устранён props-drilling в трёх тяжёлых tab-компонентах:

- **BidsTab**: 37 props → 0. Bulk-form state (bulkMode, bulkValue, bulkMinBid, bulkMaxBid, preview, needsConfirm, search, selection) + `bulkBidMutation` перенесены внутрь.
- **Ads2Tab**: 27 props → 0. Filter state (search, riskOnly, onlyChanged, statusFilter, activeCluster, bottomTab) + derived calculations (summary, visibleRows, activeRow, activeMapRow) перенесены внутрь.
- **StrategiesTab**: 37 props → 0. Draft/editing state + `strategyMutation` + `applyTemplate`/`saveFromTemplate` перенесены внутрь. Доступ к `clusterToggleMutation` через контекст.

Контекст предоставляет: `guardrail` state, `bidsQuery`/`clusterMapQuery`/`strategiesQuery`, `strategyById`, `strategyByCampaignKey`, `latestRunByStrategyId`, `strategyClusterRows`, `strategyTodaySummary`, `strategyAutopilotInsights`, `ads2ChangedClusterSet`, `clusterToggleMutation`, `mapActionMessage`.

`AdvertisingBidWorkspace` упрощён: BidsTab/Ads2Tab/StrategiesTab вызываются без props.

- Checks: build ✅, tests 328/328 ✅.
- Commit: `ea57cba`

## 2026-04-19 · engine.ts Slice 9 — SignalFeedService extraction (P82)

`src/server/analytics/services/signal-feed.ts` создан (157 LOC). Из `signal-core.ts` вынесен feed + bulk кластер — 7 методов:

- **getSignalsFeed** — агрегированный фид сигналов с assignees, saved views, automation runs.
- **bulkUpdateSignalStatus** — bulk resolved/ignored (перенесён из inline-кода engine.ts).
- **bulkAssignSignalOwner** — последовательное назначение владельца по списку signalIds.
- **bulkUpdateSignalWorkflowState** — bulk смена workflow state.
- **bulkAddSignalNote** — bulk добавление заметки.
- **bulkApplySignalHandoffPreset** — preset: assign + workflow_state + note одной операцией.
- **dispatchSignalCollaborationNotification** — ре-экспорт из signal-core (функция остаётся там, т.к. нужна внутри assignSignalOwner/updateSignalWorkflowState).

`AnalyticsEngine` делегирует все методы через `= SignalFeedService.X`. `signal-sla-execution.ts` обновлён: `SignalCoreService.bulkApplySignalHandoffPreset` → `SignalFeedService.bulkApplySignalHandoffPreset`. `inArray` удалён из импортов engine.ts. `SignalSavedViewsService` и `SignalAutomationQueriesService` удалены из импортов signal-core.ts.

**signal-core.ts**: 895 → 778 LOC (**−117**). **engine.ts**: 995 → 973 LOC (**−22**, inline bulkUpdateSignalStatus заменён делегированием). Примечание: цель ~500 LOC для engine.ts недостижима в данном слайсе — `getGroupDynamics` сам по себе ~590 LOC SQL-запрос, `getSignals` ~150 LOC.

- Checks: build ✅, lint ✅ (0 проблем), tests 328/328 ✅.

## 2026-04-19 · engine.ts Slice 8 — SignalSlaExecutionService extraction (P81)

`src/server/analytics/services/signal-sla-execution.ts` создан (1041 LOC). Из `engine.ts` вынесен SLA execution cluster — 7 методов:

- **previewSignalSlaAutomation** — dry-run preview с подсчётом eligible/affected/suppressed.
- **setSignalAutomationSuppression** — создание suppression для saved_view или queue_owner.
- **clearSignalAutomationSuppression** — снятие активного suppression.
- **captureSignalFollowUpResolution** — запись outcome (acknowledged / action_taken / no_action).
- **runSignalSlaAutomation** — основной SLA-run с дедупликацией и записью automation run.
- **runSignalSlaPendingFollowUp** — follow-up напоминания + escalation alerts для одного run.
- **runSignalSlaPendingFollowUpSweep** — sweep по всем completed runs за 72 ч с учётом suppressions.

`AnalyticsEngine` сохраняет обратную совместимость через делегирующие static-поля `= SignalSlaExecutionService.X`. Все `this.X` внутри SLA-методов заменены на прямые вызовы `SignalAutomationQueriesService.X`, `SignalCoreService.X` и внутри-файловые. Неиспользуемые импорты (`logger`, `desc`, `gte`, signal-helpers, SLA-типы, schema-таблицы SLA) удалены из engine.ts.

**engine.ts**: 2016 → 995 LOC (**−1021**). Итого с Slice 1: 8047 → 995 (**−88%**).

- Коммит `0d8d7a9`, branch `claude/brave-jemison-e85bd2`.
- Checks: build ✅, lint ✅ (0 проблем), tests 328/328 ✅.

## 2026-04-19 · engine.ts Slice 7 — EconomicsService extraction (P80)

`src/server/analytics/services/economics.ts` создан (2531 LOC). Из `engine.ts` вынесены 6 методов economics-кластера:

- **getDailyPnL** — дневная динамика выручки и чистой прибыли.
- **getUnitEconomics** — unit-экономика по SKU с рекламой и воронкой.
- **getNetProfitBreakdown** — разбивка чистой прибыли на составляющие.
- **getOrderHighlights** — топ/аутсайдеры SKU по заказам.
- **getKpis** — KPI-карточки с трендами (vs предыдущий период).
- **getDashboardDataTrust** — аудит достоверности данных дашборда.

`AnalyticsEngine` сохраняет обратную совместимость через делегирующие static-поля `= EconomicsService.X`. Типы `EconomicsCalculationMode`, `DataTrustStatus`, `DataTrustCheck`, `DashboardDataTrustAudit` перенесены в economics.ts и re-exported из engine.ts для внешних импортов. Callback `getUnitEconomics` в `getSignalDetails` (signal-core.ts) обновлён на `EconomicsService.getUnitEconomics`.

**engine.ts**: 4522 → 2016 LOC (**−2506**). Итого с Slice 1: 8047 → 2016 (**−75%**).

- PR [#46](https://github.com/viteab-source/enterprise-wb-analytics/pull/46), коммит `e5965b4`.
- Checks: build ✅, lint ✅ (0 проблем), tests 328/328 ✅.
- Deployed: goalbot SHA `e5965b4`, health ok.

## 2026-04-19 · engine.ts Slice 6 — SignalCoreService extraction (P79)

`src/server/analytics/services/signal-core.ts` создан (895 LOC). Из `engine.ts` вынесены 17 методов signal core domain:

- **getActiveSignals, recordSignalTimelineEvent, recordSignalView, getSignalTimeline, getSignalWorkflowMembers, getLatestSignalEscalations** — базовые операции над сигналами и timeline.
- **dispatchSignalCollaborationNotification** — Telegram-нотификации при коллаборации.
- **getSignalDetails** — полная карточка сигнала; зависимость на `getUnitEconomics` передаётся через опциональный `getUnitEconomics` callback (устраняет циклический импорт до P80).
- **assignSignalOwner, updateSignalWorkflowState, addSignalNote, updateSignalStatus** — мутации workflow.
- **getSignalsFeed** — агрегированный фид, теперь импортирует из `signal-automation-queries.ts`.
- **bulkAssignSignalOwner, bulkUpdateSignalWorkflowState, bulkAddSignalNote, bulkApplySignalHandoffPreset** — bulk-операции (не зависят от SLA).

`AnalyticsEngine` сохраняет обратную совместимость через делегирующие static-поля `= SignalCoreService.X`.

**engine.ts**: 5340 → 4522 LOC (**−818**). Итого с Slice 1: 8047 → 4522 (**−44%**).

- Checks: build ✅, lint ✅, tests 328/328 ✅.
- Блокер снят: P80 (EconomicsService), P81 (SignalSlaExecution), P82 (SignalsFeed bulk) теперь разблокированы.

## 2026-04-19 · Собственный db-migrate: избавление от silent-skip бага drizzle-kit

Во время deploy-а perf-слайса `drizzle-kit migrate` v0.31.10 тихо пропустил миграции 0045 и 0046, но отрапортовал `[✓] migrations applied successfully!`. Индексы и materialized view не были созданы; обнаружили только при проверке `EXPLAIN ANALYZE`. Перевёл `db:migrate` на собственный скрипт, где такая тихая потеря невозможна.

- **feat(scripts):** [scripts/db-migrate.mjs](scripts/db-migrate.mjs) — читает `drizzle/meta/_journal.json`, SHA256-ит каждую запись, сверяет с `drizzle.__drizzle_migrations.hash`, применяет всё недостающее через `postgres.js` с детальными логами `[db:migrate] applying <tag> [N stmts, TX|NO-TX]`. Не может «забыть» миграцию: pending-список печатается явно, каждая применяется или фейлится с ясной ошибкой.
- **feat(scripts):** поддержка маркера `-- @no-transaction` в первых 10 строках файла — миграция применяется без `BEGIN`, что нужно для `CREATE INDEX CONCURRENTLY` / `REFRESH MATERIALIZED VIEW CONCURRENTLY`. По-умолчанию всё в одной транзакции на миграцию.
- **chore(scripts):** `package.json` — `db:migrate` переключён на новый скрипт; старый drizzle-kit доступен как `db:migrate:drizzle-kit` (на случай backup workflow).
- **docs:** [docs/operations/DEPLOY_PROCEDURE.md](docs/operations/DEPLOY_PROCEDURE.md) — раздел «About `npm run db:migrate`» объясняет причину и use-case `-- @no-transaction`.
- **Verify:** smoke-тест на prod — `node scripts/db-migrate.mjs` вернул `0 pending (47 total, all applied)`. Build ✅, lint ✅.
- **Follow-up:** отдельно открыть issue в drizzle-team/drizzle-kit с минимальным репро silent-skip поведения (приоритет низкий, поскольку у нас теперь обход).

## 2026-04-19 · Dashboard hot-path: MV `mv_daily_pnl_final` + debounce REFRESH

Продолжение работы ниже — все три тяжёлых метода дашборда (`getDailyPnL`, `getKpis`, `getUnitEconomics`) переключены на единый materialized view поверх realization-reports. Добавлен atomic-debounce на REFRESH, чтобы burst синков не выстраивался в очередь.

- **db(migration 0046):** [drizzle/0046_daily_pnl_materialized_view.sql](drizzle/0046_daily_pnl_materialized_view.sql). `mv_daily_pnl_final(tenant_id, day, nm_id, revenue, payout_before_cost, quantity_for_cost, total_quantity, commission, logistics, other_fees, storage_fee, spp_rub)` — агрегат по (tenant, день, SKU) поверх `raw_api_realization_reports`. **Без** `cost_price` внутри: `profit = payout_before_cost − quantity_for_cost × latest.cost_price` и `total_cost = quantity_for_cost × latest.cost_price` считаются на read-time через JOIN с `cost_price_latest` / `latest_costs` CTE, так что обновления в `unit_economics_configs` видны сразу, без ожидания REFRESH. Индексы: `UNIQUE (tenant_id, day, nm_id)` (обязателен для `REFRESH CONCURRENTLY`) и `(tenant_id, day)` для range-сканов. Инициализация: `WITH NO DATA` + `REFRESH` в той же миграции (первичная загрузка — non-concurrent, ОК: читатели ещё не активны). Также в миграции — таблица `mv_refresh_runs(mv_name text PK, last_refreshed_at timestamptz)` под debounce.
- **perf(analytics):** [src/server/analytics/engine.ts](src/server/analytics/engine.ts) — переведены на MV:
  - `getDailyPnL`: финальная ветка `unified_sales` и `daily_spp` CTE ([engine.ts:353](src/server/analytics/engine.ts:353), [engine.ts:490](src/server/analytics/engine.ts:490)).
  - `getKpis`: `unified_sales` (финал), `finance_buyout_total`, `finance_storage_total`, `spp_total` ([engine.ts:1430](src/server/analytics/engine.ts:1430), [engine.ts:1494](src/server/analytics/engine.ts:1494), [engine.ts:1510](src/server/analytics/engine.ts:1510), [engine.ts:1528](src/server/analytics/engine.ts:1528)).
  - `getUnitEconomics`: финальная ветка `unified_sales` ([engine.ts:743](src/server/analytics/engine.ts:743)).
  - Provisional-хвосты (из `raw_api_sales` с margin_ratio) не тронуты — они осмысленны только после `reconciliation_cutoff` и принципиально не ложатся в MV без дублирования.
  - Семантика сохранена: все фильтры `products.is_hidden` и JOIN-ы к `tenants.tax_type/tax_rate` остаются на read-time.
- **feat(debounce):** [src/inngest/sync-wb.ts:1561](src/inngest/sync-wb.ts:1561) — перед `REFRESH MATERIALIZED VIEW CONCURRENTLY` атомарно claim-ится слот:
  ```sql
  INSERT INTO mv_refresh_runs (mv_name, last_refreshed_at) VALUES ('mv_daily_pnl_final', NOW())
  ON CONFLICT (mv_name) DO UPDATE SET last_refreshed_at = NOW()
  WHERE mv_refresh_runs.last_refreshed_at <= NOW() - INTERVAL '60 seconds'
  RETURNING 1;
  ```
  Если RETURNING вернул 0 строк — другой sync уже обновил MV в последние 60 с, skip. Если REFRESH упал — timestamp откатывается назад на `- 60s`, чтобы следующий sync мог retry без ожидания. 10 тенантов синкаются параллельно → 1 REFRESH вместо 10. REFRESH по-прежнему стартует только если в `sourceResults` есть `realization_reports` со статусом `success` — быстрые синки (orders/sales/ads) его не будят.
- **schema:** [src/lib/db/schema.ts](src/lib/db/schema.ts) — `mvRefreshRuns` pgTable, чтобы drizzle-kit видел таблицу при следующем `generate`.
- **Ожидаемый профит по latency:** раньше каждый запрос к `/api/views/dashboard` делал ~4 полных скана `raw_api_realization_reports` (в `getDailyPnL.unified_sales`, `getDailyPnL.daily_spp`, `getKpis.unified_sales`, `getKpis.finance_*`, `getUnitEconomics.unified_sales`) — на tenant с 2 годами истории это ~100K+ rows × CASE-арифметика на каждую. Теперь — range-скан ~1.5K rows/мес из MV с минимальной арифметикой + один scan `cost_price_latest` (<100 rows per tenant). Ожидаемое ускорение на 30-дневном окне: **5–20×** для `getDailyPnL`, **3–10×** для `getKpis` и `getUnitEconomics`.
- **Ограничения:**
  - `getDashboardDataTrust` пока не переведён (живёт на отдельном медленном эндпоинте, не блокирует первый кадр дашборда).
  - Advertising/stocks/funnel метрики из других таблиц не кешируются этим MV — отдельная работа.
  - Первый запрос пустого MV после миграции, если sync ещё не запускался, вернёт 0 для финальных данных; provisional-хвост покроет операционную часть.
- **Verify:** `npx tsc --noEmit` ✅ (чисто), `npm run lint` ✅ (0 warn), `npm run build` ✅.

## 2026-04-19 · Dashboard hot-path: кэш по тегам, индексы, DISTINCT ON, клиентский таймаут

Исправлен «вечный спиннер» на `/overview`. Корневая причина — `/api/views/dashboard` гнал пять тяжёлых SQL параллельно (KPI, dailyPnL, unitEconomics, orderHighlights, dataTrust) с `force-dynamic` + `cache: 'no-store'` на каждый заход. Плюс `LEFT JOIN LATERAL (unit_economics_configs …)` выполнялся построчно на `raw_api_realization_reports`/`raw_api_sales` (N+1 внутри SQL).

- **perf(api/dashboard):** `src/app/api/views/dashboard/route.ts` — убран `force-dynamic`, убран неиспользуемый `dataTrust` из payload, добавлен `unstable_cache` с per-tenant ключом и тегом (`revalidate = 60`). Медленный `getDashboardDataTrust` вынесен в отдельный эндпоинт `src/app/api/views/dashboard/data-trust/route.ts` — он отдаётся по запросу и не блокирует первый кадр KPI/графика/товаров.
- **perf(analytics):** `src/server/analytics/engine.ts` — `LEFT JOIN LATERAL (SELECT cost_price FROM unit_economics_configs … ORDER BY effective_from DESC LIMIT 1)` заменён на CTE `cost_price_latest / latest_costs` через `SELECT DISTINCT ON (nm_id) …` + `LEFT JOIN`. Затронуты `getDailyPnL`, `getKpis`, `getUnitEconomics` (последний уже имел подобный CTE, но дублировал LATERAL поверх).
- **db(migration 0045):** `drizzle/0045_dashboard_hot_path_indexes.sql` + `src/lib/db/schema.ts` — индексы `paid_storage_tenant_date_idx`, `sales_tenant_date_active_idx` (partial `is_storno = false`), `orders_tenant_date_active_idx` (partial `is_cancel = false`), `funnel_stats_tenant_daily_idx` (partial `period_start = period_end`). В журнал добавлены пропущенные идентификаторы 0044 + 0045; snapshot `0045_snapshot.json` обновлён с новыми индексами.
- **feat(cache):** `src/lib/analytics/dashboard-cache.ts` — helper `createTenantDashboardCache`, константы тегов (`dashboard:{tenantId}`, `dashboard-data-trust:{tenantId}`), функция `invalidateDashboardCache`. Используется в fast- и slow-эндпоинтах.
- **feat(invalidation):** `src/app/(dashboard)/settings/sync-action.ts` и `src/inngest/sync-wb.ts` — после `triggerWbSync` и в `finalize-sync-run` вызывается `invalidateDashboardCache(tenantId)`, чтобы следующий fetch получил свежие данные сразу после sync-а (обе точки работают внутри Next.js-процесса, поэтому `revalidateTag` доходит до Data Cache).
- **ux(client):** `src/app/(dashboard)/overview/OverviewPageClient.tsx` — убран `cache: 'no-store'`, добавлен `AbortController` на 30 с с человеко-читаемой ошибкой, `enabled: Boolean(tenantId)` на запрос (дашборд больше не стартует до резолва tenant-cookie и не перегружает сервер при `tenantId = null`).
- **Verify:** `npx tsc --noEmit` ✅ (новые файлы чисты; остались предсуществующие TS-ошибки в `*.test.ts`, не связаны с задачей). `npm run lint` ✅. `npm run build` ✅ (роуты `/api/views/dashboard` и `/api/views/dashboard/data-trust` корректно помечены `ƒ dynamic`).
- **Ограничения:** `revalidate = 60` действует на статический route-cache, но поскольку handler читает cookies, Next.js помечает его как dynamic — реальный кэш обеспечивает `unstable_cache` по ключу `(tenantId, from, to)` с тегом. Материализованные представления (`mv_daily_pnl`) и пересчёт через Inngest не вошли в этот слайс — отдельный тикет в бэклог.

## 2026-04-19 · Wave 2 prep — self-learning автопилот вынесен в pure lib + 27 unit-тестов

**Первый подход к P72 ML-автопилоту.** Существующий self_learning режим (epsilon-greedy с 4 arms позиций 1-2/2-3/3-5/4-6) был закопан в `src/server/advertising/workspace.ts` без тестов. Вынес в `src/lib/advertising/self-learning.ts` для testability и будущей замены на полноценные Bayesian bandits (Thompson Sampling) без регрессии.

- **refactor(advertising):** создан `src/lib/advertising/self-learning.ts` (345 LOC): типы `StrategyControlMode`/`StrategyAutopilotConfig`/`StrategyLearningState`/`LearningArmKey`/`LearningArmState`/`SelfLearningPick`; константы `SELF_LEARNING_POSITION_ARMS`/`DEFAULT_STRATEGY_AUTOPILOT_CONFIG`; 10 pure-функций (`learningArmKey`, `createEmpty*`/`createDefault*`, `normalizeAutopilotConfig`, `readAutopilotConfigFromSummary`, `mergeAutopilotConfigIntoSummary`, `readLearningStateFromSummary`, `mergeLearningStateIntoSummary`, `buildDeterministicSeed`, `pickSelfLearningTarget`, `isPositionInRange`).
- **test(advertising):** `src/lib/advertising/self-learning.test.ts` (301 LOC) — **27 unit-тестов**, покрывают:
  - bounds/clamp правил для autopilotConfig (explorationPct, targetPositionFrom/To)
  - round-trip read+merge для summary JSONB (autopilotConfig + learningState)
  - детерминированность `buildDeterministicSeed` (одинаковый input → одинаковый output; изоляция секунд внутри минуты)
  - explore-фаза: выбор arm с наименьшим числом runs
  - exploit-фаза: выбор arm с максимальным средним reward
  - граничные случаи: пустая история + пустой summary
- **workspace.ts: 3048 → 2767 LOC (-281).** 191 LOC вынесено в lib + 90 LOC unused deps удалены (`toPlainObject`, `clampNumber`, `asFiniteNumber` — теперь в lib).
- **Ценность для Wave 2/P72:** `pickSelfLearningTarget` теперь pure-функция со 100% test coverage — безопасно менять алгоритм на Thompson Sampling + Beta posteriors позже без ломки существующих стратегий. Типы и структуры состояния зафиксированы unit-тестами.
- **Verify:** `npm run lint` ✅ (0 warnings), `npm run test` → **328/328 ✅ (+27 новых)**, `npm run build` ✅.

## 2026-04-19 · P71 Slice 9e — MapTab partial self-contained (filter state only)

- **refactor(advertising):** MapTab владеет local search/statusFilter/visibleRows (memo), но `clusterMapQuery` (shared с Ads2Tab/bidsByClusterKey) и `clusterToggleMutation` (shared с Ads2Tab's cluster-exclude кнопкой) остаются в parent. MapTab принимает 6 props вместо 11 (убраны: search, onSearchChange, statusFilter, onStatusFilterChange, visibleRows).
- Parent: 1094 → 1071 LOC (-23). MapTab: 185 → 201 LOC (+16).
- **P71 cumulative (Slices 9a-9e):** parent **1606 → 1071 LOC (-535 LOC, -33%)**. 5/8 tabs частично/полностью self-contained: Batch, Alerts, Pacing, Portfolios, Map.
- **Verify:** lint ✅, 301/301 ✅, build ✅.
- **Remaining (3 tabs):** BidsTab, Ads2Tab, StrategiesTab — они делят `bidsQuery`, `strategiesQuery`, `clusterMapQuery` и активное `selectedCluster`. Полная самостоятельность требует либо React Context, либо архитектурного решения типа lifted shared hook.

## 2026-04-19 · P71 Slices 9c+9d — PacingTab & PortfoliosTab self-contained

- **refactor(advertising):** масштабировал паттерн self-contained tabs на Pacing и Portfolios — два самых крупных таба с формами/мутациями/фильтрами/группировкой.
  - **PacingTab (499 LOC → 534 LOC)**: owns draft + editing + search + enabledFilter + groupBy + pacingQuery + pacingMutation + pacingById + visiblePacingRules + groupedRules memos. Принимает 5 props (tenantId, fromParam, toParam, selectedClusterNmId, effectiveAdvertId).
  - **PortfoliosTab (570 LOC → 638 LOC)**: owns draft + editing + search + enabledFilter + modeFilter + groupBy + portfoliosQuery + portfolioMutation + visiblePortfolios + groupedPortfolios memos. Принимает 3 props (tenantId, fromParam, toParam).
- Parent: 1509 → 1094 LOC (**-415 LOC, -27%** в этих двух slices).
- **P71 cumulative (Slices 9a+9b+9c+9d):** parent **1606 → 1094 LOC (-512 LOC, -32%)**. 4/8 tabs self-contained: Batch, Alerts, Pacing, Portfolios.
- Cleanup unused imports: `parseIntList`, `PacingResponse`, `PacingRuleRecord`, `PortfolioRecord`, `PortfoliosResponse`.
- **Verify:** `npm run lint` ✅, `npm run test` → 301/301 ✅, `npm run build` ✅.
- **Remaining P71 (4 tabs):** MapTab (clusterMapQuery shared), Ads2Tab, BidsTab, StrategiesTab — требуют либо разрешения shared state через Context, либо lift-up bidsQuery/clusterMapQuery/strategiesQuery в общий hook.

## 2026-04-19 · P71 Slice 9b — AlertsTab self-contained state+query

- **refactor(advertising):** применил тот же паттерн к AlertsTab: перенёс `severityFilter`/`typeFilter` state + `alertsQuery` useQuery + `visibleAlerts` useMemo из parent в сам `AlertsTab.tsx`. Tab принимает 3 props (`tenantId`, `fromParam`, `toParam`) вместо 8.
- QueryKey `['adv-workspace-alerts', ...]` совпадает в parent и tab — cross-component `invalidateQueries` продолжает работать через shared React Query cache.
- Parent: 1548 → 1509 LOC (-39). AlertsTab: 138 → 160 LOC (+22).
- **Progress P71 cumulative (Slices 9a+9b):** parent 1606 → 1509 LOC (-97, ≈6%). 2 из 8 tabs стали self-contained (Batch + Alerts).
- **Verify:** lint ✅, 301/301 ✅, build ✅.

## 2026-04-19 · P71 Slice 9a — BatchTab self-contained state

- **refactor(advertising):** перенёс `batchRiskLevels`, `batchMaxClusters`, `batchResult`, `batchNeedsConfirm` state + `batchMutation` из `AdvertisingBidWorkspace.tsx` parent в сам `BatchTab.tsx`. Tab теперь владеет своим circuit UI-состояния и мутации, принимает 3 props вместо 10 (`tenantId`, `fromParam`, `toParam`).
- **Мотивация:** первый бойд props-drilling в P71 track без введения React Context (Context требует refactor всех 8 tabs + провайдер + 46 state hooks → несёт высокий регрессионный риск без browser smoke). Подход «каждый tab владеет локальным state» масштабируется инкрементально.
- Parent: 1606 → 1548 LOC (-58). BatchTab: 184 → 221 LOC (+37).
- Props у BatchTab: 10 → 3 (убраны: `riskLevels`, `onToggleRiskLevel`, `maxClusters`, `onMaxClustersChange`, `needsConfirm`, `isPending`, `error`, `result`, `onDryRun`, `onApply`, `onConfirm` → теперь внутри таба).
- **Verify:** `npm run lint` ✅, `npm run test` → 301/301 ✅, `npm run build` ✅.
- **Follow-up:** применить тот же подход (Pacing/Portfolios/Alerts/Map state) по одному tab-за-сеанс. StrategiesTab требует больше размышления (shared data с Ads2Tab).

## 2026-04-18 (wave 14) · engine.ts decomposition Slice 5 — SignalAutomationQueriesService

- **refactor(analytics):** вынес 6 методов queries/mutations automation-control-plane из `AnalyticsEngine` в новый `src/server/analytics/services/signal-automation-queries.ts` (1110 LOC):
  - `getSignalAutomationRuns` (399 LOC) — построение run detail rows + aging + outcome counts
  - `getSignalAutomationRunDetails` (429 LOC) — per-run breakdown с escalation outcomes
  - `getSignalAutomationSuppressions` (~60 LOC), `getSignalAutomationControlEvents` (~80 LOC)
  - `getMatchingSignalAutomationSuppressions` (~20 LOC), `recordSignalAutomationControlEvent` (~63 LOC)
- **SignalDetailViewer** type переехал в service и re-импортирован в engine.ts (устраняет дублирование).
- Cleanup unused imports: 11 типов (`SignalAutomation*Status/Type/Source/Run/RunDetail/Suppression/ControlEvent/FollowUpWave/FollowUpResolutionSummary`, `SignalEscalationOutcome`) + схема `signalAutomationControlEvents` + helpers (`createEmptyEscalationOutcomeCounts`, `createEmptyFollowUpResolutionCounts`, `createSignalAutomationFollowUpWave`, `resolveAppliedPresets`, `resolveSignalAutomationControlEvent*`, `resolveSignalAutomationTriggerType`, `resolveSignalAutomationSuppressionTarget`).
- **Engine.ts: 6488 → 5418 LOC (-1070, ≈16%).** Всего за Slices 1+2+3+4+5: **8047 → 5418 (-2629 LOC, ≈33%)**.
- **Verify:** lint ✅ (0 warnings), 301/301 ✅, build ✅.

## 2026-04-18 (wave 13) · engine.ts decomposition Slice 4 — SignalNotificationsService

- **refactor(analytics):** вынес 3 метода in-app уведомлений из `AnalyticsEngine` в новый `src/server/analytics/services/signal-notifications.ts` (228 LOC): `getSignalNotifications`, `markSignalNotificationsRead`, `acknowledgeSignalNotifications`.
- Делегирующие `static X = Service.X` для обратной совместимости.
- Cleanup unused imports: `or` drizzle op, `signalNotificationReceipts` schema, types `SignalNotificationItem`/`SignalNotificationsResponse`.
- **Engine.ts: 6696 → 6488 LOC (-208).** Всего за Slices 1+2+3+4: 8047 → 6488 (-1559 LOC, ≈19%).
- **Verify:** lint ✅ (0 warnings), 301/301 ✅, build ✅.

## 2026-04-18 (wave 12) · engine.ts decomposition Slice 3 — SignalSavedViewsService

- **refactor(analytics):** вынес 10 методов управления saved-views из `AnalyticsEngine` класса в новый модуль `src/server/analytics/services/signal-saved-views.ts` (498 LOC):
  - `resolveSignalSavedViewSharedOwner` (shared, используется также в SLA automation)
  - `getSignalSavedViewNextPosition`, `getSignalSavedViewForMutation`, `getSignalSavedViews`
  - `saveSignalSavedView`, `updateSignalSavedView`, `setSignalSavedViewDefault`, `toggleSignalSavedViewPin`, `moveSignalSavedView`, `deleteSignalSavedView`
- **Pattern:** делегирующие static-свойства в `AnalyticsEngine.X = SignalSavedViewsService.X` сохраняют обратную совместимость для всех call-sites (`overview/actions.ts`, внутренние `this.*` рефы в других методах класса). Никаких изменений в вызывающем коде не требуется.
- **Engine.ts: 7173 → 6696 LOC (-477).** Всего за Slices 1+2+3: 8047 → 6696 (-1351 LOC, ≈17%).
- Cleanup unused imports в engine.ts (asc/isNull/ne drizzle ops, SignalSavedViewScope/SignalSavedView/SignalSortPreset types, resolveSignalSavedViewScope/resolveSignalSortPreset, isTenantManager, локальный DbTransaction).
- **Verify:** `npm run lint` ✅ (0 warnings), `npm run test` → 301/301 ✅, `npm run build` ✅.

## 2026-04-18 (wave 11) · engine.ts decomposition Slice 2 — signal helpers + SQL builders

- **refactor(analytics):** вынес ~30 signal-related helper-функций + 2 SQL-builders + 2 UX presentation-функций из `src/server/analytics/engine.ts` в 3 новых файла:
  - `src/server/analytics/helpers/sql-builders.ts` (37 LOC) — `buildTaxAmountSql`, `buildNetProfitSql`
  - `src/server/analytics/helpers/signals.ts` (508 LOC) — 29 signal-логических функций + types `SignalRecommendation`, `SignalInsight` (`normalizeSignalType`, `resolveSignalEscalationOutcome`, `resolveSignalAutomation*` series, `buildSignalSlaFollowUp*NoteBody`, `createEmpty*Counts`, `buildSignalCollaborationSummary`, `buildSignalAgingSummary`, `buildFocusedHref` и др.)
  - `src/server/analytics/helpers/signal-content.ts` (320 LOC) — `buildSignalRecommendations`, `buildSignalInsights` (UX content с русскими лейблами)
- **Engine.ts: 7992 → 7173 LOC (-819, ≈10%).** Всего за Slices 1+2: 8047 → 7173 (-874 LOC, ≈11%).
- Cleanup unused imports в engine.ts (11 символов, которые использовались только извлечёнными функциями).
- **Verify:** `npm run lint` ✅ (0 warnings), `npm run test` → 301/301 ✅, `npm run build` ✅.

## 2026-04-18 (wave 10) · engine.ts decomposition Slice 1 + docs-sync P63.1

- **refactor(analytics):** вынес 10 pure-хелперов (`formatCurrency`, `formatUnits`, `safeNumber`, `parseNumeric`, `parseNullableNumeric`, `safeNullableNumber`, `roundFinancial`, `roundFinancialNullable`, `getUtcDayStart`, `getUtcNextDayStart`) из `src/server/analytics/engine.ts` в новый `src/server/analytics/helpers/numeric.ts`. Engine.ts: 8047 → 7992 LOC (-55). Первый slice из multi-PR плана «Audit 2026-04-17 — остаток · engine.ts decomposition».
- **docs:** `ENTERPRISE_LAUNCH_CHECKLIST.md` — P63.1 переведён в done (Advertising Wave 1 follow-ups: 0→1 done), раздел «Audit остаток» очищен от закрытой части про BidWorkspace, добавлен список 9 slice-коммитов P63.1. Итого: 88→89 done, 2→0 in-progress, 2→1 todo.
- **Verify:** `npm run lint` ✅, `npm run test` → 301/301 ✅, `npm run build` ✅.
- **Следующие slices engine.ts:** (2) signal-related helpers (`normalizeSignalType`, `buildSignalFollowUp*`, `resolveSignalAutomation*` — ~30 функций, L330–L1170); (3) `AnalyticsEngine` class split по доменам (signals, economics, finances, dynamics).

## 2026-04-18 (wave 9) · P63.1 Slice 8 — extract StrategiesTab from BidWorkspace

### refactor(advertising): split Strategies sub-tab (the largest, most coupled) into dedicated component

- Создан `src/components/advertising/workspace/tabs/StrategiesTab.tsx` (1050 строк, ~37 props).
- Типы `StrategyRecord`/`StrategiesResponse`/`StrategyRun`/`StrategyRecentChange`/`StrategyTemplateKey`/`StrategyDraft`/`StrategyClusterRow`/`StrategyTodaySummary`/`StrategyAutopilotInsights` перенесены с `export type`.
- `STRATEGY_TEMPLATE_PRESETS` (150 строк) перенесён с `export const` — parent использует его для `applyStrategyTemplateToForm`/`saveStrategyFromTemplate`.
- `normalizeRunEstimatedSavingsRub` — `export function` (parent использует для вычисления `strategyAutopilotInsights`).
- `strategyGuardrailLabel`/`strategyGuardrailToneClass` — local внутри StrategiesTab (нужны только в журнале автоизменений).
- `toSafeNumber` остаётся в монолите (используется для `ads2Summary.weightedDrrPct`).
- Mutation/template callbacks остаются в parent: `onSubmitDraft/onResetDraft/onEditStrategy/onRunStrategy/onDeleteStrategy/onToggleStrategy/onApplyTemplate/onSaveFromTemplate/onRefetchClusters/onRefetchStrategies/onToggleClusterFromRow`.
- Удалены неиспользуемые импорты `Bot`/`RefreshCcw`/все form-format helpers/`mapStatusLabel`/`bidChangeStatusLabel`/`drrToneClass`/`strategyReasonLabel`/`strategyStateLabel` из монолита.
- Файл монолита: 2481 → 1606 строк (-875, накопительно -2760 от 4366 ≈ 63% сокращение).
- **P63.1 Slices 0-8 закрыты** (9/9): монолит дроблён на 8 tab-компонентов + 3 shared-модуля (`strategy-helpers.ts`, `_shared/format.ts`, `_shared/ui.ts`).
- Build/lint OK, tests 301/301 ✓.

## 2026-04-18 (wave 9) · P63.1 Slice 7 — extract PortfoliosTab from BidWorkspace

### refactor(advertising): split Portfolios sub-tab into dedicated component

- Создан `src/components/advertising/workspace/tabs/PortfoliosTab.tsx` (570 строк, ~28 props).
- Типы `PortfolioRecord`/`PortfoliosResponse`/`PortfolioDraft`/`PortfolioEnabledFilter`/`PortfolioModeFilter`/`PortfolioGroupBy` перенесены с `export type`.
- `PORTFOLIO_PRESETS` (69 строк) и `applyPortfolioPreset` перенесены внутрь tab.
- Mutation остаётся в parent: callbacks `onSubmitDraft/onResetDraft/onEditPortfolio/onRunPortfolio/onDeletePortfolio/onTogglePortfolio/onResetFilters`.
- Удалён неиспользуемый импорт `BriefcaseBusiness`.
- Файл монолита: 2914 → 2481 строк (-433, накопительно -1885 от 4366).
- Build/lint OK, tests 301/301 ✓.

## 2026-04-18 (wave 9) · P63.1 Slice 6 — extract PacingTab from BidWorkspace

### refactor(advertising): split Pacing sub-tab into dedicated component

- Создан `src/components/advertising/workspace/tabs/PacingTab.tsx` (499 строк, ~25 props).
- Типы `PacingRuleRecord`/`PacingResponse`/`PacingDraft`/`PacingEnabledFilter`/`PacingGroupBy` перенесены с `export type`.
- `PACING_PRESETS` (49 строк) и `applyPacingPreset` перенесены внутрь tab — используются только Pacing'ом.
- Helpers `parseIntList` (10 строк) и `strategyStateLabel` (18 строк) вынесены в `strategy-helpers.ts` — нужны также Portfolios (Slice 7) и Strategies (Slice 8).
- Mutation остаётся в parent: callbacks `onSubmitDraft/onResetDraft/onEditRule/onRunRule/onDeleteRule/onToggleRule/onResetFilters` инкапсулируют логику mutateAsync и lookup `targetAdvertId/targetNmId`.
- Удалён неиспользуемый импорт `Clock3` из монолита.
- Файл монолита: 3310 → 2914 строк (-396, накопительно -1452 от 4366).
- Build/lint OK, tests 301/301 ✓.

## 2026-04-18 (wave 9) · P63.1 Slice 5 — extract Ads2Tab from BidWorkspace

### refactor(advertising): split Ads2 sub-tab into dedicated component

- Создан `src/components/advertising/workspace/tabs/Ads2Tab.tsx` (447 строк, ~30 props).
- Создан `src/components/advertising/workspace/strategy-helpers.ts` (113 строк): вынесены shared helpers `toNullableNumber`/`toSummaryObject`/`bidChangeStatusLabel`/`strategyReasonLabel`/`drrToneClass` — будут переиспользованы в StrategiesTab (Slice 8).
- BidWorkspace: render-блок `tab === 'ads2'` (313 строк) заменён на `<Ads2Tab .../>`. Refetch трёх queries обёрнут в `onSync` callback.
- Файл монолита: 3694 → 3310 строк (-384, накопительно -1056 от 4366).
- Build/lint OK, tests 301/301 ✓.

## 2026-04-18 (wave 8) · Docs sync — P66 checkboxes, P63.1 backlog entry

### docs(backlog): close P66 checkboxes, register P63.1 as explicit follow-up

- `IMPLEMENTATION_BACKLOG.md` P66: проставлены `[x]` по факту реализации в commit `1ea0247` (`getAdBalance`/`depositAdBudget`/Inngest cron `*/30`/auto-refill cooldown 6ч + cap 10k/forecastDaysLeft UI). План был помечен `done` в статусе, но чекбоксы оставались пустыми.
- `IMPLEMENTATION_BACKLOG.md` P63.1: новая запись для дробления `AdvertisingBidWorkspace.tsx` (4366 строк) на 8 sub-tab компонентов. План: 9 slices (Slice 0 prep + 8 табов от alerts → strategies). Phasing требует UI smoke-test между slices, поэтому не сделан в этой сессии.
- `ENTERPRISE_LAUNCH_CHECKLIST.md`: Advertising Wave 1 закрыт полностью (8/8 done); добавлена строка «Advertising Wave 1 follow-ups» с P63.1; итог 96/88/2/2/1/2.

## 2026-04-18 (wave 8) · Deploy goalbot da2606c → 928e71a (P68 Slice 2)

### deploy(goalbot): sync server to local main, no migrations

- Server pulled `da2606c..928e71a` (2 коммита: P68 Slice 2 UI + checklist update)
- `npm ci` + `npm run build` — OK
- `systemctl restart enterprise-wb-analytics{,-inngest}` — both `active`
- Health: `{ok:true, app:ok, db:ok, supabase:ok, inngest:ok, env:ok}` (после ~10s прогрева Inngest)
- Parity: local `main` SHA == server SHA == `928e71a`
- Миграций нет → backup не делался (по политике)

## 2026-04-18 (wave 8) · P68 Slice 2 done — 6-section advertising nav, ProductCard, term labels

### feat(advertising): P68 Slice 2 — UI redesign, ProductCard, TERMS integration

**Что сделано:**

- `src/app/(dashboard)/advertising/page.tsx` — переработан с 7 плоских вкладок на 6 семантических секций:
  - **Сводка** (было «Обзор») — `AdvertisingOverview`
  - **Товары** (новое) — `ProductsTab` с grid `ProductCard`
  - **Ставки** — `AdvertisingClusters` + sub-nav: Кластеры / Управление кластером / Рабочее место
  - **Баланс** — `BalancePage`
  - **История** — `AuditLog`
  - **Настройки** (было «Расписание») — `DaypartingSchedule`

- `src/components/advertising/products/ProductCard.tsx` — новый компонент:
  - Фото товара 60×60 (WB basket URL из `photoUrl`)
  - brand/vendorCode/nmId с tooltip `NM_ID`
  - Светофор ДРР через `calcCampaignStatus({ drrPct, orders, spendRub, stockQty: null })`
  - Метрики: расход, заказы, ДРР, CTR, CPC — все с `getTerm().label` + `title` tooltip
  - Кнопка «Автопилот →» навигирует в секцию Ставки → Рабочее место

- `src/components/advertising/products/ProductsTab.tsx` — новый компонент:
  - Переиспользует данные `topSku` из существующего `/api/views/advertising`; новых API-эндпоинтов не добавлено
  - Responsive grid: 1/2/3/4 колонки; loading/error/empty states

- `src/components/advertising/overview/AdvertisingOverview.tsx` — замена сырых строк на термины:
  - Карточки сводки: `getTerm('DRR').label`, `getTerm('ROAS').label`, `getTerm('CPO').label`
  - Заголовки таблиц: `getTerm('CTR')`, `getTerm('CPC')` с `title` tooltip

- `src/components/advertising/_shared/types.ts` — `AdvertisingTabKey` обновлён до 6-ключевой схемы:
  `'summary' | 'products' | 'bids' | 'balance' | 'history' | 'settings'`

**Проверки:**
- `npm run lint` → EXIT 0 ✅
- `npm run build` → те же 4 pre-existing Sentry ошибки (P0-08 wontfix), новых нет ✅

**Commit:** `54ab67a`, PR [#27](https://github.com/viteab-source/enterprise-wb-analytics/pull/27)

---

## 2026-04-18 (wave 7) · P0-07 done — CI workflow hardened (setup-node v6, persist-credentials)

### ci(github-actions): bump setup-node to v6, add persist-credentials: false (P0-07)

- `actions/setup-node@v4` → `@v6` (re-applies Dependabot PR #11 that regressed on main).
- `actions/checkout` + `persist-credentials: false` — GITHUB_TOKEN не передаётся в build-скрипты (supply-chain hardening).
- Локально: `npm run lint` → 0 warnings; `npm run test` → 223/223 passed.
- Branch protection заблокирована GitHub Free планом (private repo). CI runs на GitHub падают из-за billing — нужно починить в `GitHub Settings → Billing & plans`.

**Commit:** `b8bee02`, PR [#26](https://github.com/viteab-source/enterprise-wb-analytics/pull/26)

---

## 2026-04-18 (wave 6) · Disk cleanup P2-50 (temp) + fix sync-orders invalid-token filter

### ops(goalbot): disk cleanup ~4 GB freed (P2-50 temp fix)

Baseline: `/dev/vda2 90G/119G 81%`. Выполнены безопасные действия:

| Действие | Освобождено |
|---|---|
| `journalctl --vacuum-size=500M` | 209 MB |
| `docker system prune -af` (без `--volumes`) | 3.68 GB |
| Удалено 11 старых `pre-*` бэкапов (оставлены 3 свежих) | ~70 MB |

Итог: **81% → 77% (86G/119G)**. Supabase containers (db, auth, kong, inbucket) и named volumes не затронуты. Стale git worktrees на сервере отсутствовали.

Постоянный fix — часть P0-06 (новый сервер с большим диском).

### fix(sync-orders): filter tenants with invalid WB token

`src/server/jobs/sync-orders.ts` — добавлен `.where(ne(tenants.wbTokenHealthStatus, "invalid"))` к запросу fetch-active-tenants (паттерн из `advertising-balance-sync.ts`). Тенанты с невалидными токенами больше не нагружают WB API с заведомо отклоняемыми запросами.

**Tests (+1, total 301 passed)**
- `passes ne(wbTokenHealthStatus, "invalid") filter to the query` — проверяет, что `ne()` вызван и `.where()` применён к запросу.

---

## 2026-04-18 (wave 5) · Audit 2026-04-17 — AES-GCM IV 16 → 12 bytes (versioned ciphertext)

Закрыт оставшийся P3 finding: `src/lib/encryption.ts` использовал 128-bit IV, NIST SP 800-38D рекомендует 96-bit для AES-GCM. Применена **миграция A (versioned ciphertext)** — zero downtime, без mass-rewrite данных, полностью backwards-compatible read.

**Формат**

| Версия | Shape | IV bytes | Status |
|---|---|---|---|
| **v1 legacy** | `<iv-32hex>:<tag-32hex>:<ct-hex>` | 16 | Existing prod data; decrypt only |
| **v2 (new)** | `v2:<iv-24hex>:<tag-32hex>:<ct-hex>` | 12 (NIST) | Writes from `encrypt()` |

**Поведение**
- `encrypt()` пишет только v2.
- `decrypt()` + `decryptIfNeeded()` детектят версию по shape (`v2:` prefix + 4 части vs 3 части без prefix) и диспатчат. Helper `parseCiphertext()` валидирует форму до вызова decipher.
- Non-ciphertext payloads (plain-text, 4-part без `v2`) проходят через `decryptIfNeeded` as-is, совместимо со старым guard-паттерном.

**Tests (+5, total 300 passed)**
- v2 output: prefix `v2:`, IV hex 24 chars (12 bytes), authTag 32 hex chars (16 bytes).
- v1 legacy decrypt через manually constructed ciphertext (идентичный старому encrypt()).
- `decryptIfNeeded` принимает v1 payloads.
- Mixed storage: v1 read + v2 write сосуществуют.
- 4-part strings без `v2` prefix — pass-through (не распознаются как ciphertext).

**Migration (не требуется)**
Existing v1 tokens остаются decryptable indefinitely. Gradual ротация на v2 — органическая, при переразрешениях WB-ключей через UI. Принудительный batch-rotation скрипт опционален и вне scope этого PR.

**Safety**
- pg_dump backup: `/srv/backups/enterprise-wb-analytics/pre-aes-iv-v2-20260418-075544/database.dump` (8.7M, checksums.sha256).
- Revert plan: `git revert PR #23` → encrypt() возвращается к v1. Оба path остаются decryptable после revert (v2 path держится в prod только до revert — если были v2 записи, они прочтутся до revert; после revert новые пишутся v1). Zero data loss.

**Verify**
- `npm run lint` → clean
- `npm run test` → **300 / 300** (+5 encryption)
- `npm run build` → OK
- goalbot SHA `73f5071`, `/api/health` → `ok:true` (all 5 checks)
- Live decrypt на проде v1 token не проверен автоматом (credential-access policy deny); валидация через unchanged v1 decrypt path (bit-identical old cipher init) + unit-тесты + successful service restart без encryption errors в journalctl.

Counters: **34 / 36** audit findings closed. Blocked: 4 → 2 (P0-06 infra, P2-50 disk). Wontfix: 1 → 2 (P3-36 + drizzle-kit/vite dev vulns).

**Commit:** PR #23 → squash `73f5071`.

---

## 2026-04-18 (wave 4) · Audit 2026-04-17 — Dependabot triage + dev-vulns wontfix + AES-GCM IV blocked

Волна закрывает **6 findings** из «out of scope» bucket + фиксирует **3 findings** явно как blocked/wontfix с обоснованием. После этой волны суммарно **32 из 36** aудит-findings закрыто, 3 требуют либо OAuth workflow scope, либо пользовательского решения, 1 — wontfix по обоснованию.

**Merged (6 Dependabot PRs)**

| PR | Title | From → To | SHA | Risk |
|---|---|---|---|---|
| #10 | `actions/checkout` bump | v4 → v6 | `ad19f3b` | CI-only; default behavior preserved |
| #13 | `@tanstack/react-query`/`react-virtual` | 5.96.1→5.99.0 / 3.13.23→3.13.24 | `5d96967` | patch deps, no API changes |
| #14 | `@supabase/ssr`/`supabase-js` | 0.10.0→0.10.2 / 2.101.1→2.103.3 | `b8b0473` | bug-fix patch; auth-options fix benign |
| #15 | `inngest` | 4.1.0 → 4.2.4 | `fa920aa` | additive streaming for Durable Endpoints + UTF-8/maxRuntime fixes |
| #16 | `eslint-config-next`/`vitest` | 16.2.2→16.2.4 / 4.1.2→4.1.4 | `7e061f3` | dev-only, additive changes |
| #18 | `react`/`react-dom` | 19.2.4 → 19.2.5 | `72393c1` | RSC cycle protection one-liner |

Verify после каждого merge (единый проход на worktree): `npm ci` → lint clean → **227/227 tests** → build OK → deploy на goalbot → `/api/health` ok (все 5 checks).

**Blocked (2 findings — requires decision)**

- **Dependabot #11 `actions/setup-node` v4→v6** — remote `gh pr merge` отклоняется с `refusing to allow an OAuth App to create or update workflow .github/workflows/ci.yml without workflow scope`. Blocker не технический — токен CLI `gh` не имеет `workflow` scope. Разблокирование:
  - вариант A: merge через GitHub web UI (браузер добавит scope при merge-операции),
  - вариант B: `gh auth refresh -s workflow` локально и повторить merge через API.
  Сам bump совместимый — `setup-node` v5/v6 breaking changes (auto-cache via packageManager, Node 24 runtime) не касаются нашей конфигурации: у нас `cache: npm` explicit, нет `packageManager` поля в package.json, ubuntu-latest на v2.329+.

- **AES-GCM IV 16→12 bytes (P3 audit)** — требует user-decision по формату миграции. Нельзя автономно: ломает расшифровку существующих WB-ключей всех тенантов → ingestion ляжет, потеря синков. Опции:
  - **A (рекомендую):** versioned ciphertext — префиксы `v1:` (16-byte IV, read-only) / `v2:` (12-byte IV, новые записи). `decryptIfNeeded` пробует `v2:` → fallback `v1:`. Через N месяцев (при полной ротации ключей) убираем `v1:` path. Zero downtime.
  - **B:** single-shot migration — `scripts/rotate-encryption-iv.mjs` дешифрует все записи v1 → reencrypt v2. Требует downtime window + pg_dump + rollback-скрипт.
  - **C:** оставить wontfix. IV 16-byte технически работает, это NIST-compliance remark, не функциональная проблема.
  Нужно явное одобрение подхода + scheduled downtime (для B) или одобрение на merge (для A).

**Wontfix (1 finding)**

- **drizzle-kit/vite dev vulns** (`esbuild` moderate, `vite` high, `drizzle-kit` transitive) — все **dev-only**. `npm audit --omit=dev` → **0 vulnerabilities**. `npm audit --fix` требует `drizzle-kit: 0.18.1` (мы на 0.31.10) — это semver-major **downgrade**, сломает существующие миграции и workflow `db:generate`. Production runtime не подвержен — vite не тянется в prod, esbuild через `@esbuild-kit/*` используется только в локальной генерации схемы.

**Partial progress (ранее в «out of scope»)**

- **server/jobs coverage** — раньше 1/17 jobs имели unit-тесты (`sync-runtime`), теперь 8/17. Новые тестовые файлы: `wb-sync-sources` (11 тестов), `redistribution-route-scan` (4), `reviews-qa-auto-reply` (4), `advertising-auto-bidder` (4), `advertising-balance-sync` (5), `advertising-advisor-digest` (6), `sync-orders` (6). Итого +40 тестов. Моки: `@/lib/db` (drizzle select-builder), `@/inngest/client` (createFunction через `_handler` hack), `@/inngest/on-failure`, domain-specific helpers. Skipped: `advertising-dayparting-scheduler` — проблема closure-over-variable при моках `wb-api` + `writeAuditEntry` + `explainAction`; оставлен на follow-up.

- **UnitEconomicsTemplateTable.tsx decomposition slice** — выделено 12 pure helpers в `src/components/dashboard/unit-economics-template-helpers.ts`: `toNumber`, `roundCurrency`, `toManualStorageKey`, `normalizeDecimalInput`, `formatCurrency`, `formatPercent`, `formatNumber`, `formatText`, `parseFirstNumber`, `clampPercent`, `parseCoefExprToMultiplier`, `hasManualValue`. +28 unit-тестов. UETT уменьшен с 4235 → 4178 строк (−57). Pilot-slice: валидирует подход, большая часть декомпозиции остаётся.

**Bug spotted but not fixed** (flagged per agent rules: write tests, don't fix prod in the same sitting)

- [`src/server/jobs/sync-orders.ts:24`](src/server/jobs/sync-orders.ts) — `db.select().from(tenants)` iterates all tenants без фильтра `wbTokenHealthStatus = 'invalid'`. Другие jobs (`advertising-balance-sync`, `wb-scheduled-sync`) этот фильтр используют. Результат: токены с `wbTokenHealthStatus = 'invalid'` всё равно попадают в цикл; если `wbApiToken` non-null, job делает вызов WB API, который гарантированно падает. Не критично (ошибка обрабатывается в выше-лежащем coverage), но лишняя нагрузка + шум в логах. Fix — добавить `.where(ne(tenants.wbTokenHealthStatus, 'invalid'))`. Подходит под отдельный follow-up.

**Remaining in «out of scope»**

- **Big-file decomposition** основной части `engine.ts` (8046 строк) и `AdvertisingBidWorkspace.tsx` (4370 строк) — multi-PR работа, не за одну сессию. UETT pilot выше показал подход, но полноценно разобрать 8000-строчный engine автономно небезопасно.

**Verify (worktree + prod)**

- `npm run lint` → clean
- `npm run test` → **295 passed / 295** (+68 к baseline: 40 jobs + 28 helpers)
- `npm run build` → OK
- goalbot SHA после wave 4: `72393c1` + wave 4 squash, `/api/health` → `ok:true` (all 5 checks)

**Commit:** _(этот коммит / PR wave 4)_

---

## 2026-04-18 (wave 3) · Audit 2026-04-17 — `?tenantId=` query-param fallback removal

Закрыт P2 finding из [`docs/audits/AUDIT_2026-04-17.md`](./audits/AUDIT_2026-04-17.md): удалён transitional `?tenantId=` query-param fallback. Cookie `active_tenant_id` (HttpOnly + Secure) теперь единственный источник активного тенанта для API-маршрутов.

**Server-side**
- `src/lib/auth/tenant-access.ts` — `requireActiveTenant` больше не читает `?tenantId=` из URL, возвращает 400 `Missing tenantId`, если cookie отсутствует. Параметр `request` оставлен для API-совместимости.
- `src/lib/rate-limit.ts` — `extractKey` в scope `tenant` читает `request.cookies.get('active_tenant_id')` вместо URL query. Для неавторизованных вызовов fallback на IP сохранён (`/api/health`, `/api/bot` не задеты — они `per: 'ip'`).
- `src/lib/idempotency.ts` — `extractTenantId` читает cookie → body-fallback (раньше URL → body).

**Client-side** — убран `?tenantId=${tenantId}` / `searchParams.set('tenantId', …)` / `URLSearchParams({ tenantId, … })` в 14 компонентах: `AdvertisingControl`, `AdvertisingOverview`, `AdvertisingBidWorkspace` (14 мест), `SignalNotificationsMenu`, `BalancePage`, `OverviewPageClient`, `SignalsFeed` (3 места), `DynamicsTable`, `EconomicsTemplatePageClient`, `explorer/page`, `overview-test/page`, `redistribution/page` (9 мест), `dynamics/page`, `StocksPageClient`, `AdvertisingClusters`. API-маршруты уже используют `requireActiveTenant()` — tenantId подхватывается из cookie автоматически.

**Tests**
- `src/lib/rate-limit.test.ts` — заменён URL query-param на cookie helper. Добавлен тест `falls back to IP for tenant scope when cookie absent`.
- `src/lib/auth/tenant-access.test.ts` — `falls back to query param` убран, добавлен `throws 400 when cookie absent even if query param is present`.
- `src/lib/idempotency.test.ts` — helper `makeRequest` инжектит cookie из legacy `?tenantId=` URL, чтобы не переписывать 6 тестов.

**Verify**
- `npm run lint` → clean
- `npm run test` → **227 passed / 227** (+1 для нового rate-limit fallback-теста)
- `npm run build` → OK

**Commit:** _(этот коммит / PR wave 3)_

---

## 2026-04-18 (wave 2) · External audit 2026-04-17 — closing remaining findings

Вторая волна закрытий по [`docs/audits/AUDIT_2026-04-17.md`](./audits/AUDIT_2026-04-17.md). После этого коммита закрыты оставшиеся P1, большая часть P2 и все P3 — итого +11 findings, суммарно **25 из 36** закрыто на проде.

**Security & deps**
- `protobufjs` CRITICAL CVE (arbitrary code execution, indirect через `inngest → opentelemetry → grpc`) закрыт через npm `overrides`: `protobufjs@7.5.4 → 8.0.1`. `npm audit --omit=dev` → **0 vulnerabilities**.

**Reliability**
- **WB Ads API wrapper** — `src/server/advertising/ads-api-call.ts` с централизованным `callWbAdsApi(label, fn, context)`: унифицированное structured-логирование ошибок с tenantId/advertId/nmId/runId поверх existing retry+timeout в `wb-api/client.ts` (MAX_ATTEMPTS=5, REQUEST_TIMEOUT_MS=30s). +3 unit-теста.
- **RPA partial-success normalization** — в `redistribution-rpa.ts` mark-completed теперь нормализует items `rpa_running` → `rpa_failed` с `executionNote='not_reported_by_rpa'` когда `perItemStatusManaged=true` и RPA пропустил отчёт. Логирует `orphanedCount` warning.

**Observability**
- **Sentry scaffolding**: установлен `@sentry/nextjs@10.49.0`, создан `src/instrumentation.ts` с `register()` и `onRequestError()` (no-op когда `SENTRY_DSN` пуст). `error.tsx` + `global-error.tsx` шлют `Sentry.captureException(error)` при наличии `NEXT_PUBLIC_SENTRY_DSN`. Conservative defaults: 10% trace sampling, ignored `AppError` 4xx.
- **Structured logging migration**: `console.log|warn|error` → `logger.*` во всех server-side файлах — `src/server/{analytics,advertising,bot,jobs,reviews-qa}/**` + `src/lib/{encryption,wb-api,wb-rpa}/**` + `src/app/(dashboard)/settings/*`. Pino redact теперь работает на всех логах, LOG_LEVEL управляется через env. Client-side error boundaries оставлены с `console.error` (browser DevTools, runtime != node).

**Data**
- Migration `0044_advertising_audit_log_nm_id_bigint.sql` — `advertising_audit_log.nm_id` integer → bigint (единственный оставшийся int32 nm_id после audit review). `schema.ts` обновлён.

**Config & env**
- **`TELEGRAM_WEBHOOK_SECRET` теперь требуется только когда настроен реальный bot token.** `/api/health` больше не возвращает `ok:false` на dev/staging/продe-без-бота при placeholder-токене. `hasRealBotToken()` helper проверяет против `your_bot_token`/`placeholder` маркеров.
- `.env.example` расширен блоком Sentry и ссылкой на `ALLOWED_HOSTS` (last wave).

**Docs housekeeping**
- Перемещено в `docs/archive/2026-04-17/`: `AUDIT_FIXES.md`, `DYNAMICS_FACT_CONTROL_CHECK_2026-04-14.md`, `DYNAMICS_FORMULA_AUDIT_2026-04-14.md`, `SERVER_DEPLOYMENT_GOAL_BOT.md` (дубль SERVER_GOALBOT.md), `WB_UNIT_ECONOMICS_SPEC_2026-04-13.md`. Оставлены в live: `SMOKE_OPERATOR_FLOW.md`, `STOCKS_AND_COST_SOURCE.md` (актуальны). Создан `docs/archive/2026-04-17/README.md` с обоснованиями.

**Not included in this wave (остатки для отдельных sprint'ов):**
- `?tenantId=` query-param fallback removal — ждёт миграции 15+ client-компонентов (`src/components/dashboard/SignalsFeed.tsx`, `AdvertisingBidWorkspace.tsx`, `DynamicsTable.tsx`, `BalancePage.tsx` и др.) на cookie-based подход.
- Big files decomposition: `engine.ts` (8046), `AdvertisingBidWorkspace.tsx` (4370), `UnitEconomicsTemplateTable.tsx` (4235) — L×3 effort, отдельный multi-PR.
- Deep `src/server/jobs/**` unit coverage (16 jobs без тестов; добавлен только на новый `callWbAdsApi`).
- Dev-deps vulns (`drizzle-kit`/`esbuild`, `vite`) — dev-only, безопасно оставить до major-bump `drizzle-kit`.
- AES-GCM IV 16 → 12 bytes — требует data migration (расшифровать 16-byte IV, перешифровать 12-byte IV) + downtime window, не согласовано.
- 7 Dependabot PRs (#10, #11, #13, #14, #15, #16, #18) — требуют ручного разбора для принятия major-bump решений.

**Verify**
- `npm run lint` → clean
- `npm run test` → **226 passed / 226** (+3 для `callWbAdsApi`)
- `npm run build` → OK
- `npm audit --omit=dev` → 0 vulnerabilities

**Commit:** _(этот коммит / PR wave 2)_

---

## 2026-04-18 · External audit 2026-04-17 follow-up (code + infra batch)

Внешний аудит 2026-04-17 выявил 36 findings. В одном заходе закрыта критичная часть (14 из 36). Полный отчёт: [docs/audits/AUDIT_2026-04-17.md](./audits/AUDIT_2026-04-17.md). Миграционный journal repair: [docs/audits/MIGRATION_RECONCILIATION_2026-04-17.md](./audits/MIGRATION_RECONCILIATION_2026-04-17.md).

**P0 — data integrity / reproducibility**

- **Migration journal reconciliation.** `drizzle/meta/_journal.json` содержал 37 записей, но в папке лежали 5 orphan SQL-файлов. Переименованы в уникальные idx: `0037_advertising_balance`, `0038_advertising_guardrails` (сделан идемпотентным), `0039_advertising_dayparting_audit`, `0040_rls_enable`, `0041_telegram_processed_updates`. Добавлены записи в journal + snapshot-заглушки в `drizzle/meta/`. На проде `npm run db:migrate` станет no-op благодаря IF NOT EXISTS / DROP POLICY IF EXISTS в SQL. На чистой БД полностью восстанавливает схему.
- **Ops infra files.** Созданы `ops/logrotate/enterprise-wb-analytics`, `ops/systemd/enterprise-wb-analytics-backup.{service,timer}`, `ops/systemd/enterprise-wb-analytics-watchdog.{service,timer}` и `ops/install-on-goalbot.sh`. Скрипт ставит logrotate (фиксит 860 MB `enterprise-wb-analytics-inngest.log`), включает nightly-db-backup и ops-watchdog таймеры, перемещает stale `.env.*.bak*` в `/srv/backups/.../env/`, ваккумит journalctl до 500M.

**P1 — security / RBAC / reliability**

- **RBAC fix reviews-qa.** `POST /api/views/reviews-qa/publish` и `/reply` теперь явно требуют `['owner', 'admin']`. Раньше любой `viewer` мог публиковать ответы в WB и расходовать YandexGPT.
- **CSP header.** Добавлен `Content-Security-Policy` в `next.config.ts` — default-src 'self', ограничения на connect-src (supabase, telegram, inngest), img-src (wbbasket CDN), frame-ancestors 'none'.
- **Health endpoint scrubbing.** В production ответ `/api/health` раскрывает только `missingEnvCount`, без имён переменных. В dev — полный массив.
- **sync-finances / sync-orders** теперь бросают ошибку в Inngest step вместо `return { error }`. `onFailure: handleInngestFailure` корректно срабатывает, Telegram-алерт уходит.
- **stale-sync-alert**: добавлен `SYNC_DORMANT_DAYS` (default 14) — тенанты, не синкавшиеся эту длительность, больше не алертятся (cuts false positives).
- **Advertising transactions.** `executeBulkBidUpdate` и `runExcludedClusterRetest` теперь оборачивают multi-row audit-log inserts в `db.transaction`. Swallow'ed catch'и заменены на `logger.warn` с контекстом (tenantId, advertId, runId).
- **Idempotency на advertising_bid_changes.** Новая миграция `0043_advertising_bid_changes_idempotency.sql` добавляет колонку `idempotency_key varchar(255)` + partial UNIQUE индекс. `executeStrategyRun` вычисляет ключ как `${runId}:${nmId}:${cluster}`, `executeBulkBidUpdate` — на основе runId/source/user/advertId/nmId/date. Вставка через `onConflictDoNothing()` защищает от дублей при Inngest retry.
- **Open redirect fix.** `resolvePublicBaseUrl` валидирует `host` / `x-forwarded-host` против `ALLOWED_HOSTS` env + host из `APP_BASE_URL`. Если не в whitelist — fallback на `APP_BASE_URL`, не отражает произвольный Host header в reset-password ссылку.
- **invitations.invited_by → SET NULL.** Миграция `0042_invitations_invited_by_set_null.sql`: колонка становится nullable, FK переделан с CASCADE на SET NULL. Удаление inviter'а больше не стирает историю приглашений. Schema-level: `invitedBy` в `src/lib/db/schema.ts` теперь optional.

**P2 — dependencies / docs**

- **Next 16.2.4**: upgraded из 16.2.2 (CVE `GHSA-q4gf-8mx6-v5v3`, HIGH DoS). `package.json`: `"next": "16.2.4"`.
- **docs/PRODUCTION_DEPLOYMENT.md** полностью переписан: убраны устаревшие ссылки на `Dockerfile` и `render.yaml` (удалены в P3-42). Документ теперь отражает bare-metal goalbot-топологию, порт 3457, реальные systemd-юниты, новые ops-таймеры, правильный env contract (`ALLOWED_HOSTS`, `SYNC_DORMANT_DAYS`, `BACKUP_RESTORE_DATABASE_URL`).
- **Advertising Wave 1 counter fix в checklist.** Строка была «8/0 done», но CHANGELOG показывал P64, P65, P68 Slice 1, P69, P70 как done. Исправлено до «5 done, 1 in progress, 2 gaps».

**Verify (локально)**
- `npm run lint` → clean
- `npm run test` → **223 passed / 223**
- `npm run build` → OK

**Commit:** _(этот коммит / PR batch)_

---

## 2026-04-17 (28)

### P70 follow-up 5 · advisor_daily_digest cron — все 5 алертов wired

- **Новый Inngest-job:** `advertisingAdvisorDigestJob` (ID `advertising-advisor-digest`, cron default `0 9 * * *` Europe/Moscow, настраивается через `AD_ADVISOR_DIGEST_CRON`). Добавлен в `src/server/jobs/index.ts` → `inngestFunctions` массив.
- **Aggregator:** `src/server/advertising/advisor-digest.ts` (новый) — `listTenantsForDigest()` возвращает список тенантов с ≥1 auto-изменением ставки за 24ч и установленным `telegramChatId`. `buildAndSendDigestForTenant(tenantId)` выполняет SQL `SELECT nmId, status, count(*) FROM advertising_bid_changes WHERE tenantId=? AND createdAt >= now-24h AND source='auto' GROUP BY nmId, status`, группирует по nmId, ранжирует по суммарному числу изменений (desc), формирует `suggestions: Array<{ nmId, reason }>`.
- **Reason format** через `buildSuggestionReason(rows)`:
  - Только applied → «3 примен.»
  - applied + preview → «3 примен., 2 предлож.»
  - Все три → «5 примен., 1 предлож., 2 с ошибкой»
  - Только skipped/guardrail_blocked → «без изменений»
  - Пустой массив → «без изменений»
- **Источник данных:** существующая таблица `advertising_bid_changes` (записи `source='auto'`) — без новых миграций.
- **Skip-условия:** `no_changes` (нет записей за 24ч → не шлём), `no_chat_id` (tenants.telegramChatId IS NULL → фильтруется на уровне `listTenantsForDigest`), `send_failed` (ошибка отправки — логируется, не фейлит джоб).
- **Throttle:** дефолт `ALERT_THROTTLE_MS.advisor_daily_digest = 24ч` защищает от повторных отправок при пересечении cron-тика и ручного запуска.
- Unit-тесты: `src/server/advertising/advisor-digest.test.ts` → 7 тестов для `buildSuggestionReason` (все комбинации статусов + 0-counts). Общий прогон advertising: **140 passed** (+7).
- Checks: `npx vitest run src/lib/advertising/ src/server/advertising/` ✅ 140/140, `npm run build` ✅, `npm run lint` ✅.
- **Статус P70:** все 5 типов алертов (`balance_low`, `auto_pause`, `daily_cap_reached`, `learning_period_ended`, `advisor_daily_digest`) интегрированы в реальные писатели. Остаётся только UI-toggle настроек per-type — это требует schema-миграции (колонка `alertPrefs` в tenants) и UI-секции; для v1 все алерты отправляются всегда при `telegramChatId`.
- **Commit:** _(этот коммит)_.

---

## 2026-04-17 (27)

### P70 follow-up 4 · learning_period_ended integration (без миграции)

- **Integration:** `src/server/advertising/workspace.ts` → `executeStrategyRun` в начале функции (после построения `sharedGuardrailCtx`) детектирует транзицию «был в learning period → вышел из него» без новой колонки schema.
- **Логика детекции:** использует существующую `strategy.lastRunAt` как маркер прошлого состояния.
  - `wasInLearning = strategy.lastRunAt != null && isInLearningPeriod(effectiveStartedAt, learnDays, strategy.lastRunAt)`
  - `stillInLearning = isInLearningPeriod(effectiveStartedAt, learnDays, new Date())`
  - Если `wasInLearning && !stillInLearning` → отправляется `sendAdAlert({ type: 'learning_period_ended', strategyName, switchedAt: now })` с `subkey: strategy.id`.
- **Throttle:** дефолт 365д из `ALERT_THROTTLE_MS.learning_period_ended` + subkey = `strategy.id` защищает от повторов даже при рестарте сервера внутри окна или при параллельных runs.
- **Edge cases:**
  - Первый run стратегии (`lastRunAt == null`) — `wasInLearning = false`, алерт не шлётся (правильно, не было транзиции).
  - `learningPeriodDays = 0` — `isInLearningPeriod` всегда false → `wasInLearning = false`, алерт не шлётся.
  - Рестарт стратегии (обновление `strategyStartedAt`) — новое learning period со своим транзишеном (корректно семантически).
- Fire-and-forget с catch.
- Тесты для `isInLearningPeriod` уже в guardrails.test.ts (42 теста), для `formatAdAlert({ type: 'learning_period_ended' })` — в notifications.test.ts. Интеграционный тест для workspace.ts (E2E) не добавлен — требует тяжёлого мокинга БД; логика транзиции — комбинация двух проверенных функций.
- Общий прогон: **133 passed**, build ✅, lint ✅.
- **Остался единственный несделанный алерт:** `advisor_daily_digest` (требует отдельного cron-job + агрегацию bid-предложений за 24ч; scope крупнее текущего foundation-расширения).
- **Commit:** _(этот коммит)_.

---

## 2026-04-17 (26)

### P70 follow-up 3 · daily_cap_reached integration

- **Integration:** `src/server/advertising/workspace.ts` → `executeStrategyRun` при `strategyGuardrail.blockedBy === 'daily_cap'` и `guardrailConfig.dailySpendCapRub !== null` отправляется `sendAdAlert({ type: 'daily_cap_reached', capRub, spentRub: spendTodayRubTotal, campaignsPaused: 1 })`. Для остальных алертящихся триггеров по-прежнему идёт `auto_pause`.
- Throttle: subkey `${strategy.id}-daily_cap` + `windowMs: 6ч` (дефолт для типа = 0, здесь явно переопределён) — защищает от повторов на каждом run пока дневной лимит остаётся достигнутым.
- Fire-and-forget с catch, ошибка не ломает bid-управление.
- Тесты для `formatAdAlert({ type: 'daily_cap_reached' })` уже есть в P70 — дополнительных не требуется. Общий прогон: **133 passed**.
- Checks: `npx vitest run src/lib/advertising/ src/server/advertising/` ✅ 133/133, `npm run build` ✅, `npm run lint` ✅.
- **Commit:** _(этот коммит)_.

---

## 2026-04-17 (25)

### P70 follow-up 2 · auto_pause integration + throttle subkey

- **Throttle extension:** `shouldThrottle`/`markAlertSent` в `src/lib/advertising/notifications.ts` теперь принимают `ThrottleOptions { subkey?, windowMs? }`. `subkey` изолирует бакеты в рамках типа (ключ становится `tenantId:type:subkey`), `windowMs` переопределяет дефолт типа. Старое API (без options) совместимо. +4 unit-теста → **20 passed** для notifications.
- `sendAdAlert` принимает необязательный `throttleOptions` и пробрасывает его в `shouldThrottle`/`markAlertSent`.
- **Integration: strategy-level guardrail → auto_pause:** `src/server/advertising/workspace.ts` → `executeStrategyRun` в блоке `if (!strategyGuardrail.passed)` вызывает `sendAdAlert({ type: 'auto_pause', action, campaignName: strategy.name, campaignId: strategy.advertId })` с `subkey: '${strategy.id}-${trigger}'` и `windowMs: 3_600_000` (1ч). Только если не advisor-only и тригер — один из: `kill_switch`, `low_stock`, `high_drr`, `spend_no_orders`, `low_cr`. Fire-and-forget с catch.
- **Mapper:** `src/server/advertising/guardrail-to-alert.ts` (новый) — `mapGuardrailToAutoPauseAction(trigger, ctx, config): AutoPauseAction | null`. Возвращает `null` для `learning_period`, `cooldown`, `daily_cap` (→ `daily_cap_reached` отдельно), `max_bid_delta`, `max_bid` (cluster-level).
- Unit-тесты: `src/server/advertising/guardrail-to-alert.test.ts` → **12 passed** (покрывают все 10 триггеров + граничные `stockQty: null`, `crPct7d: null`, дефолт `maxDRRPct` = 1.5× target).
- Общий прогон advertising: **133 passed** (43 math + 42 guardrails + 16 explanations + 20 notifications + 12 guardrail-to-alert).
- Checks: `npx vitest run src/lib/advertising/ src/server/advertising/` ✅ 133/133, `npm run build` ✅, `npm run lint` ✅.
- **Ещё не интегрировано:** `daily_cap_reached` (отдельный алерт вместо auto_pause при trigger=daily_cap), `advisor_daily_digest` (нужен cron), `learning_period_ended` (нужна колонка `strategies.learningPeriodNotifiedAt`).
- **Commit:** _(этот коммит)_.

---

## 2026-04-17 (24)

### P70 follow-up · balance_low integration + docs housekeeping

- **Integration:** `src/server/advertising/balance.ts` → `syncAdvertisingBalance` теперь вызывает `sendAdAlert({ type: 'balance_low', currentRub, thresholdRub, daysLeft: null })` при `balance.realMoney <= settings.thresholdRub`. Fire-and-forget через `void ... .catch()` — ошибка отправки логируется, но не ломает sync. Throttle 6ч (из P70) не даёт спамить, пока баланс остаётся ниже порога.
- **Housekeeping:**
  - P61 (WB Snapshot Retention Fallback) — статус был `in_progress`, но все «Result»-поля реализованы и присутствуют в коде (`retained_previous_snapshot` в `src/inngest/sync-wb.ts`, «Сохранён прошлый снимок» в `SyncButton.tsx`). Обновлено на `done`.
  - P70 — из backlog удалён дубликат `Status: todo`, который остался после закрывающего edit'а в сессии 2026-04-17 (23).
- Checks: `npx vitest run src/lib/advertising/` → 117/117 ✅, `npm run build` ✅, `npm run lint` ✅.
- **Commit:** _(этот коммит)_.

---

## 2026-04-17 (23)

### P70 · Telegram-алерты рекламных событий

- **Scope:** foundation для TG-уведомлений автопилота — формат, throttle и sender; без интеграции в конкретные писатели (доберётся отдельным тикетом при подключении guardrail-логов и auto-refill в реальную работу). UI-toggle настроек на тип алерта отложен (требует миграции tenants + UI-секции).
- `src/lib/advertising/notifications.ts` (новый): discriminated union `AdAlertPayload` на 5 типов (`auto_pause`, `daily_cap_reached`, `balance_low`, `advisor_daily_digest`, `learning_period_ended`), `formatAdAlert(payload, { appBaseUrl })` возвращает `{ text, parseMode: 'Markdown' }`, in-memory throttle через `Map` с хелперами `shouldThrottle()`, `markAlertSent()`, `__resetThrottleForTests()`.
- `ALERT_THROTTLE_MS`: `auto_pause` и `daily_cap_reached` = 0 (немедленно), `balance_low` = 6ч, `advisor_daily_digest` = 24ч, `learning_period_ended` = 365 дн. (one-shot).
- Формат включает эмодзи (⏸/🛑/💳/💡/🎓), человекочитаемый reason (для `auto_pause` — через `explainAction` из P69), ссылку `APP_BASE_URL/advertising`, Markdown parse mode.
- `src/server/advertising/send-alert.ts` (новый): `sendAdAlert(tenantId, payload): Promise<SendAdAlertResult>` — проверяет bot init, throttle, читает `tenants.telegramChatId`, вызывает `bot.api.sendMessage` (grammy) с отключенным link preview, на успехе вызывает `markAlertSent`. Возвращает `{ status: 'sent' }` или `{ status: 'skipped', reason: 'throttled'|'no_chat_id'|'bot_unavailable'|'send_failed', error? }`.
- Throttle-хранилище in-memory (ключ `tenantId:type`): переживает long-running Inngest workers, сбрасывается при рестарте. Для окон 6ч/24ч разовый дубликат после рестарта приемлем; постоянный throttle (новая таблица) можно добавить позже при необходимости.
- Unit-тесты: `src/lib/advertising/notifications.test.ts` → **16 passed** (формат для каждого типа + сценарии throttle: независимость по tenant/type, границы 6ч/24ч, одиночные/без throttle).
- Полный прогон `src/lib/advertising/`: **117 passed** (43 math + 42 guardrails + 16 explanations + 16 notifications).
- Checks: `npx vitest run src/lib/advertising/notifications.test.ts` ✅ 16/16, `npm run build` ✅, `npm run lint` ✅.
- **Commit:** _(этот коммит)_.

---

## 2026-04-17 (22)

### P69 · Объяснения к автодействиям (статические шаблоны)

- **Scope:** человекочитаемое объяснение для каждого типа действия автопилота, без LLM, детерминированная подстановка параметров в готовые фразы.
- `src/lib/advertising/explanations.ts` (новый): типизированный union `ExplainableAction` на 12 типов (`bid_raise`, `bid_lower`, `pause_drr`, `pause_stock`, `pause_no_orders`, `pause_low_cr`, `dayparting_pause`, `dayparting_resume`, `cap_reached`, `kill_switch`, `advisor_suggestion`, `manual`) + функция `explainAction(action): string` с форматтерами `fmtRub`/`fmtPct`/`fmtInt`/`fmtHour`.
- `src/server/jobs/advertising-dayparting-scheduler.ts`: `writeAuditEntry` теперь получает `reason` из `explainAction({ type: 'dayparting_pause', hour })` вместо жёсткой строки. При настройке других писателей аудит-лога (в будущих задачах) — тот же паттерн.
- UI `AuditLog.tsx` уже рендерит колонку «Причина» (`entry.reason`) — изменений не требуется.
- Unit-тесты: `src/lib/advertising/explanations.test.ts` → **16 passed** (по тесту на каждый шаблон + граничные: час 25 / −1, пустой `manual.note`, кастомные `hoursWindow`/`daysWindow`).
- Полный прогон `src/lib/advertising/`: **101 passed** (43 math + 42 guardrails + 16 explanations).
- TG-алерты оставлены P70 (отдельная задача).
- Checks: `npx vitest run src/lib/advertising/explanations.test.ts` ✅ 16/16, `npm run build` ✅, `npm run lint` ✅.
- **Commit:** _(этот коммит)_.

---

## 2026-04-17 (21)

### P68 (Slice 1) · Foundation — словарь терминов + светофор кампании

- **Scope:** foundation-слайс P68 (UX редизайн), без UI-изменений. UI-редизайн на 6 секций + `<ProductCard>` вынесен в Slice 2 (отдельная сессия, нужны продуктовые решения и ручная браузерная проверка).
- `src/lib/advertising/terms.ts` (новый): словарь из 23 терминов (`DRR`, `ACOS`, `ROAS`, `CPO`, `CPC`, `CTR`, `CPM`, `CVR`, `CR`, `AOV`, `BREAKEVEN_CPM`, `NM_ID`, `AUTOPILOT`, `ADVISOR`, `GUARDRAIL`, `KILL_SWITCH`, `LEARNING_PERIOD`, `COOLDOWN`, `DAILY_CAP`, `CLUSTER`, `DAYPARTING`, `BOOST`, `AUTO_REFILL`), каждый с `code`/`label`/`tooltip`/`unit?`. Хелпер `getTerm(code)`. Готово к замене сырых терминов в UI.
- `calcCampaignStatus({ drrPct, targetDrrPct, orders, spendRub, stockQty })` → `'good' | 'warning' | 'danger'` добавлен в `src/lib/advertising/math.ts`. Логика: `danger` при остатке 0 + spend>0, при spend ≥ 500 ₽ без заказов, при ДРР ≥ 2× target (или > 50% без target); `warning` при 1×..2× target (или 30..50% без target), при stock < 3, при spend < 500 ₽ без заказов; `good` иначе.
- Получение URL фото артикула не требует отдельного API-вызова — уже есть детерминированный `getWbPhotoUrl(nmId)` в `src/lib/wb-api/wb-photos.ts` (basket-формула), готов к использованию в `<ProductCard>` Slice 2.
- Unit-тесты: добавлено 15 тестов для `calcCampaignStatus` в `src/lib/advertising/math.test.ts` → **43/43 passed** (было 28, +15).
- Checks: `npx vitest run src/lib/advertising/math.test.ts` ✅ 43/43, `npm run build` ✅, `npm run lint` ✅.
- **Commit:** _(этот коммит)_. Status P68: `in-progress` (Slice 1 done, Slice 2 pending).

---

## 2026-04-17 (20)

### P65 · Guardrails System — автопаузы, дневной cap, kill switch

- Код доставлен ранее в commit `b684a1d` (merged в `main`), но статус в backlog оставался `todo` — закрываем трек.
- `src/lib/advertising/guardrails.ts`: 10 триггеров — `kill_switch`, `learning_period`, `cooldown`, `daily_cap`, `low_stock`, `high_drr`, `spend_no_orders`, `low_cr`, `max_bid_delta`, `max_bid`.
- `normalizeGuardrailConfig()` приводит конфиг к дефолтам, `isInLearningPeriod()` считает возраст стратегии, `checkGuardrails(ctx, cfg)` возвращает `{ passed, advisorOnly, blockedBy, reason }`.
- Миграция `drizzle/0036_advertising_guardrails.sql`: таблица `advertising_guardrail_events` + колонки `advertising_autopilot_enabled` (tenants), `guardrail_config`/`last_bid_changed_at`/`strategy_started_at` (strategies).
- Интеграция в `src/server/advertising/workspace.ts`: `checkGuardrails` перед каждым bid-изменением в `executeStrategyRun`; strategy-level блок скипает run + логирует событие; per-cluster блок фильтрует предложения; `lastBidChangedAt` обновляется после apply.
- Unit-тесты: `src/lib/advertising/guardrails.test.ts` → **42 passed** (все триггеры + граничные случаи: нулевой CR/stock/delta, kill switch, learning period, cooldown).
- Checks: `npx vitest run src/lib/advertising/guardrails.test.ts` ✅ 42/42, `npm run build` ✅, `npm run lint` ✅.
- **Commit (код):** `b684a1d`. **Commit (docs):** _(этот коммит)_.

---

## 2026-04-17 (19)

### P64 · Финансовое ядро рекламы: расчёты + Break-even CPM

- Код доставлен ранее в commit `f8521a6` (merged в `main`), но статус в backlog оставался `todo` — закрываем трек.
- `src/lib/advertising/math.ts` содержит: `calcDRR`, `calcROAS`, `calcCPO`, `calcCPC`, `calcCTR`, `estimateBidSavingsRub`, `computeSelfLearningRunReward`, `calcBreakevenCPM`, `calcBreakevenStatus`.
- Break-even CPM: `(margin × conversionRate × avgOrderValue) / 10` → ₽/1000 показов; `calcBreakevenStatus` возвращает `safe` (<80%), `warning` (80–100%), `danger` (≥100% или currentCPM>0 при breakeven=0).
- Unit-тесты: `src/lib/advertising/math.test.ts` → **28 passed** (вкл. граничные: нулевой CR, нулевая маржа, нулевой AOV, нулевая выручка, нулевые заказы/клики/показы, нулевой breakeven).
- `src/server/advertising/workspace.ts` уже импортирует `estimateBidSavingsRub` и `computeSelfLearningRunReward` из `@/lib/advertising/math`.
- Checks: `npx vitest run src/lib/advertising/math.test.ts` ✅ 28/28, `npm run build` ✅, `npm run lint` ✅.
- **Commit (код):** `f8521a6`. **Commit (docs):** _(этот коммит)_.

---

## 2026-04-17 (18)

### P3-38 · Dependabot: автообновление зависимостей

- Создан `.github/dependabot.yml`: npm weekly (пн, 09:00 MSK) с 5 группами (next-ecosystem, tanstack, supabase, drizzle, inngest, dev-tooling), лимит 5 PR, major-версии игнорируются (ручной апрув).
- GitHub Actions weekly: лимит 3 PR.
- **Commit:** _(этот коммит)_

---

### P3-36 · i18n — wontfix

- Проведена оценка: UI содержит ~1200 RU-строк в 111 файлах, i18n-инструментов нет, next.config без locales.
- Продукт ориентирован исключительно на RU-рынок (Wildberries). Внедрение i18n нецелесообразно до выхода на новые рынки.
- Статус установлен `wontfix` в чеклисте.
- **Commit:** _(этот коммит)_

---

## 2026-04-17 (17)

### P3-37 · A11y: scope на th, aria-label на icon-кнопках, focus trap в SignalDetailsPanel

- `scope="col"` добавлен на 202+ `<th>` элементов в 10 файлах: redistribution, explorer, stocks, advertising (audit, dayparting, overview, workspace), DynamicsTable, EconomicsTable, UnitEconomicsTemplateTable
- `aria-label` добавлен на 3 icon-only кнопки: `SignalDetailsPanel` close («Закрыть»), `settings` cancel («Отменить»), `team` invite-modal close («Закрыть»)
- Focus trap в `SignalDetailsPanel`: Tab/Shift+Tab цикл внутри диалога; начальный фокус на первом focusable-элементе при открытии
- `SignalDetailsPanel` уже имел `role="dialog"`, `aria-modal="true"`, `aria-label` и Escape-хандлер — focus trap завершает паттерн
- **Commit:** `d78fa79`, `a62c0c5`

---

## 2026-04-17 (15)

### P2-27 · Сужен outputFileTracingIncludes для Playwright

- `outputFileTracingIncludes` изменён с `"/*"` на `"/api/inngest"` в `next.config.ts`
- Playwright/playwright-core бинари по-прежнему включены в standalone output через трассировку inngest-роута
- Все остальные роуты больше не тянут Playwright в свой trace
- **Commit:** `1a709af`

---

### P2-26 · CSV download из DB-items (no filesystem dependency)

- `run-csv` API route переписан: сначала читает `redistribution_items` из БД, строит CSV через `buildRedistributionCsvContent`
- Fallback на `csvFilePath` (readFile) только если items в БД не найдены — для обратной совместимости с прогонами до этого изменения
- Устранена зависимость от наличия файла на диске; cross-tenant безопасность через `tenantId` check на уровне DB-запроса
- **Commit:** `a0bc650`

---

## 2026-04-17 (13)

### P3-42 · Удалены render.yaml и Dockerfile

- `render.yaml` и `Dockerfile` удалены из репозитория
- Сервис деплоится через bare-metal systemd на goalbot (`/etc/systemd/system/enterprise-wb-analytics.service`) — Render и Docker-деплой не используются
- `Dockerfile` содержал `PORT=3000`, что уже расходилось с реальным `PORT=3457` на сервере

---

## 2026-04-17 (12)

### P3-41 · next-themes flash check

- Проверена конфигурация: `suppressHydrationWarning` присутствует на `<html>` в `src/app/layout.tsx`
- `ThemeProvider` (next-themes 0.4.6) настроен: `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`, `storageKey="ewb-theme"`
- next-themes 0.4+ инжектирует inline script в `<head>` до гидратации React — flash исключён
- Дочерний `(dashboard)/layout.tsx` не содержит `<html>` — правильно
- **Исправлений не потребовалось**, задача закрыта как verified

---

## 2026-04-17 (11)

### P2-48 · ExecStartPre systemd guard для client-reference-manifest

- Добавлен `ExecStartPre=/bin/bash -c '...'` в `/etc/systemd/system/enterprise-wb-analytics.service` на goalbot
- Скрипт находит route-group директории `(*)` в `.next/standalone/.next/server/app` и копирует `*manifest*.json` файлы в flat-пути, устраняя `Invariant: client-reference-manifest does not exist` при запросах к pages в route groups `(dashboard)`, `(auth)`
- `systemctl daemon-reload && restart` выполнены, health: `app:ok db:ok supabase:ok inngest:ok`
- **Примечание:** изменение serverside-only, не хранится в git

---

## 2026-04-17 (10)

### P3-40 · ESLint zero-warning baseline

- Добавлен `tmp/**` в ignores (устранило 13 ошибок с `any` в inspect-скриптах)
- Исправлены unused imports в `on-failure.ts`, `balance.ts`, `dayparting-scheduler.ts`, `tenant-access.test.ts`
- Удалён мёртвый код: `isRunAction`, `RunAction` type, `dimensionVolumeLiters`
- `calculationMode` → `_options` там где параметр принимается для API-совместимости но не используется
- eslint-disable для `getTenantBoxTariffs/ReturnTariffs` (future-use), `ClusterTable.tsx` (incompatible-library), `batchOperatingExpensesTotal` (2×)
- Добавлены `globalWbDiscount`, `defaultTaxPercent` в deps useMemo/useCallback в UnitEconomicsTemplateTable
- Настроен `argsIgnorePattern/varsIgnorePattern: ^_` в ESLint
- Итог: **0 errors, 0 warnings** (было 13 errors + 16 warnings)
- **Commit:** `ca70140`

---

### P3-39 · Telegram update_id replay protection

- Новая таблица `telegram_processed_updates(update_id BIGINT PK, processed_at TIMESTAMPTZ)`
- Хелпер `markTelegramUpdate(updateId)`: `INSERT … ON CONFLICT DO NOTHING RETURNING update_id` — атомарный dedup на уровне БД
- Bot route (`/api/bot`) пропускает дублирующиеся update_id с 200 OK (Telegram прекращает retry)
- Fail-open: при сбое БД update обрабатывается (не теряется)
- Периодическая очистка через каждые 500 вызовов (TTL 25 ч)
- 4 unit-теста (new/duplicate/null/db-error)
- Миграция `0039_telegram_processed_updates.sql` применена на `goalbot`
- **Commit:** `7d806aa`

---

## 2026-04-17 (8)

### P3-34 · Расширенные health checks: Supabase + Inngest

- `/api/health` теперь выполняет 3 проверки параллельно через `Promise.allSettled`:
  - **db** — `SELECT 1` через Drizzle (без изменений)
  - **supabase** — GET `${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health` с anon-key header, timeout 3 s
  - **inngest** — GET `INNGEST_BASE_URL` (dev: `127.0.0.1:8288`, cloud: `api.inngest.com`), timeout 3 s, принимает любой non-5xx
- HTTP 200 = всё ok | 207 = soft-degraded (supabase/inngest недоступны, web работает) | 503 = hard fail (db/env)
- Verify на сервере: `curl http://localhost:3457/api/health` → `db:ok supabase:ok inngest:ok env:missing` (503 из-за TELEGRAM_WEBHOOK_SECRET — ожидаемо)
- `npm run build` ✓ | `npm run test` 149/149 ✓
- Server SHA: `390ddb1`, `app:ok db:ok supabase:ok inngest:ok`
- **Commit:** `390ddb1`

---

## 2026-04-17 (7)

### P2-49 · Убраны `.env.production.bak-*` файлы из рабочего каталога на сервере

- 2 файла `.env.production.bak-*` перемещены из `/srv/projects/enterprise-wb-analytics/` в `/srv/backups/enterprise-wb-analytics/env/` (mode 700, owner root).
- В рабочем каталоге остался только живой `.env.production` (mode 600).
- Verify: `ls /srv/projects/enterprise-wb-analytics/.env.production.bak-*` → `No such file or directory` ✓
- **Нет изменений кода** — только сервер-операция.

---

## 2026-04-17 (6)

### P2-25 · `error.tsx` + `global-error.tsx` + `not-found.tsx`

- **`src/app/(dashboard)/error.tsx`** — Client Component error boundary для dashboard route group. Отображает иконку предупреждения, человекочитаемое сообщение, кнопки «Повторить» (вызов `reset()`) и «На главную». `error.digest` показывается для диагностики. `console.error` + TODO-комментарий для `captureException` когда появится SENTRY_DSN.
- **`src/app/global-error.tsx`** — Root error boundary. Включает `<html><body>` (заменяет root layout при критической ошибке). Стили inline, без зависимости от CSS/tailwind. Кнопка «Перезагрузить» + `error.digest`.
- **`src/app/not-found.tsx`** — Кастомная 404-страница с кнопкой возврата на `/overview`.
- `npm run build` ✓ (Next.js подхватил `/_not-found` маршрут) | `npm run test` 149/149 ✓.
- Сервер: `04814aa`, `app:ok db:ok`, сервисы `active`.
- **Commit:** `04814aa`

---

## 2026-04-17 (5)

### P2-24 · Расширить test coverage

- Добавлены 3 новых тест-файла, покрывающих ранее непокрытые критические пути:
  - **`src/lib/errors.test.ts`** — 10 тестов: `AppError` (message, status, instanceof), `getErrorStatus` (AppError/fallback/custom), `getErrorMessage` (AppError/fallback/custom).
  - **`src/lib/auth/tenant-access.test.ts`** — 12 тестов: `requireTenantAccess` (400/401/403 по роли/ok), `requireActiveTenant` (cookie > query param > 400), `requireGroupAccess` (400/404/ok c делегацией).
  - **`src/lib/api-response.test.ts`** — 4 теста: `apiRoute` pass-through, AppError forwarding, generic Error scrubbing, non-Error throw scrubbing.
- **`vitest.config.ts`**: расширен `coverage.include` с 2 до 8 модулей (добавлены `errors.ts`, `auth/tenant-access.ts`, `api-response.ts`, `encryption.ts`, `rate-limit.ts`, `idempotency.ts`).
- Итог: **149/149 тестов, 14 файлов** (`npm run test` ✓ | `npm run build` ✓).
- **Commit:** `57a77f2`

---

## 2026-04-17 (4)

### P2-28 · P2-31 · P2-32 — TypeScript hardening + unified request parsing

**P2-28 · FK onDelete audit:** аудит всех 86 FK-ссылок в `src/lib/db/schema.ts` — все уже имеют явный `onDelete` policy (`cascade` для tenant-specific, `set null` для user-refs). Изменений не требовалось; статус закрыт как «аудит выполнен».

**P2-32 · `noUncheckedIndexedAccess`:**
- Добавлен флаг `"noUncheckedIndexedAccess": true` в `tsconfig.json`.
- Исправлено 250+ ошибок во всех src/-файлах: паттерны — `arr[index]!` в for-loop с bounds-check, `obj[key]!` при итерации по ключам известного объекта, `(await db.insert(...).returning())[0]!` для Drizzle insert-returning.
- Ключевые файлы: `engine.ts` (139 эрр → добавлена переменная `gd = groupDaily[day]!`), `redistribution-rpa.ts`, `workspace.ts`, `redistribution-digest.ts`, `stocks.ts`, `run-create/route.ts`, все мелкие src/-файлы.
- `scripts/` добавлены в tsconfig `exclude` (dev-скрипты с 176 эрр — не production код).
- `team/page.tsx`: `TeamData.tenant` расширен до `| null | undefined` (структурное расхождение с Drizzle-inference, раскрытое новым флагом).
- `npm run build` ✓ | `npx tsc --noEmit` ✓ (только pre-existing 2 ошибки в `encryption.test.ts`).

**P2-31 · Unified request parsing:**
- Создан `src/lib/api-parse.ts`: `parseRequestQuery<T>(request, schema)` и `parseRequestBody<T>(request, schema)` через Zod v4. Бросают `AppError(400)`, подхватываемый `apiRoute` wrapper.
- Применено к 4 роутам: `dynamics/route.ts`, `redistribution/route.ts`, `redistribution/export/route.ts`, `redistribution/run-action/route.ts`.

## 2026-04-17 (3)

### P2-29 · P2-30 · P2-33 — Security hardening + SSL env flag

- **`src/lib/db/index.ts`** — добавлен `ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require'` в `postgres()` options. На локальной разработке и goalbot (локальный сокет) нужен `DATABASE_SSL=disable` в `.env`.
- **`next.config.ts`** — добавлен `async headers()` с 5 security headers на все маршруты: `Strict-Transport-Security` (max-age 63072000), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **`.env.production` на goalbot** — `WB_RPA_LOGIN_URL` обёрнут в двойные кавычки (строка 25 содержит `&`; без кавычек `bash source` падал с `fromSellerLanding: command not found`).
- `npm run build` ✓ | lint: pre-existing errors в `tmp/` — не регрессия.

## 2026-04-17 (2)

### P0-08 · Observability — structured logging + stale-sync alert (commit `c503ccb`)

- **`src/lib/logger.ts`** (новый) — pino@10.3.1 structured JSON logger. Redact: `wbApiToken`, `token`, `password`, `secret`, `encryptionKey`. Base field `service: "enterprise-wb-analytics"`. `LOG_LEVEL` env-override.
- **`src/inngest/stale-sync-alert.ts`** (новый) — Inngest cron `staleSyncAlertJob` (каждые 2 часа): проверяет `max(sync_runs.finished_at)` для tenant'ов с включёнными уведомлениями и WB токеном. Если последний успешный sync старше `SYNC_STALE_ALERT_HOURS` (дефолт 6ч) — Telegram-алерт с указанием давности.
- **Замена `console.*` → `logger.*`** в 10 файлах: `src/lib/api-response.ts`, `src/app/api/bot/route.ts`, `src/app/api/inngest/route.ts`, `src/app/api/views/economics-template/route.ts` (8 вызовов), `src/app/api/views/redistribution/run-action/route.ts`, `src/app/api/views/dashboard/signals/**/route.ts` (2 файла), `src/inngest/on-failure.ts` (3 вызова), `src/inngest/sync-wb.ts`.
- **`.env.example`** — добавлены `LOG_LEVEL=info`, `SENTRY_DSN=` (placeholder), `SYNC_STALE_ALERT_HOURS=6`.
- `npm run test` → 125/125 ✓ | `npm run build` → OK ✓ | SHA `7713621` local↔goalbot ✓
- Sentry DSN: не задан — интеграция `@sentry/nextjs` запланирована как follow-up когда появится аккаунт.

## 2026-04-17

### P1-19 · Шифрование WB RPA storage state

- **`src/lib/wb-rpa/storage-state.ts`** (новый) — хелпер: `loadStorageStateSession(tenantId)` читает зашифрованный blob из БД, проверяет TTL=7 дней, расшифровывает через `@/lib/encryption` (AES-256-GCM), пишет во временный файл в `os.tmpdir()` с mode `0o600`, возвращает `{ tempPath, cleanup }`. `persistStorageStateFromContext(tenantId, context)` снимает storageState с live Playwright-контекста, шифрует и апдейтит БД — файл на диске не создаётся.
- **Миграция `drizzle/0036_wb_lk_storage_state_encryption.sql`** — колонки `tenants.wb_lk_storage_state` (encrypted blob) + `wb_lk_storage_state_refreshed_at` (TTL-метка).
- **`src/server/jobs/redistribution-rpa.ts`** — `runRedistributionUploadRpa` и `runRedistributionRouteProbeRpa` теперь принимают только `tenantId`, сами грузят сессию через хелпер, удаляют tmp-файл в finally. `WB_RPA_STORAGE_STATE_PATH_FALLBACK`/`fileExists`/`resolveLegacyStandaloneOutputPath` удалены. Логи и ошибки упоминают TTL=7 дней.
- **`src/app/(dashboard)/settings/actions.ts`** — `verifyWbLkSession` использует временный файл из `loadStorageStateSession`, после успешного логина сохраняет через `persistStorageStateFromContext`, в finally вызывает cleanup. Удалены `resolveWbLkStorageStatePath`/`checkFileExists`; `storageStatePath` в ответе больше не раскрывает путь файла (`null`).
- **`src/server/redistribution/slot-monitor.ts`** — проверка наличия сессии через `wb_lk_storage_state` (зашифрованная BD-колонка), с fallback на legacy-путь на период миграции.
- **Legacy migration:** при первом обращении, если BD-blob пуст, но старый `output/wb-rpa/sessions/*.json` ещё существует — содержимое шифруется в БД, mtime → `refreshedAt`, файл удаляется.
- `npm run build` ✓, `npm run test` ✓ 125/125.

### P1-13 · Active tenant via HttpOnly cookie

- **`src/lib/auth/tenant-access.ts`** — добавлены `ACTIVE_TENANT_COOKIE`, `readActiveTenantCookie`, `setActiveTenantCookie`, `clearActiveTenantCookie` и новый `requireActiveTenant(request)`: читает tenant из HttpOnly cookie (Secure в production, SameSite=Lax, 30 дней), с fallback на query `?tenantId=` на переходный период. Старый `requireTenantAccessFromRequest` удалён — все callsites мигрированы.
- **`src/app/(auth)/login/actions.ts`** — `login()`/`signup()` ставят cookie через `setActiveTenantCookie(bootstrapState.tenantId)` после bootstrap; если tenant нет, кука очищается.
- **`src/app/actions/session.ts`** — `getInitialSessionData()` синхронизирует cookie с DB-resolved tenant при каждом визите layout.
- **`src/app/(dashboard)/settings/actions.ts`** — `switchActiveTenant()` переставляет cookie после membership check.
- **38 API routes в `/api/views/**`** — мигрированы с `requireTenantAccessFromRequest` на `requireActiveTenant` одной заменой.
- Членство валидируется на каждом запросе (подмена cookie бесполезна). HMAC-подпись не добавлялась: cookie — это только указатель, авторитетна DB-проверка в `requireTenantAccess`.
- `npm run build` ✓, `npm run test` ✓ 125/125.

### perf · economics-template: ускорение первого запроса (commit 4263e0e)

- **`src/app/api/views/economics-template/route.ts`** — 4 узких места устранены:
  1. Двойной последовательный вызов `getAllCardsList` → `Promise.all` (−50% времени WB API).
  2. `await import('@/lib/db/schema')` внутри хэндлера → статический import на уровне модуля.
  3. `getTenantToken` + тарифы + `getBuyoutFactsByNm` выполнялись последовательно → первый `Promise.all` (3 параллельных ветки).
  4. Warehouse measurements + penalties (зависят от token) → второй `Promise.all`.
- Rebase поверх upstream commit `4cc1a90` (warehouse measurements feature) выполнен без конфликтов.
- `npm run build` ✓ (local и server), health `app:ok db:ok`, SHA паритет `4263e0e` local↔server.

### P63 · Рефакторинг монолита AdvertisingWorkspace + P2-23 виртуализация

- **`src/components/advertising/_shared/`** — новые модули: `types.ts` (все type aliases рекламы), `format.ts` (formatMoney/Number/Percent/DateTime/dayLabel/statusLabel), `ui.ts` (priorityChip/riskChip/rankTone).
- **`src/components/advertising/overview/AdvertisingOverview.tsx`** (298 стр.) — вынесен таб «Обзор» с query `/api/views/advertising`.
- **`src/components/advertising/clusters/AdvertisingClusters.tsx`** (158 стр.) + **`ClusterTable.tsx`** (146 стр.) — таб «Кластеры» + виртуализированная таблица через `@tanstack/react-virtual` (порог 50 строк, grid-layout вместо `<table>` для корректной виртуализации).
- **`src/components/advertising/control/AdvertisingControl.tsx`** (310 стр.) — таб «Управление» с query + mutation включения/исключения кампании из кластера.
- **`src/components/advertising/workspace/AdvertisingBidWorkspace.tsx`** — переименование из `AdvertisingWorkspace.tsx` (export + file), содержимое не дроблено (8 sub-табов делят shared state; дробление → follow-up P63.1).
- **`src/app/(dashboard)/advertising/page.tsx`** — 1300 → 190 строк: только layout, кнопки табов, `next/dynamic` lazy-import всех 7 табов (overview/clusters/control/workspace/balance/dayparting/history).
- **`@tanstack/react-virtual` v3.13** добавлен в зависимости.
- Закрыт P2-23 (виртуализация таблиц через react-virtual).
- `npm run build` ✓, `npm run lint` ✓ (без новых ошибок), `npm run test` ✓ 125/125.
- Smoke-тест в браузере **не выполнен в этой сессии**: рекомендуется пройти по всем табам рекламы перед деплоем на prod.

### P0-03 · Row-Level Security на 50 таблицах с tenant_id (commit 18f12de)

- **`drizzle/0038_rls_enable.sql`** — идемпотентная SQL-миграция: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + политика `tenant_isolation` на 50 таблицах (все с `tenant_id`, кроме `users`). Политика IS-NULL bypass: код без `SET LOCAL app.tenant_id` видит все строки, код с `SET LOCAL` ограничен своим тенантом. Таблица `users` исключена — её `tenant_id` nullable и означает «active tenant», а не owner.
- **`src/lib/db/index.ts`** — экспортирован `withTenantContext(database, tenantId, fn)`: транзакция с `SELECT set_config('app.tenant_id', $1, true)`. Принимает db или существующую транзакцию первым аргументом.
- **`src/lib/db/rls.test.ts`** — 3 unit-теста: корректность вызова set_config, проброс ошибок, разные tenantId per call.
- Backup БД перед миграцией: `/root/enterprise-wb-analytics-backups/pre-rls-20260417-010834.sql.gz` (7.5M).
- Миграция применена через psql напрямую (паттерн проекта: вне drizzle-kit).
- Verify (prod): 50 таблиц `rowsecurity=true`, 50 политик `tenant_isolation`, health `db: ok`.
- `npm run build` ✓, `npx vitest run` 125/125 ✓ (роль `enterprise_wb_analytics_user` имеет BYPASSRLS=false — RLS применяется автоматически).

### P67 · Dayparting UI + аудит-лог + откат действий (commit 16c5e95)

- **`drizzle/0037_advertising_dayparting_audit.sql`** — 2 новые таблицы: `advertising_dayparting_rules` (boolean[168]), `advertising_audit_log` (history + rollback)
- **`src/lib/db/schema.ts`** — Drizzle-определения `advertisingDaypartingRules` + `advertisingAuditLog`
- **`src/server/advertising/dayparting.ts`** — бизнес-логика: 3 шаблона (workday/evening_weekend/always_on), CRUD, getCampaignsDueForPause/Resume (MSK UTC+3)
- **`src/server/advertising/audit.ts`** — writeAuditEntry, getAuditLog (фильтры), rollbackBidChange (идемпотентный откат)
- **`src/server/jobs/advertising-dayparting-scheduler.ts`** — Inngest cron `0 * * * *` (ежечасно): паузит/возобновляет кампании по расписанию
- **`src/app/api/views/advertising/dayparting/route.ts`** — GET/POST/DELETE
- **`src/app/api/views/advertising/audit/route.ts`** — GET (фильтры) + POST rollback → WB API
- **`src/components/advertising/dayparting/DaypartingSchedule.tsx`** — сетка 7д×24ч с drag-выбором, 3 шаблона-кнопки
- **`src/components/advertising/audit/AuditLog.tsx`** — таблица с фильтрами по типу/кампании/дате, кнопка «Откатить» для bid-записей
- **`src/lib/wb-api/index.ts`** — добавлены `pauseAdvert` + `resumeAdvert`
- Вкладки «Расписание» и «История» добавлены в `/advertising`
- `npm run build` ✓, `npx vitest run` 122/122 ✓



### P66 · Страница баланса WB — реализована (commit 1ea0247)

- **`src/lib/wb-api/ads-balance.ts`** — WB API клиент: `wbGetAdBalance`, `wbGetAdSpendHistory`, `wbDepositAdBudget`
- **`src/lib/db/schema.ts`** — 3 новые таблицы: `advertising_balance_snapshots`, `advertising_auto_refill_settings`, `advertising_auto_refill_logs`
- **`drizzle/0036_advertising_balance.sql`** — SQL миграция
- **`src/server/advertising/balance.ts`** — бизнес-логика: кеш баланса, прогноз «хватит на N дней», ручное пополнение, автопополнение (cooldown 6ч + дневной cap 10 000₽)
- **`src/app/api/views/advertising/balance/route.ts`** — `GET` + `POST` (deposit | configure-auto-refill)
- **`src/components/advertising/balance/BalancePage.tsx`** — UI: карточки реальные₽/бонусы/статус, график расходов 30д, форма пополнения, настройки автопополнения
- **`src/server/jobs/advertising-balance-sync.ts`** — Inngest cron `*/30 * * * *`
- Таб «Баланс» добавлен в `/advertising`
- `npm run build` ✓, `npx vitest run` 52/52 ✓

## 2026-04-16

### Advertising Redesign Track: планирование Wave 1

- Проведён глубокий ресёрч рекламного рынка: WB ADV API 2025 (тип кампании 9, min CPM 250₽, скрытие ставок конкурентов), конкуренты (MPSTATS, Salist, PromoPult, закрытие Moneyplace), AI-практики Amazon/Google, open-source biддеры
- Принято решение: полный редизайн вкладки «Реклама» — снос UI-монолита, сохранение бизнес-логики, новый принцип «инструмент заменяет рекламный кабинет WB полностью»
- Добавлены тикеты P63–P70 в `IMPLEMENTATION_BACKLOG.md` (раздел «Advertising Redesign Track»):
  - **P63** · Рефакторинг `AdvertisingWorkspace.tsx` (4370 строк → компоненты + виртуализация)
  - **P64** · Финансовое ядро: `src/lib/advertising/math.ts` + Break-even CPM + unit-тесты
  - **P65** · Guardrails System: 4 автопаузы + дневной cap + Advisor mode 7 дней + kill switch
  - **P66** · Страница баланса: реальные деньги / бонусы / пополнение / автопополнение
  - **P67** · Dayparting UI + аудит-лог + откат действий
  - **P68** · UX редизайн: 6-секционная навигация + карточки с картинками + терминология-лайт
  - **P69** · Объяснения к автодействиям (статические шаблоны «почему»)
  - **P70** · Telegram-алерты рекламных событий
- Порядок запуска: P64 → P65 → P66 → P63 → P67 → P68 → P69 → P70
- Обновлена сводка прогресса в `ENTERPRISE_LAUNCH_CHECKLIST.md` (+8 тикетов Wave 1)

### P1-11: Rate limiting

- Новый `src/lib/rate-limit.ts` — in-memory sliding-window rate limiter (без Redis)
- `withRateLimit(handler, { per, limit, window })` wrapper с 429 + Retry-After
- Применено к 5 endpoints: `/api/bot` (60/min IP), `/api/health` (30/min IP), `run-create` (10/min tenant), `publish` (10/min tenant), `reply` (20/min tenant)
- 4 unit-теста (`src/lib/rate-limit.test.ts`)

### P1-17: Dead letters + Telegram alerts on Inngest failure

- Новый `src/inngest/on-failure.ts` — shared `handleInngestFailure` handler
- При final failure Inngest функции: шлёт Telegram алерт с именем функции, ошибкой, временем
- Event-driven функции (sync-wb, rpa, ads-retry): алерт по tenantId из event.data
- Cron функции: broadcast алерт всем тенантам с включёнными уведомлениями
- `onFailure: handleInngestFailure` добавлен ко всем 15 Inngest функциям (13 файлов)
- Graceful degradation: не ломается без бота или без chatId

### P1-14: Idempotency-Key для mutation POST

- Новая таблица `idempotency_keys` (schema + migration `0031_idempotency_keys.sql`)
- `src/lib/idempotency.ts` — `withIdempotencyKey` wrapper: проверяет `Idempotency-Key` header, кэширует ответ по (key, tenantId), возвращает кэш при повторе или 422 при hash mismatch
- Применено к 4 mutation endpoints: `redistribution/run-create`, `reviews-qa/publish`, `reviews-qa/reply`, `advertising/workspace/bids`
- TenantId извлекается из URL query или body JSON
- 6 unit-тестов (`src/lib/idempotency.test.ts`): pass-through, cache hit, hash mismatch, new key caching, body tenantId, key length validation

### P1-20: lucide-react upgrade

- Обновлено `lucide-react` с `1.7.0` → `1.8.0` (latest)
- Проверены все 65 используемых иконок — все экспортируются в новой версии
- Билд чистый

### P1-21: xlsx → exceljs migration

- Заменён `xlsx@0.18.5` (unmaintained, license issues) на `exceljs@4.4.0` (MIT, maintained)
- Переписан `exportExcelWorkbook` в `UnitEconomicsTemplateTable.tsx` на exceljs API
- Единственное место использования — клиентский экспорт юнит-таблицы в .xlsx
- Билд чистый

### P1-16: Inngest concurrency limits

- `a41466a` fix(inngest): add concurrency limits to all 15 functions (P1-16)
  - `syncWildberriesData`: 1 per tenant + 3 global — prevents parallel sync for same tenant and pool exhaustion
  - `redistributionRpa`: 1 per tenant + 2 global — Playwright sessions are heavy
  - `wbAdsRetryDispatcher`: 1 per tenant — prevents retry storm
  - All 10 cron jobs: limit 1 — no overlapping cron runs
- Deployed to `goalbot`, services restarted, SHA parity confirmed

### P1-09: ENCRYPTION_KEY derivation — завершение

- `54b44e6` fix(encryption): throw AppError on decrypt failure, add unit tests and rotate script (P1-09)
  - `AppError`, `getErrorStatus`, `getErrorMessage` вынесены в `src/lib/errors.ts` (нет DB-зависимостей); `tenant-access.ts` ре-экспортирует для обратной совместимости — все 30+ существующих импортёров без изменений
  - `decryptIfNeeded` теперь бросает `AppError(500)` вместо silent fallback при ошибке расшифровки; принимает опциональный `tenantId` для контекста в сообщении
  - Новый `src/lib/encryption.test.ts` — 13 unit-тестов: round-trip encrypt/decrypt, decryptIfNeeded (plain/encrypted/corrupt/tenantId), парсинг ключа (hex-64, hex: prefix, legacy UTF-8, too-short, missing key)
  - Новый `scripts/rotate-encryption-key.mjs` — CLI ротации ключа: `--old-key <hex64> --new-key <hex64> [--dry-run]`; читает `DATABASE_URL` из env или `.env.production`; транзакционно re-encrypt все `wb_api_token` в таблице tenants
  - Все 42 теста зелёные; lint clean; build OK
- Deployed to `goalbot`, service restarted, health `db: ok`

### P1-18: Error scrubbing в API responses

- `ada1f6d`, `9cffe1c` fix(security): scrub internal errors from API responses (P1-18)
  - `getErrorMessage()` в `tenant-access.ts`: теперь возвращает `err.message` только для `AppError`, иначе константу `'Internal Server Error'` — Drizzle/Postgres детали больше не утекают в ответ клиенту
  - Новый файл `src/lib/api-response.ts`: функция `apiRoute(handler)` — оборачивает handler в try/catch, логирует raw ошибку server-side, возвращает scrubbed JSON ответ
  - `apiRoute()` применён ко всем 32 views route.ts хэндлерам; 2 динамических route (`[signalId]`, `[runId]`) сохраняют нативный try/catch — получают защиту через исправленный `getErrorMessage`
  - `reviews-qa/dashboard`: кастомная WbApiError обработка сохранена — fallback-ответ для recoverable WB ошибок, `throw error` для остального (ловит apiRoute)
  - `redistribution/run-action`: вложенный try/catch для Inngest queue остался — внешний catch заменён apiRoute
- Deployed to `goalbot`, services restarted, SHA parity confirmed (`9cffe1c`)



### P1-12: User enumeration fix

- `b639e03` fix(security): prevent user enumeration via auth error messages (P1-12)
  - `login()`: replaced Supabase `error.message` passthrough with generic `'Неверный email или пароль'` for all auth errors
  - `signup()`: replaced raw error with generic `'Не удалось создать аккаунт. Проверьте данные и попробуйте снова.'`
  - `requestPasswordReset()`: always returns success message regardless of whether email exists — no error leak
  - Added zod validation (`z.email()`, `z.string().min(8)`) for FormData in all three actions
- Deployed to `goalbot`, services restarted, SHA parity confirmed

### P1-10: Inngest signing key enforce

- `8cac802` fix(security): enforce Inngest signing key in production (P1-10)
  - `signingKey` passed explicitly to `Inngest` client constructor from `INNGEST_SIGNING_KEY` env
  - Request-time guard in `/api/inngest` route: production without `INNGEST_DEV` and no signing key → 503 (fail-closed)
  - One-time warning when `INNGEST_DEV=1` in production — reminder to switch to Inngest Cloud
  - Removed unsafe `"local-dev"` fallback for `eventKey`
  - `INNGEST_SIGNING_KEY` added to health check `requiredEnvKeys` (conditional — only when `INNGEST_DEV` is not set)
- Deployed to `goalbot`, services restarted, verified: GET `/api/inngest` → 200 (dev mode active), warning logged once on first request, health unaffected (dev mode skips key requirement)
- Note: Server runs `INNGEST_DEV=1` with self-hosted dev server (`:8288`). When switching to Inngest Cloud — remove `INNGEST_DEV`, set `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY`. Without key, app returns 503 (fail-closed).

### P0-05: Postgres connection pool config

- `847f5cc` fix(db): configure connection pool limits + timeout env vars
  - `postgres()` now receives `max=15`, `idle_timeout=20`, `max_lifetime=1800`, `connect_timeout=10` with env overrides (`PG_POOL_MAX`, etc.)
  - `ALTER SYSTEM SET statement_timeout = '30s'` + `idle_in_transaction_session_timeout = '60s'` applied via `su - postgres` + `pg_reload_conf()`
  - Verified: `SHOW statement_timeout` → 30s, idle connections dropped from 6 to 0, `max_connections=100` gives plenty of headroom for 2 pools of 15

### P0-01 + P0-02: Telegram webhook hardening

- `bd31cd3` fix(security): webhook fail-closed + error scrubbing
  - **P0-01**: POST /api/bot now returns 503 in production when `TELEGRAM_WEBHOOK_SECRET` is missing or < 32 chars. `isWebhookSecretValid()` never returns `true` without a configured secret. `TELEGRAM_WEBHOOK_SECRET` added to health check `requiredEnvKeys`.
  - **P0-02**: catch block returns `"Internal Server Error"` instead of leaking `err.message`. Full details stay in `console.error`.
- Deployed to `goalbot`, services restarted, verified: POST /api/bot → 503, health → 503 with `missingEnv: ["TELEGRAM_WEBHOOK_SECRET"]`. No error details in any response body.
- Note: `TELEGRAM_WEBHOOK_SECRET` not yet set on server (bot uses placeholder token). Health returns 503 until real bot token + webhook secret are configured.

### P0-07 phase 1: GitHub Actions CI workflow

- `dc69cf4` docs(operations): correct DNS/TLS topology — nginx + Let's Encrypt for `про-цифры.рф`, not cloudflared quick tunnel. Added network topology diagram to `SERVER_GOALBOT.md`. Verified via SSH: DNS A-record direct to server, nginx L4 SNI multiplexer on :443 → L7 HTTPS on :8443 with Let's Encrypt → Next.js on :3457. Cloudflared quick tunnel service still running but NOT in production chain.
- `401ac40` ci(github-actions): add `.github/workflows/ci.yml` — lint/test/build on push to main and on PRs. Node 22, npm cache, stub env vars for build, concurrency with cancel-in-progress, 15-min timeout. Locally all green: 29 tests pass, build OK.
- **Blocker discovered:** first CI run on GitHub failed with billing error ("recent account payments have failed or your spending limit needs to be increased"). Workflow yaml is correct — blocked at account level. User action: fix billing in GitHub Settings → Billing & plans.
- **Scope decisions for P0-07:**
  - Branch protection: deferred — requires GitHub Pro ($4/mo) for private repos.
  - deploy.yml with SSH: wontfix — deploy stays manual (`local checks → git push → ssh goalbot pull && restart`). Automating SSH from CI expands blast radius of CI compromise to production root.
  - Auto-pull on server: N/A — no auto-pull exists.

## 2026-04-15

### Enterprise Audit Consolidation: 5 commits on main + migration 0029 deployed

- merged work-in-progress from audit passes 1-6 (left as uncommitted files in the
  local `main` working tree) into five focused commits on `main`, pushed to
  `origin/main` and deployed to `goalbot`:
  - `47ba6b1` fix(encryption): support hex-64 key format with legacy fallback (P1-09 partial)
  - `01a3ba9` fix(sync): transactional writes, scheduled-run race protection, ads retry backoff (P1-15)
  - `7e750e6` feat(db): composite indexes for raw API tables by tenant and date (P0-04)
  - `a32550d` refactor(analytics): strict typing, financial rounding guards, lint fix
  - `aaa1a9f` feat(ops): nightly backup, watchdog, pre/post-deploy gates + docs + eslint ignore
- pre-migration snapshot at `/srv/backups/enterprise-wb-analytics/pre-migration-0029-20260415-204352/` (6.4 MB pg_dump -Fc + sha256).
- migration 0029 applied on `goalbot` production database. Six new indexes (`ad_costs_tenant_date_idx`, `orders_tenant_date_idx`, `orders_tenant_nm_date_idx`, `realization_tenant_date_idx`, `realization_tenant_nm_date_idx`, `sales_tenant_date_idx`) are live and used by the query planner (`Index Scan using orders_tenant_date_idx`, Execution Time 0.762 ms on 30-day aggregate query).
- `npm run build` + `systemctl restart enterprise-wb-analytics enterprise-wb-analytics-inngest` on server, `/api/health` returns `{ok:true, app:ok, db:ok, env:ok}`, systemd units `active (running)`.
- identified pre-existing Next 16 standalone bug: `client-reference-manifest` missing for `/overview`, `/login`, `/advertising`, `/explorer`. Present in log since the very first build; not a regression of these commits. Tracked as new item `P2-48`.
- `docs/ENTERPRISE_LAUNCH_CHECKLIST.md`: updated statuses for P0-04 (done), P1-09 (in_progress), P1-15/P1-43/P1-44/P1-45/P1-46/P1-47 (done), P3-35 (in_progress), plus new items P2-48, P2-49, P2-50.
- infrastructure direction: user chose **Variant B** (split roles across 2-3 RU-based nodes) for P0-06. Server procurement in progress.

### Enterprise Pre-Launch Audit + Baseline Snapshot

- completed full enterprise-readiness audit covering security, tenancy, database, API surface, Inngest/WB jobs, frontend, DevOps and observability; report captured in [`docs/ENTERPRISE_AUDIT_2026-04-15.md`](./ENTERPRISE_AUDIT_2026-04-15.md).
- verdict: **not ready for commercial enterprise launch** in current state — 8 P0 blockers, 13 P1 high, 12 P2 medium, 9 P3 low items identified.
- introduced a tracking chain of docs:
  - [`docs/ENTERPRISE_LAUNCH_CHECKLIST.md`](./ENTERPRISE_LAUNCH_CHECKLIST.md) — single source of truth for P0→P3 items with per-item verify steps and commit slots.
  - [`docs/THREAT_MODEL.md`](./THREAT_MODEL.md) — STRIDE-based threat model with assets, trust boundaries, and compliance notes.
  - [`docs/INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) — runbook with contact list, severity matrix, playbooks for web/inngest/db/telegram/rpa outages, backup restore and rollback procedures.
  - [`docs/IMPLEMENTATION_BACKLOG.md`](./IMPLEMENTATION_BACKLOG.md) — added "Enterprise Launch Track" section at the top referencing P0-01…P3-42.
- confirmed local/server parity: server `goalbot` (`/srv/projects/enterprise-wb-analytics`) and local `main` both at `7419e54`, working tree clean on both sides.
- pre-audit snapshot captured at `/srv/backups/enterprise-wb-analytics/pre-audit-20260415-224500/` (pg_dump 6.4 MB, project-files tar 7.5 MB, repo bundle 1.3 MB, systemd units, env files with `chmod 600`, sha256 checksums). Mirrored locally to `~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/pre-audit-20260415-224500/` and verified.
- created local recovery branch `backup/pre-audit-fixes-20260415-2245` off `main` (`7419e54`) so any audit-fix branch can reset safely.
- noted real runtime topology: bare-metal `goalbot` (Debian 13, 4 CPU, 5.8 Gi RAM, local Postgres 17, self-hosted Supabase in Docker, Cloudflared quick tunnel, Playwright RPA via xvfb/x11vnc/novnc). `render.yaml` and `Dockerfile` in repo currently do not describe production; reconciled as P3-42.

### Redistribution RPA: Partial-Failure Handling + Article Selection Fallback

- hardened redistribution modal article option detection:
  - default `WB_RPA_ARTICLE_OPTION_SELECTOR` now also includes `[role="option"]` so the picker still works when WB switches option markup away from legacy class names.
- enabled vendor-code article fallback by default:
  - `WB_RPA_ARTICLE_ALLOW_VENDOR_CODE_FALLBACK` now defaults to enabled when env is not set;
  - fallback is still configurable, and duplicate candidates are skipped.
- changed run execution behavior for modal submit mode to avoid collapsing the whole run on one hard-fail:
  - RPA now continues processing all items (`continueOnHardError=true`) and preserves per-item statuses;
  - after full pass, run is marked `rpa_failed` only if there were failed items, with an aggregated error summary including failed sample rows.
- updated `.env.example` defaults for the new selector/fallback behavior.

## 2026-04-14

### Sync Runtime: Stale-Run Auto Timeout + Hourly Fast Profile

- added stale-run auto-finalization for `sync_runs` reads in settings/overview:
  - server action `getSyncRunsHistory(...)` / `getLatestSyncRun(...)` now auto-marks tenant runs as `failed` when they stay `pending|running` longer than `WB_SYNC_STALE_TIMEOUT_MINUTES` (default `60`);
  - stale timeout failures are tagged with a stable marker (`[sync_run_stale_timeout]`) so UI can distinguish them from regular source/API failures.
- improved operator status messaging for stale runs:
  - `DataFreshnessBanner` now shows `Остановлен по таймауту` and explanatory copy instead of a perpetual `Синхронизация выполняется` state;
  - settings `SyncButton` history now renders `Зависший запуск (таймаут)` plus explicit guidance to rerun sync.
- changed default fast scheduled sync cadence to hourly:
  - `WB_SYNC_FAST_CRON` default switched from `*/30 * * * *` to `0 * * * *`;
  - active-run lock window for scheduled and ads-retry dispatchers is now configurable via `WB_SYNC_ACTIVE_LOCK_MINUTES` (default `60`, previously hardcoded `2 hours`).
- updated environment/docs surface:
  - `.env.example` now includes `WB_SYNC_ACTIVE_LOCK_MINUTES` and `WB_SYNC_STALE_TIMEOUT_MINUTES`;
  - `README.md` and `docs/PROJECT_GUIDE.md` now document the new defaults and runtime knobs.

### Advertising: Self-learning Autopilot (Position + Savings) In Workspace

- upgraded autobid strategy engine in `src/server/advertising/workspace.ts` with a new `self_learning` control mode:
  - strategy now supports target position corridor (`from-to`), exploration share, and minimum click threshold for confident decisions;
  - each scheduled run can pick the most promising position corridor from pre-defined arms (`1-2`, `2-3`, `3-5`, `4-6`) using deterministic explore/exploit selection and accumulated run reward;
  - bid logic now includes position-aware actions:
    - decrease bid when position is better than required,
    - increase bid when position is below the target corridor (with ДРР/CPC safety guardrails),
    - micro-probe downward when already inside the target corridor to search for cheaper traffic;
  - run summary now stores:
    - selected target corridor,
    - observed average position,
    - estimated bid-savings potential,
    - run reward,
    - autopilot config and persisted learning state.
- fixed savings estimation inflation in autopilot telemetry:
  - per-run savings are now normalized to strategy execution interval (instead of reusing full lookback clicks on every run);
  - run/changes summary includes explicit savings model metadata (`interval_window`) and normalization parameters;
  - top insight KPI in workspace now shows `Оценка экономии / 24ч` rather than unbounded cumulative total.
- added excluded-cluster retest cycle for self-learning mode:
  - strategy can periodically return part of minus-phrases back into auction after configurable cooldown;
  - retest actions are logged in `advertising_cluster_actions` with `auto_retest` / `auto_retest_failed` meta reasons;
  - run summary now includes retest counters and errors.
- expanded workspace UI in `src/components/advertising/AdvertisingWorkspace.tsx` for transparency:
  - strategy form now includes self-learning controls (mode, position corridor, exploration %, retest cadence/volume, min-click learning threshold);
  - strategy cards now show mode, target position, exploration rate, and retest policy;
  - added autopilot insight KPIs (estimated savings, average reward, average observed position, in-target share);
  - enriched auto-change journal with per-change position, target corridor, and estimated savings columns;
  - auto-change journal now also shows `Δ ставки, %`, `клики/заказы/ДРР (сегодня/окно)` and guardrail context per decision;
  - `ДРР (сегодня/окно)` and `Guardrail` now have semantic color badges (OK/attention/risk) so problematic rows stand out visually.
  - added new `Реклама 2` tab: dark compact operations view inspired by legacy bidder workflows with:
    - status mode switches (`Активные` / `Пауза` / `Все`), quick risk toggles, and manual sync trigger;
    - dense upper ribbon table (`Товар/Кластер`, таргет/ставка/лимит, CTR, затраты, клики/заказы, ДРР, signal);
    - lower split layout: left product card + right detailed tabs (`По дням`, `Запросы`) for selected cluster.
  - enriched strategy run history with target position, observed average position, and estimated savings for each run.
- improved campaign context readability in the same workspace:
  - advertising cluster payload now includes product preview URL (`photo_url`);
  - `Контекст управления` now renders a compact SKU card (photo, brand/vendor code, nmId, cluster, and selected campaign id), so operators can immediately see which product/campaign they are editing.
- hardened workspace data loading for unstable WB normquery endpoints:
  - `getAdvertisingBidWorkspace(...)` now degrades gracefully when WB returns empty/error on `get-bids/stats/list`, and builds cluster rows from local `raw_api_ad_clusters` facts instead of rendering a blank workspace;
  - `getAdvertisingClusterMap(...)` now falls back to local daily cluster facts when WB `normquery/stats` is empty/unavailable, so `Реклама 2` and map/day panes still show operational data.

### Dynamics Cleanup for Group Merge View (RAW/Finance Removal + Readability)

- updated `src/components/dashboard/DynamicsTable.tsx` to remove RAW-oriented and finance buyout metrics from the visible dynamics grid:
  - removed explicit rows with labels `Заказы (RAW)`, `Выкупы (RAW)`, `Выкупы (финансы)`, `Оборотка / выкупы (финансы)`;
  - removed SKU detail rows `Выкупили всего на сумму (RAW)` and `Выкупили всего на сумму (финансы)`;
  - removed parenthesized funnel suffix in UI labels (`(воронка)`), keeping clean names (`Заказы`, `Выкупы`).
- removed unneeded SKU snapshot metrics from the expanded item block:
  - `Контент (фото)` and `Контент (видео)` no longer render in the table.
- improved table readability for dense dynamics blocks:
  - strengthened row/column borders for primary rows and expanded SKU rows to form a clear grid;
  - added sticky date header behavior (`top`-sticky on header cells) so the date panel follows vertical scrolling.
- improved SKU visual block in the dynamics table:
  - product preview image switched to `object-contain` and enlarged in the SKU row to reduce crop distortion and narrow previews.
- updated UI copy to remove remaining raw wording:
  - `Из raw-фактов` -> `Из факт-данных`.
- updated `src/components/dashboard/KPICards.tsx` to remove RAW/funnel wording in KPI labels and fallback trends:
  - `Заказы (RAW)` -> `Заказы`;
  - `Ср. чек (RAW) / Конверсия` -> `Ср. чек / Конверсия`;
  - fallback helper text now uses neutral `нет данных` variants.

### Advertising Workspace: Cluster Average Position Visibility

- extended advertising workspace cluster map (`/advertising` -> `Карта кластеров`) with explicit average position visibility:
  - added table column `Ср. позиция` sourced from `rows[].totals.avgPos`;
  - daily dynamics cells now include cluster position per day (`rows[].daily[].avgPos`) next to spend;
  - added decimal formatter in UI to keep position precision stable (`2` digits, `ru-RU` locale).
- extended bidding table (`Текущие ставки`) with average position visibility:
  - server bids endpoint now enriches rows with `avgPos` from `normquery/stats` for selected period;
  - UI table now has `Ср. позиция` column in the bids block, so position is visible in the same place as bid/ДРР/CPO.

### Dynamics: Formula Alignment With WB Docs (Group + Per-SKU)

- completed a metric-by-metric formula audit for dynamics blocks (`общая прибыль склейки` and `поартикульно`) against official WB API docs and seller instructions:
  - Sales Funnel API (`/api/analytics/v3/sales-funnel/products`),
  - Reports API (`/api/v1/supplier/orders`, `/api/v1/supplier/sales`),
  - Financial report (`/api/v5/supplier/reportDetailByPeriod`),
  - WB instruction pages for ДРР and buyout/conversion formulas.
- updated server formulas in `src/server/analytics/engine.ts` (`getGroupDynamics`):
  - `ДРР`: switched from buyout/finance revenue base to order revenue base (`funnelOrderRevenue`, fallback `orderRevenue`);
  - `% выкупа`: switched from `buyouts/orders` to WB buyout-rate contour (`funnelOrderToBuyoutPercent` first, fallback `buyouts/(buyouts+cancels)`);
  - `Стоимость заказа`: switched to `orderSum/orderCount` from funnel (`funnelOrderRevenue/funnelOrderQty`, fallback raw orders);
  - threaded `funnelCancelQty` through the full dynamics aggregation pipeline.
- synchronized frontend summary formulas in `src/components/dashboard/DynamicsTable.tsx`:
  - `buildSeriesSummary` now uses the same order-based ДРР/buyout/order-price logic as server data.
- added a dedicated audit record:
  - `docs/DYNAMICS_FORMULA_AUDIT_2026-04-14.md` with `метрика -> эталон WB -> было -> стало`.

### Dynamics: Final Factual Control Check (Selected Period)

- added full factual control-check script:
  - `scripts/verify_dynamics_facts.ts`
  - compares `AnalyticsEngine.getGroupDynamics(...)` against an independent raw-data recomputation (`realization/orders/sales/funnel/ads/storage/cost/tax`) for each day, group, and SKU.
- executed full verification for period `2026-03-15..2026-03-23` across all groups:
  - first run (`before fix`): `compared=13 608`, `mismatches=131` (group-level funnel percentage metrics only);
  - root cause: group funnel percentages depended on row-order overwrite (last SKU), not aggregate group totals.
- fixed group funnel percentage calculations in `src/server/analytics/engine.ts` (`getGroupDynamics`):
  - `funnelAddToCartPercent` = `funnelAddToCartQty / funnelViewQty`;
  - `funnelCartToOrderPercent` = `funnelOrderQty / funnelAddToCartQty`;
  - `funnelOrderToBuyoutPercent` = `funnelBuyoutQty / funnelOrderQty`;
  - `buyoutPercent` = `funnelBuyoutQty / (funnelBuyoutQty + funnelCancelQty)` (fallback to order->buyout when cancel contour is unavailable).
- rerun result (`after fix`): `compared=13 608`, `mismatches=0`.
- added dedicated control-check report:
  - `docs/DYNAMICS_FACT_CONTROL_CHECK_2026-04-14.md`.

## 2026-04-13

### Sync Contours Alignment (paid_storage vs weekly finance)

- fixed `paid_storage` dedupe semantics in `src/lib/wb-sync-utils.ts`:
  - duplicates by key (`nmId + warehouse + date`) are now aggregated (`SUM`), not overwritten by the last row.
- aligned medium scheduled contour in `src/server/jobs/wb-sync-sources.ts`:
  - `WB_SYNC_MEDIUM_SOURCES` now includes `paid_storage`.
- added operational utility `scripts/backfill_paid_storage.ts`:
  - range backfill for one/all tenants from WB paid storage API;
  - optional `--clear-range` for clean period rewrite;
  - upsert by composite key (`tenant_id`, `nm_id`, `warehouse_name`, `date`).
- aligned sync date window in `src/inngest/sync-wb.ts`:
  - `paidStorageDateFrom` now uses the same `dateFrom` as the selected sync period (no shorter internal window).
- deployed to `goal_bot` (`/srv/projects/enterprise-wb-analytics`), rebuilt and restarted:
  - `enterprise-wb-analytics.service` `active`,
  - `enterprise-wb-analytics-inngest.service` `active`,
  - health endpoint `GET /api/health` -> `ok`.
- executed server backfill:
  - range: `2026-03-01..2026-04-13`, `--clear-range=1`,
  - Бербека: `fetched=19 875`, `deduped=3 892`, `range_amount=189 703.24`,
  - Лавров: `fetched=19 513`, `deduped=12 717`, `range_amount=89 198.35`.
- post-fix trust outcome (`2026-03-14..2026-04-13`, `FACT_WB`):
  - Бербека: `storage_contour_alignment=warning`, diff `9.68%` (`finance=120 066`, `operational=132 934`),
  - Лавров: `storage_contour_alignment=warning`, diff `8.48%` (`finance=62 808`, `operational=68 631`).
  - status moved from `critical` to `warning` for both cabinets.

### Dashboard Storage Contours Unification (Finance vs Operational)

- unified dashboard financial contour in `AnalyticsEngine.getKpis(...)`:
  - `Чистая прибыль` and KPI `Хранение (фин.)` now rely on the same weekly-finance source (`raw_api_realization_reports.storage_fee_rub`);
  - removed previous semantic split where profit used realization storage while storage KPI used `raw_api_paid_storage`.
- added second KPI card for operational storage:
  - `Хранение (опер.)` from `raw_api_paid_storage.storage_amount`,
  - shown in parallel to finance storage for transparent ops-vs-finance diagnostics.
- expanded dashboard trust audit (`getDashboardDataTrust(...)`) with explicit contour check:
  - new check `storage_contour_alignment`,
  - compares finance storage vs operational storage and assigns severity:
    - `ok` for diff `<= 5%`,
    - `warning` for diff `<= 20%`,
    - `critical` for diff `> 20%`.

### Unit Economics: Warehouse Coeff Refresh + Reverse Logistics Zero Guard

- hardened warehouse matching in `UnitEconomicsTemplateTable` for WB tariffs:
  - default labels updated to explicit targets:
    - `Екатеринбург (Перспективная 14)`;
    - `Санкт-Петербург (Шушары)`;
  - alias matcher added for ambiguous WB warehouse naming (`geoName/warehouseName`, abbreviations, suffixes);
  - exact match resolution switched to strict alias-priority order (no random first fuzzy hit).
- improved box tariff candidate ranking to prioritize usable forward/storage coefficients, reducing false zero picks from sparse rows.
- added dual-key indexing for box tariffs (`warehouseName` + `geoName`) so city labels map to concrete WB geo points more reliably.
- added reverse-logistics fallback in unit-economics warehouse cards and scenario summary:
  - if WB box reverse fields are absent/zero, reverse logistics falls back to forward logistics for that warehouse;
  - UI now marks this path explicitly as `fallback=логистика`.
- reduced economics tariff cache TTL in `src/app/api/views/economics-template/route.ts`:
  - `WB_ACCEPTANCE_TARIFFS_CACHE_TTL_MS`: `10m -> 60s`;
  - `WB_BOX_TARIFFS_CACHE_TTL_MS`: `10m -> 60s`.

Operational note:
- code was synced to `goal_bot:/srv/projects/enterprise-wb-analytics` without service restart (by request), so runtime effect appears after the next planned restart/redeploy cycle.

### Dashboard Data Trust Audit (Anti-Guess Layer)

- added strict dashboard trust audit in `AnalyticsEngine.getDashboardDataTrust(...)`:
  - verifies presence of finance facts for selected period;
  - checks exact funnel snapshot coverage for the selected range;
  - validates primary ads source (`raw_api_ad_costs`) and detects fallback to `raw_api_ad_clusters`;
  - cross-checks `ad_costs` vs `ad_clusters` when both are available;
  - compares funnel orders/buyouts with `raw_api_orders`/`raw_api_sales` quantities;
  - audits catalog linkage quality (`raw_api_realization_reports` rows not mapped to `products`).
- audit response returns machine-readable status: `ok | warning | critical`, score `0..100`, blockers list, and per-check facts (`expected`, `actual`, `deltaPct`, `details`).
- dashboard API `/api/views/dashboard` now includes `dataTrust` payload next to KPI/chart.
- overview UI now renders a dedicated `DataTrustBanner` above KPI cards:
  - shows current trust status and score;
  - exposes top mismatches with exact values;
  - highlights blockers that make blind trust unsafe.

### Berbeka Reconciliation Hardening

- applied local DB migrations (`npm run db:migrate`) and verified payout-detail columns exist in `raw_api_realization_reports`:
  - `ppvz_for_pay`, `deduction`, `additional_payment`, `acquiring_fee`, `return_amount`.
- fixed WB commission mapping in `src/app/api/views/economics-template/route.ts`:
  - `FBW` now resolves from `paidStorageCommission / paidStorageKgvp` (matches WB tariff UI column `Склад WB (FBW), %`),
  - `FBS` resolves from `marketplaceCommission / kgvpMarketplace`.
- synced `src/lib/wb-api/index.ts` on server to the extended commission payload parser:
  - `WbCategoryCommissionItem` now carries `supplierCommission` and `paidStorageCommission`,
  - live verification for subject `Расчески`: `raw(FBW)=32.5`, `raw(FBS)=36`, resolved mapping `FBW=32.5`, `FBS=36`.
- removed stale hardcoded diagnostics from `scripts/reconcile_wb_bundle.py`:
  - cross-file diagnosis now builds from live computed values (stock deltas, ads deltas, buyout contour).
- added new script `scripts/reconcile_weekly_reports.py` to reconcile weekly detailed WB reports against `raw_api_realization_reports` for a tenant/date range.
- executed local one-off realization backfill for `ИП Бербека` (`2026-03-01..2026-03-31`) with WB API payload aliases:
  - post-backfill aggregate in DB for the range: `ppvz_for_pay=576 954.34`, `storage_fee_rub=129 872.35`, `deduction=60 225.00`, `acquiring_fee=20 212.03`.
- generated reconciliation artifacts for Berbeka (March 2026):
  - `output/spreadsheet/reconcile-berbeka-bundle.md`
  - `output/spreadsheet/reconcile-berbeka-weekly.md`

### Server Finance Backfill + Trust Recalibration

- added operational script `scripts/backfill_realization_reports.ts`:
  - fetches WB `reportDetailByPeriod` by date range for one/all tenants,
  - upserts existing `rrd_id` rows and backfills payout-detail fields (`ppvz_for_pay`, `deduction`, `additional_payment`, `acquiring_fee`, `return_amount`).
- executed server backfill on `goal_bot:/srv/projects/enterprise-wb-analytics`:
  - Berbeka (`2026-03-01..2026-03-31`): `fetched=4091` (then full window run `2026-03-01..2026-04-13` -> `fetched=4750`);
  - Lavrov (`2026-03-01..2026-04-13`): `fetched=38006`.
- verified payout-field recovery for Berbeka March after server backfill:
  - rows=`4143`, detail_rows=`819`,
  - `ppvz_for_pay=576 954.34`, `deduction=60 225.00`, `acquiring_fee=20 212.03`, `return_amount=240.00`.
- adjusted `getDashboardDataTrust(...)` severity model:
  - kept truly blocking checks as `critical` (no finance, empty payout, missing exact funnel, catalog gaps),
  - moved contour-mismatch checks (`ads cross-check`, `orders/buyouts alignment`) to diagnostic warnings,
  - diagnostic warnings now reduce score less and do not create `critical` status.
- server trust status after deploy/restart:
  - Бербека March: `ok`, score `91`;
  - Бербека active period: `ok`, score `91`;
  - Лавров March: initially `warning` (`adsSource=ad_clusters`), then after targeted ads backfill became `ok`, score `91`;
  - Лавров active period: `ok`, score `91`.
- added targeted ads backfill script `scripts/backfill_ads_costs.ts` and executed for Lavrov March:
  - range `2026-03-01..2026-03-31`,
  - `raw_api_ad_costs` rows loaded: `1045`,
  - amount loaded: `163 777.84`,
  - trust source switched to `adsSource=ad_costs`.

### Unit Economics UI: Strict Grid + Excel Export

- `UnitEconomicsTemplateTable` switched to strict cell grid rendering:
  - every `th/td` now has visible cell borders (`border-r/border-b`, including first column border),
  - group separators are still emphasized with thick split lines.
- added quick propagation button `В цвета модели (N)`:
  - applies current SKU manual settings to detected sibling color variants,
  - copies full local manual block (cost draft, logistics/storage inputs, scenarios, taxes, marketing fields),
  - uses model-family matcher by seller article stem (color suffix aware) + brand/category/dimensions.
- fixed warehouse tariff matcher for ambiguous city labels (e.g. `Екатеринбург`):
  - no longer picks first fuzzy match blindly,
  - now ranks candidates by usable WB coefficients/base values and chooses the best fit,
  - prevents zero-forward/storage tariffs caused by selecting `boxType` rows with empty coefficients.
- recalculation hardening for template economics:
  - added trade scheme selector in SKU panel (`FBW/FBS`, default `FBW`) to select correct WB commission source;
  - commission rates now load both WB fields (`kgvpSupplier` for `FBW`, `kgvpMarketplace` for `FBS`, with fallback when one source is missing);
  - fixed commission mapping according to live WB response for tenant categories (e.g. `Расчески: FBW=32.5, FBS=36`);
  - `ИТОГО МП + хранение` now includes acquiring (single subtraction, no double subtraction in payout);
  - tax in rubles now uses `ИТОГО к оплате на р/с` base (both per-unit and batch);
  - `Наценка от цены до СПП` switched from percent to ratio (`price_before_wb_discount / full_cost`, e.g. `3.46x`);
  - `Маржинальность` now equals `profit_rub / price_before_wb_discount`;
  - batch section `Комиссия МП %` column switched to ruble value for party;
  - added batch column `Логистика МП до СПП %` and moved it between `Эквайринг` and `Процент МП общий`;
  - added batch `Налог в рублях (партия)` column;
  - `CPO план` and `CPS план` switched to automatic calculation from marketing + buyout plan (not manual input).
- added `Экспорт Excel` button in unit-economics header:
  - generates real `.xlsx` workbook (SheetJS),
  - sheet `Юнитка_данные`: full current table data by all visible columns,
  - sheet `Колонки_для_правок`: editable list of current column names,
  - sheet `Формулы_для_правок`: current formula/logic hints per column for roundtrip edits.
- added dependency: `xlsx`.

### Net Profit Fix: Service Rows No Longer Inflate COGS

- production audit for tenant `ИП Лавров` found that `raw_api_realization_reports` contains service rows with `quantity > 0` but zero sales money (`retail_amount=0`, `ppvz_for_pay=0`), mainly logistics/withholdings.
- legacy formulas multiplied COGS by `quantity` for all realization rows, which overcounted себестоимость and pushed dashboard net profit into false deep negative.
- fixed in `src/server/analytics/engine.ts` for all FACT calculation paths:
  - `getDailyPnL`
  - `getKpis`
  - `getUnitEconomics`
  - `getNetProfitBreakdown`
  - `getGroupDynamics`
- new COGS guard: cost is applied only for товарные realization rows where `retail_amount != 0 OR ppvz_for_pay != 0`.
- `sync-finances` mapping updated with the same WB alias fallback logic as `sync-wb` to prevent future zeroed/misaligned finance fields on newly inserted realization rows.

### WB Realization Sync: Field Alias Recovery + Re-Sync

- root-cause audit of `Чистая прибыль` mismatch on `ИП Лавров` (`14.03.2026–13.04.2026`) showed:
  - stale finance snapshot before re-sync (`raw_api_realization_reports.max(date_from)=2026-03-30`, later `2026-04-06` after refresh);
  - zeroed financial components caused by WB payload key mismatch (new WB keys vs legacy `*_rub` aliases).
- extended WB realization schema parsing (`src/types/wb.ts`) with current payload aliases:
  - `ppvz_sales_commission`, `rebill_logistic_cost`
  - `storage_fee`, `penalty`, `payment_schedule`
- updated realization ingestion mapping (`src/inngest/sync-wb.ts`) to fallback safely:
  - `commission_amount` ← `commission_amount` or `ppvz_sales_commission`
  - `delivery_rub` ← `delivery_rub + rebill_logistic_cost`
  - `storage_fee_rub` ← `storage_fee_rub` or `storage_fee`
  - `penalty_rub` ← `penalty_rub` or `penalty`
  - `payment_schedule_rub` ← `payment_schedule_rub` or `payment_schedule`
- executed targeted server backfill (`requestedSources=["realization_reports"]`) to rewrite existing `rrd_id` rows with corrected aliases.

### WB Unit Economics Spec + Formula Audit

- added canonical spec/audit document `docs/WB_UNIT_ECONOMICS_SPEC_2026-04-13.md` with:
  - WB-oriented formula contour for clean profit, buyout, logistics, storage, settlement payout
  - per-column formula mapping for `/economics-template`
  - explicit code-level compliance audit (`what matches` vs `where approximations/divergence exist`)
- documented critical current risks for follow-up implementation:
  - potential double-counting of storage in server analytics paths
  - provisional fallback coefficients (`0.75`, `15%`, `50₽`) in unreconciled tail
  - buyout percentage logic (`buyouts/orders`) diverging from strict financial definition
  - missing payout-detail fields in `raw_api_realization_reports` for exact `Итого к оплате`

### WB Finance Contour Hardening (FACT vs PLAN)

- expanded `raw_api_realization_reports` schema and sync payload with payout-detail fields from `reportDetailByPeriod`:
  - `ppvz_for_pay`
  - `deduction`
  - `additional_payment`
  - `acquiring_fee`
  - `return_amount`
- added migration `drizzle/0021_even_lionheart.sql` for the new payout columns
- removed double-storage subtraction in server-side profit formulas:
  - daily PnL tax base no longer subtracts `paid_storage` on top of realization storage
  - unit economics tax base no longer subtracts `storage_stats` in addition to realization storage
  - KPI tax base no longer subtracts `storage_total` on top of realization storage
  - group dynamics `profitBeforeTax` no longer subtracts both realization storage and `storageCost` simultaneously
- introduced explicit unit-economics calculation modes:
  - `FACT_WB` (default strict mode)
  - `PLAN_TEMPLATE` (scenario mode with provisional tail)
- wired mode selection in APIs:
  - `/api/views/economics` -> `FACT_WB`
  - `/api/views/economics-template` -> `PLAN_TEMPLATE`
  - `/api/views/dashboard` unit-economics feed -> `FACT_WB`
- added mode visibility on `/economics-template` header (`Режим расчёта: ...`) and in API payload (`calculationMode`)

### FACT_WB Trust Hardening (Dashboard + Dynamics + Profit Report)

- dashboard financial endpoints now call analytics in strict `FACT_WB` mode:
  - `/api/views/dashboard` -> `getKpis(..., { calculationMode: 'FACT_WB' })`
  - `/api/views/dashboard` -> `getDailyPnL(..., { calculationMode: 'FACT_WB' })`
- dynamics endpoint now runs in strict `FACT_WB` mode:
  - `/api/views/dynamics` -> `getGroupDynamics(..., { calculationMode: 'FACT_WB' })`
- profit report endpoint now runs in strict `FACT_WB` mode:
  - `/api/views/profit-report` -> `getNetProfitBreakdown(..., { calculationMode: 'FACT_WB' })`
- analytics engine methods `getDailyPnL`, `getKpis`, `getNetProfitBreakdown`, `getGroupDynamics` now support `calculationMode` and include provisional sales tail only in `PLAN_TEMPLATE`
- fixed group dynamics semantic mismatch:
  - `opProfit` is no longer overwritten by `netProfit`
  - group/sku aggregates keep separate financial base fields (`financeRevenue`, `financeSoldQty`)
  - derived profitability metrics in dynamics UI now use financial base (with RAW fallback), while RAW metrics remain explicitly labeled
- synchronized profit-report formula text with server implementation:
  - storage shown as informational column, but not subtracted twice (already included in `прочих удержаниях` from realization detail)
- synced spec documentation to current state in `docs/WB_UNIT_ECONOMICS_SPEC_2026-04-13.md` (FACT vs PLAN boundaries and residual caveats)

## 2026-04-12

### Direct Domain Ingress Cutover (No Cloudflare)

- decommissioned `enterprise-wb-analytics-cloudflared.service` and `enterprise-wb-analytics-supabase-cloudflared.service` on `goal_bot` (`disabled` + `stopped`)
- installed and enabled nginx `stream` routing on `:443` to share one public port between:
  - project web domains -> local nginx TLS backend (`127.0.0.1:8443`)
  - non-project TLS/SNI -> `vpn-xray` backend (`127.0.0.1:9443`)
- moved `vpn-xray` inbound from public `:443` to local `127.0.0.1:9443` so nginx owns external `:443` without breaking VPN transport
- configured direct nginx reverse proxy for project domains (`про-цифры.рф`, `процифры.рф`) to app runtime `127.0.0.1:3457`
- documented new direct-ingress runbook and operational commands in `docs/SERVER_DEPLOYMENT_GOAL_BOT.md`
- pending for full browser-green TLS: point registrar DNS `A/AAAA` to server IP and issue Let's Encrypt cert for both domains

### Overview KPI Expansion: Buyout %, Storage, Localization, Stocks, SPP

- expanded dashboard KPI payload in `AnalyticsEngine.getKpis(...)` with new metrics for:
  - `buyoutRate` (`выкупы / заказы`, percentage)
  - `storage` + `storageShare` (storage rubles and share of revenue)
  - `stocks` + in-way counters (WB stock snapshot totals)
  - `localization` (current local-share percentage from redistribution runs, with period fallback)
  - `spp` (effective WB discount percentage from realizations, day-specific when one day is selected, weighted average on period ranges)
- updated `KPICards` on `/overview`:
  - buyouts card now shows `шт. + % выкупа` (similar to ads card showing spend + ДРР)
  - added dedicated cards for `Хранение`, `% Локализации`, `Остатки WB`, and `SPP WB`
  - SPP card title now reflects selected range mode: `день` vs `сред.`
- adjusted KPI grid responsiveness to keep the expanded card set readable on desktop (`xl`/`2xl` layouts)

### WB Tax Modes Cleanup

- settings UI now exposes only WB-relevant tax regimes: `УСН доходы`, `УСН доходы-расходы`, `АУСН доходы`, `АУСН доходы-расходы`, `ОСНО ИП`, `ОСНО организация`
- backend keeps compatibility handling for legacy DB tax values (`НПД`, `ЕСХН`, `ПСН`) so historical data remains readable
- tenant settings normalization switched to WB-only tax type normalization path (`normalizeWbTaxType`)
- docs synchronized: `PROJECT_GUIDE` now separates UI-available WB modes from backend compatibility modes
- server/local workflow contract documented: `goal_bot:/srv/projects/enterprise-wb-analytics` is the baseline snapshot, all tasks run `local -> deploy -> parity-check` with mandatory `rsync --dry-run` verification
- `AGENTS.md` updated with required baseline sync + deploy + post-deploy parity flow so new agent sessions follow the same process by default
- deployment contour upgraded to git-first: server directory `/srv/projects/enterprise-wb-analytics` initialized as a git repo tracking `origin/main`, and runbook switched to `main push -> server git pull --ff-only -> rebuild/restart -> SHA parity check`

## 2026-04-10

### Unit Economics Navigation And Cost Source Alignment

- sidebar navigation now keeps only one item `Юнит-экономика`; the old duplicate `Юнит-экономика NEW` entry was removed
- `/economics` is now a redirect to `/economics-template`, so operators always land on the active unit-economics screen
- `economics-template` header was renamed from template wording to production wording (`Юнит-Экономика`) to match the main flow
- cost input persistence from `UnitEconomicsTemplateTable` is now explicitly date-bound via `Себестоимость с ...` and writes into `unit_economics_configs` through `updateCostPrice(...)`
- `updateCostPrice(...)` now normalizes date-only values to UTC day start and revalidates `/economics-template` and `/overview` after save
- unit-economics APIs now request a recent-activity filter (`90` days) so SKU without movement for ~3 months are excluded from `Юнит-экономика` and `Юнит-экономика (template)` tables

### Stocks Tab (Остатки) And Shipment Planning

- added a new sidebar screen `Остатки` at `/stocks` with a planning-first layout
- added DB table `stock_planning_inputs` (migration `drizzle/0017_dapper_mikhail_rasputin.sql`) for per-SKU operator inputs:
  - `own_stock`
  - `in_transit_china`
  - `in_transit_eta_days`
- added backend planner `getStocksPlanner(...)` in `src/server/analytics/stocks.ts`:
  - combines WB stock snapshot + operator stock inputs + demand window
  - computes WB/total coverage days, shortages, and `ship now` vs `reserve from transit`
  - uses localization matrix (`raw_api_stock_sizes`) to build region-level placement recommendations
- added API route `GET /api/views/stocks` and server action `upsertStockPlanningInput(...)`
- stocks UI now supports:
  - editable own stock / in-transit / ETA per SKU
  - planning horizon controls
  - localization visibility by region
  - recommended placement by region/warehouse
  - CSV export for shipment assembly

### Bulk Cost Date Apply And Stocks UX Split

- in `UnitEconomicsTemplateTable`, replaced per-row date apply CTA with a mass action: `Применить дату к изменённым SKU (N)`
- mass date apply now writes selected `effective_from` for every SKU where draft себестоимость differs from persisted cost in текущем наборе строк
- `Остатки` UI is split into 2 practical tabs:
  - `План отгрузки` (editable own/in-transit/ETA + placement recommendations)
  - `Остатки по складам` (warehouse matrix per SKU)
- SKU visuals are now explicit in both tabs via photo + brand + nmId/vendorCode card
- planner payload now includes `photoUrl` and full `warehouseStocks` breakdown per SKU (not only compact localization block)

### Unit Economics Search, Seller Article, And SKU Exclude

- `UnitEconomicsTemplateTable` now includes `Артикул продавца` as a dedicated visible column (`vendorCode`) next to `Артикул WB`
- SKU dropdown details now include quick product meta: `Бренд`, `Артикул WB`, `Баркод`
- `getUnitEconomics(...)` now returns `barcode` from `products.barcode` for template rendering
- barcode enrichment now also falls back to WB product-card payload parsing (`cards`, `sizes`, `skus`, characteristics with `штрихкод/ШК`) when local `products.barcode` is empty
- compacted SKU meta block in expanded view (narrower width + tighter paddings) to avoid oversized row detail surface
- hide action in table rows switched back to icon-only `EyeOff` and moved before product photo
- removed separate wide `В расчёт` column to reduce column gaps and restore denser layout
- seller article cell now supports two-line wrap for long values
- unit-economics table spacing was rebalanced globally:
  - tighter column min-width on visible leading columns
  - unified header/body paddings (`th`/`td`) for consistent density
  - slightly larger text for table headers, row values, and top controls
- dashboard shell became wider for readability:
  - removed strict `max-w-7xl` content cap
  - reduced side paddings in layout/header
  - added collapsible sidebar mode (icons-only) with persistent state in local storage
- added top search bar for unit-economics table with lookup by:
  - `Артикул WB`
  - `Артикул продавца`
  - `Категория`
- added top filter switcher for practical operator slicing:
  - `все SKU`
  - `только с продажами`
  - `только с себестоимостью`
  - `только без себестоимости`
- added per-SKU action `Скрыть` in table rows, which:
  - marks SKU hidden via `toggleProductVisibility(...)`
  - removes it from the current table immediately
  - excludes it from subsequent analytics runs through existing hidden-product logic
- updated `toggleProductVisibility(...)` revalidation to include `/economics-template` (in addition to `/economics`)

### Verification

- `eslint` passed for all changed files in navigation/economics/stocks scope
- full `tsc --noEmit` still fails on pre-existing unrelated files under `tmp/` and one test file (`src/lib/signal-queue-utils.test.ts`)

## 2026-04-09

### Dashboard Ads Fallback And Buyouts KPI

- added a new top-level KPI card `Выкупы (шт.)` in `src/components/dashboard/KPICards.tsx`, including trend delta and dedicated icon/color
- extended `AnalyticsEngine.getKpis(...)` to expose `buyouts` in the API payload and KPI delta calculation
- hardened ad-spend aggregation for dashboard analytics: when `raw_api_ad_costs` has no data for the period, KPI/analytics SQL now falls back to `raw_api_ad_clusters` instead of returning forced zero
- applied the same ad fallback strategy to `getDailyPnL(...)`, `getUnitEconomics(...)`, and dynamics aggregation query path, so dashboard/economics/dynamics stay consistent on periods where WB `ads` source is partially unavailable
- fixed `buyouts = 0` on open day ranges (`01.03 → 10.04` with coverage up to `09.04`): KPI funnel fallback now uses the latest available WB period snapshot with `period_end <= selected_to` instead of requiring an exact `period_end == selected_to`
- kept conversion/`exact_funnel` status strict for incomplete coverage (conversion stays `н/д` until full requested range is covered), while buyouts no longer collapse to zero on partial-day sync windows
- increased WB sync source timeout defaults for advertising paths (`ads` and `ad_clusters`) via env-aware runtime knobs (`WB_ADS_SOURCE_TIMEOUT_MS`, `WB_AD_CLUSTERS_SOURCE_TIMEOUT_MS`) to reduce repeated `ads exceeded 360000ms` skips

### Verification

- local DB check for tenant `ИП Бербека` confirmed ad rows exist in both sources for `2026-03-01..2026-04-09` (`raw_api_ad_costs` and `raw_api_ad_clusters`)
- `npx eslint src/components/dashboard/KPICards.tsx src/server/analytics/engine.ts` passed after KPI and ads-fallback updates
- `npm run build` currently fails on pre-existing unrelated file `tmp/direct-run-stock-sync.ts` (`syncWildberriesData.fn` private access), outside the changed dashboard files
- server DB check (`goal_bot`) confirmed root cause of ad mismatch: `raw_api_ad_costs` has `0` rows while `raw_api_ad_clusters` has `46,429.51`, and latest full-period funnel snapshot for start `2026-03-01` ends at `2026-04-09` (`buyout_count = 541`)

### Login Password Reset Flow

- added `forgot password` mode on `/login` with a dedicated email-only form and explicit `Забыли пароль?` entry point
- added server action `requestPasswordReset(...)` in `src/app/(auth)/login/actions.ts`, wired to `supabase.auth.resetPasswordForEmail(...)` with redirect to `/reset-password`
- added new route `src/app/(auth)/reset-password/page.tsx` that handles Supabase recovery links, validates recovery context, and allows setting a new password
- updated auth middleware so `/reset-password` is not force-redirected to `/overview` when a temporary recovery session is present
- extended `/reset-password` recovery bootstrap to explicitly process `?code=...` PKCE redirects via `supabase.auth.exchangeCodeForSession(...)`, not only hash/token-hash cases

### Goal Bot Server Deployment Baseline

- created a full pre-deploy safety backup from the local workspace at `/Users/vitea_b/Desktop/Боты/РНП_Gemini/backups/enterprise-wb-analytics-20260409-205527` (`git bundle`, full tar archive, working-tree snapshots, checksum validation)
- deployed the app into isolated server directory `/srv/projects/enterprise-wb-analytics` on `ssh goal_bot` without modifying other project folders under `/srv/projects`
- created isolated Postgres runtime assets for this app: dedicated DB/user pair and server env files (`.env.production`, `.env`, `.env.runtime`)
- ran server build and schema migration (`npm run build`, `npm run db:migrate`) inside the isolated deployment directory
- created and enabled dedicated `systemd` units: `enterprise-wb-analytics.service`, `enterprise-wb-analytics-inngest.service`, `enterprise-wb-analytics-cloudflared.service`
- exposed external access via a separate Cloudflare quick tunnel (server-local app port `3457` is not publicly reachable directly on this host)
- documented full operational runbook, update procedure, service map, and post-deploy checks in [docs/SERVER_DEPLOYMENT_GOAL_BOT.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/SERVER_DEPLOYMENT_GOAL_BOT.md)

### Goal Bot Self-Hosted Supabase Stabilization

- installed Docker runtime on `goal_bot` and launched a reduced self-hosted Supabase profile (`auth + kong + db + mailpit`) for the deployed app
- added `4G` swap on server to prevent Supabase startup OOM (`exit 137`) during schema initialization
- created and enabled `enterprise-wb-analytics-supabase.service` with persistent behavior (`ExecStop=/bin/true`) so service restarts no longer wipe auth users
- added dedicated public quick tunnels for Supabase API and Mailpit inbox (`enterprise-wb-analytics-supabase-cloudflared.service`, `enterprise-wb-analytics-mailpit-cloudflared.service`)
- switched server runtime `NEXT_PUBLIC_SUPABASE_URL` to the externally reachable Supabase tunnel so browser-side auth recovery flows are reachable outside the server host
- introduced split Supabase URL handling in server code (`SUPABASE_URL_INTERNAL` fallback) so server actions/middleware stay on private `127.0.0.1:54321` while browser-side flows use public Supabase endpoint
- switched Supabase config to env-driven auth redirects (`site_url = env(APP_BASE_URL)`, `additional_redirect_urls` includes `env(APP_RESET_URL)`) and aligned server env contract with `APP_RESET_URL`
- updated deployment runbook rsync excludes to protect server `.env.production` and `.env.runtime` from accidental deletion
- verified live auth paths through deployed server actions: `signup`, `login`, and `forgot password` now return successful `303` redirects instead of `fetch failed`/`ECONNREFUSED`

### Verification

- `git bundle verify` and `shasum -a 256 -c checksums.sha256` passed for the pre-deploy backup artifacts
- server-local health check passed: `curl http://127.0.0.1:3457/api/health` returned `200` with `{ ok: true, checks.app/db/env: "ok" }`
- external health check via quick tunnel passed: `curl https://exercises-elevation-kerry-containing.trycloudflare.com/api/health` returned `200` with `{ ok: true }`
- external login route is reachable: `GET https://exercises-elevation-kerry-containing.trycloudflare.com/login` returned `200`

### WB Snapshot Retention Fallback And Timeout Hardening (In Progress)

- added recoverable snapshot fallback in `sync-wb` for `paid_storage`, `ads`, and `ad_clusters`: when WB/network failures are transient (`timeout`, transport errors, `408/425/429/5xx`) and prior rows exist for the selected period, the source now returns `skipped` with `reason: retained_previous_snapshot` instead of turning the run into a hard source failure
- snapshot fallback now also covers the `ad_clusters` path where all batches fail in one run, preserving the previous period snapshot when possible instead of reporting only a fatal batch error
- added one-run ad campaign cache in sync runtime and passed preloaded campaigns into `wbApi.getAdSpend(...)`, reducing duplicate campaign-detail calls between `ads` and `ad_clusters`
- tightened WB API transport defaults for unstable contours: advertising calls now use explicit `60s` timeout, paid-storage report download now uses `120s` timeout, and ad campaign detail expansion now uses smaller chunks (`20`)
- updated settings sync source badge copy so retained-snapshot fallback is visible to operators as `Сохранён прошлый снимок`, not a generic skip state

### Verification

- `npx eslint src/lib/wb-api/index.ts src/inngest/sync-wb.ts src/app/(dashboard)/settings/SyncButton.tsx` passed after the snapshot-retention and timeout-hardening changes
- `npm run test -- src/lib/wb-api/index.test.ts src/lib/wb-sync-utils.test.ts` passed after the snapshot-retention and timeout-hardening changes (`2` files, `15` tests)

## 2026-04-05

### March Bundle Reconciliation And Stock Source Repair

- added `scripts/reconcile_wb_bundle.py` so the local repo can compare the March WB export bundle against app period facts instead of relying on ad hoc spreadsheet inspection
- confirmed on the March bundle that period funnel facts are already effectively aligned with WB export totals, while the largest live gap was the stock contour coming from the wrong WB fallback source
- updated `wbApi.getStocks(...)` to fall back from forbidden `analytics/v1/stocks-report/wb-warehouses` to the working `api/v2/stocks-report/products/products` endpoint for base tokens before touching the legacy supplier stocks path
- updated `sync-wb` stock ingestion to clear the tenant stock snapshot before reinserting the current WB result, removing stale rows that survived previous syncs and distorted current stock/in-way totals
- direct local verification against the tenant token now yields `7045` current stock, `60` items in way to client, and `51` items in way from client, which matches the downloaded WB stock reports materially better than the old legacy fallback
- restarted the local `dev:runtime` on the patched worker code so new manual syncs and UI refreshes hit the repaired stock path instead of the stale runtime

### Verification

- `npx vitest run src/lib/wb-api/index.test.ts` passed after the stock-source fallback change
- `npx eslint src/lib/wb-api/index.ts src/lib/wb-api/index.test.ts src/inngest/sync-wb.ts` passed after the stock-source and stale-row cleanup changes

### Dashboard Freshness And Dynamics Group Builder

- fixed the freshness banner so `selected period` versus `sync coverage` is compared on calendar-day granularity, removing the false `period wider than usable sync` warning when the sync already covers the same day
- added a dedicated product-options API for group assembly and rewired `DynamicsTable` to use the synced product catalog instead of the economics table response shape
- empty groups are now actionable: the group card still renders the add-products flow even when there are no rows yet, instead of trapping the operator in a dead-end empty state
- overview now renders conversion as `н/д` when the chosen period has no funnel rows at all, which is more honest than a fake `0.0%`

### Verification

- `npm run test -- src/lib/wb-api/index.test.ts src/lib/wb-sync-utils.test.ts` passed after the dashboard/dynamics fixes
- `npm run build` passed after the dashboard/dynamics fixes

### WB Advertising Rate Limits And Paid Storage Dedupe

- aligned `wbApi.getAdSpend(...)` with the documented WB promotion limit for `GET /adv/v3/fullstats` by pacing sequential requests to one request every `20` seconds instead of relying only on retry backoff after `429`
- deduplicated paid-storage rows before `raw_api_paid_storage` upsert, so repeated `(tenant_id, nm_id, warehouse_name, date)` rows from one WB report no longer poison the whole sync run with a local insert error
- added regression coverage for the `20`-second fullstats pacing and for paid-storage dedupe semantics

### Verification

- `npm run test -- src/lib/wb-api/index.test.ts src/lib/wb-sync-utils.test.ts` passed after the advertising pacing and paid-storage dedupe changes

### WB Advertising Window Limits

- aligned the advertising sync path with the current WB promotion limits by splitting `GET /adv/v3/fullstats` requests into `31`-day windows instead of sending one long manual-sync range
- aligned `POST /adv/v1/normquery/stats` with the actual WB runtime limit by splitting long cluster-stat ranges into shorter windows, removing the live `date range must not exceed 30 days` failures during ad-cluster sync
- added regression tests covering both long-range splits, so future advertising refactors keep honoring the WB range contract

### Verification

- `npm run test -- src/lib/wb-api/index.test.ts` passed after the advertising window-limit changes
- `npm run build` passed after the advertising window-limit changes

### WB Live Sync Stabilization And Progress UX

- manual sync now writes source-level progress into `sync_runs.summary`, so `settings` can show a live percentage, completed-source counter, and the current WB source instead of a static `Выполняется`
- `wbApi.getAdSpend(...)` now treats `adv/v3/fullstats` responses that return `200 null` as an empty ad-spend slice instead of crashing with `response is not iterable`
- paid-storage sync now spaces report downloads and retries `429` download responses explicitly, reducing the long-range `getPaidStorageDownload` failures that still left sync in `completed_with_errors`
- ad-cluster sync now deduplicates rows inside a single insert batch before `onConflictDoUpdate`, removing the hidden duplicate-row failure that did not always surface as a top-level red source
- added a regression test for the live `fullstats -> null` advertising response shape and restarted the local `dev:runtime` so the fresh worker code is actually serving requests

### Verification

- `npm run lint` passed after the live-sync stabilization changes; the only remaining warning is the pre-existing `coverage/block-navigation.js` unused-disable notice
- `npm run test -- src/lib/wb-api/index.test.ts` passed after the live-sync stabilization changes
- `npm run build` passed after the live-sync stabilization changes
- `SMOKE_EXPECT_INNGEST_RUNTIME=1 npm run smoke:operator` passed against the restarted local `dev:runtime`

### WB Sync Runtime Reconciliation

- replaced the obsolete funnel endpoint `POST https://seller-analytics-api.wildberries.ru/nm-reports/v1/nm-report/detail` with the current Analytics v3 contour `POST /api/analytics/v3/sales-funnel/products`, including pagination and selected-period metric mapping
- fixed the funnel write path so `raw_api_funnel_stats.order_count` now comes from the real WB `orderCount` metric instead of incorrectly reusing `buyoutCount`
- replaced the removed paid-storage endpoint `GET /api/v1/analytics/paid-storage` with the documented task-based flow `GET /api/v1/paid_storage -> /tasks/{id}/status -> /tasks/{id}/download`
- split paid-storage requests into compliant day windows and mapped the downloaded report rows back into the existing `raw_api_paid_storage` shape
- deduplicated WB stock snapshot rows by `(nmId, warehouseName)` before DB upsert, removing the duplicate-key runtime failure that surfaced as a partial-sync source error
- restarted the local `dev:runtime` after the reconciliation so `sync-wb` now runs under the fresh worker code instead of the stale Inngest process from the earlier session
- removed the temporary smoke tenant created during verification, leaving only the real local cabinet in the DB

### Verification

- direct live checks with the locally saved WB token returned `200` for the current advertising promotion contour, advertising details, `adv/v3/fullstats`, Analytics v3 sales funnel, paid-storage task creation, and stocks
- `npm run test -- src/lib/wb-api/index.test.ts` passed after the funnel and paid-storage reconciliation
- `npm run test` passed after the sync-runtime reconciliation
- `npm run build` passed after the sync-runtime reconciliation
- `SMOKE_EXPECT_INNGEST_RUNTIME=1 npm run smoke:operator` passed against the restarted local `dev:runtime`

### Advertising API Reconciliation

- switched advertising preflight from the obsolete `GET https://advert-api.wildberries.ru/adv/v1/count` check to the current promotion contour `GET /adv/v1/promotion/count` plus `GET /api/advert/v2/adverts`
- `wbApi.getAdCampaigns(...)` now resolves real campaign details, including payment model, placements, and `nmId` bindings, instead of treating the old count payload as a full campaign list
- `wbApi.getAdSpend(...)` now reads campaign statistics through `GET /adv/v3/fullstats` and flattens them into `nmId + date` spend rows, replacing the obsolete `GET /adv/v2/full/stat` path that returned `404`
- ad-cluster sync now uses `POST /adv/v1/normquery/stats` with real `advertId + nmId` pairs and stores cluster rows under the actual WB article instead of incorrectly writing `advertId` into `raw_api_ad_clusters.nm_id`
- added `src/lib/wb-api/index.test.ts` so the new advertising endpoint mapping and normquery flattening are covered by unit tests

### Verification

- `npm run lint` passed after the advertising API reconciliation; the only remaining warning is the pre-existing `coverage/block-navigation.js` unused-disable notice
- `npm run test` passed after the advertising API reconciliation
- `npm run build` passed after the advertising API reconciliation
- `SMOKE_EXPECT_INNGEST_RUNTIME=1 npm run smoke:operator` passed against the local `dev:runtime` after the advertising API reconciliation

## 2026-04-04

### Production Contour, CI, And Pilot Baseline

- added `/api/health` plus `scripts/healthcheck.mjs`, so production hosts can verify app boot, DB connectivity, and required env presence through one committed endpoint
- added `.env.example`, `Dockerfile`, and `render.yaml`, giving the repo a concrete production boot path instead of relying only on local runtime scripts
- enabled `next build` standalone output and expanded `package.json` with `test`, `test:watch`, `test:coverage`, and `db:migrate`
- added `vitest` plus unit coverage for signal notification helpers and queue workload/rebalance logic
- added `.github/workflows/ci.yml`, so branch pushes and PRs now run lint, unit tests, and production build automatically
- added `docs/PRODUCTION_DEPLOYMENT.md` and `docs/PILOT_OPERATIONS.md`, documenting the recommended deployment topology, environment contract, roles, queues, KPI layer, and pilot cadence
- release baseline now includes `npm run test`, and the release checklist explicitly treats `/api/health` as the production readiness probe

### Verification

- `npm run lint` passed after the production contour and test-baseline changes
- `npm run test` passed after the production contour and test-baseline changes
- `npm run build` passed after the production contour and test-baseline changes
- `npm run test:coverage` passed after the production contour and test-baseline changes
- `npm run smoke:operator:runtime` passed after the production contour and test-baseline changes

### Owner Defaults And Queue Balancing

- `AnalyticsEngine.setSignalSavedViewDefault(...)` now scopes shared default resets to the matching queue-owner bucket, so a tenant can keep one global `team default` plus separate `owner default` presets without adding a new table or migration
- `SignalsFeed` now distinguishes `My default`, `Team default`, and `Owner default` in shared view chips/cards and applies owner-specific defaults when the operator opens a matching owner lane
- owner workload cards now expose direct `Selected to owner` and `Balance N` actions backed by the existing bulk handoff workflow, including explicit audit notes for manual handoff and workload rebalance operations
- `SignalQueueOwnerSummaryStrip` now shows owner-vs-team default semantics instead of collapsing every shared default into one generic label

### Verification

- `npm run lint` passed after the owner-default and queue-balancing changes
- `npm run build` passed after the owner-default and queue-balancing changes
- `npm run smoke:operator:runtime` passed after the owner-default and queue-balancing changes

### Automation Run Drill-Down

- added `SignalAutomationRunDetail` and `AnalyticsEngine.getSignalAutomationRunDetails(...)`, so automation runs can be resolved into the concrete SLA note events and current signal state behind each run
- added `GET /api/views/dashboard/signals/automation-runs/[runId]`, giving `overview` a tenant-guarded detail endpoint for run inspection
- the automation run cards in `overview` now expand inline to show the affected signals, current workflow/SLA chips, preset id, note body, and a direct action to reopen the signal drawer

### Verification

- `npm run lint` passed after the automation run drill-down changes
- `npm run build` passed after the automation run drill-down changes
- `npm run smoke:operator:runtime` passed after the automation run drill-down changes

### Shared Queue Ownership And SLA Run Audit

- added `drizzle/0011_hesitant_rictor.sql`, extending `signal_saved_views` with `shared_owner_user_id/shared_owner_email` and adding the new `signal_automation_runs` table for server-side SLA automation audit history
- `AnalyticsEngine.runSignalSlaAutomation(...)` now persists run records with trigger/source/view context, writes `automationRunId` into signal timeline note payloads, and updates each run with applied/skipped/failure status after execution
- `overview` now lets managers set an explicit queue owner on team saved views, shows that owner on shared/pinned presets, renders the latest automation runs with outcome counts, and surfaces the latest escalation outcome on active signal cards
- `db:repair-local` now repairs and records migration `0011_hesitant_rictor`, advancing the local baseline to 24 public tables / 12 recorded migrations

### Verification

- `npm run lint` passed after the shared queue ownership and SLA audit changes
- `npm run build` passed after the shared queue ownership and SLA audit changes
- `npm run db:repair-local` passed after the shared queue ownership and SLA audit changes and upgraded the local DB to 24 public tables / 12 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate`
- `npm run smoke:operator:runtime` passed after the shared queue ownership and SLA audit changes

### Scheduled SLA Sweep Through Inngest

- added `src/server/jobs/signal-sla-sweep.ts` and registered `signalSlaSweepJob` in `src/server/jobs/index.ts`, so SLA automation now has a real scheduled Inngest/cron path instead of existing only behind the `overview` UI
- `AnalyticsEngine.runSignalSlaAutomation(...)` now accepts `automationSource`, `dryRun`, and dedupe-window options and returns `eligible` plus `skippedAlreadyEscalated` counts for clearer scheduled-run summaries
- scheduled sweeps now target only overdue signals and suppress repeated scheduled escalations within the dedupe window by inspecting recent SLA automation notes in `signal_operator_timeline`
- the scheduled path writes `automationSource: "scheduled"` into the shared timeline payload, which keeps audit semantics distinct from manual operator-triggered SLA automation

### Verification

- `npm run lint` passed after the scheduled SLA sweep changes
- `npm run build` passed after the scheduled SLA sweep changes
- `npm run db:repair-local` confirmed the local baseline at 23 public tables / 11 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate`
- `npm run smoke:operator:runtime` passed after the scheduled SLA sweep changes
- scheduled dry-run passed via `npx tsx --require dotenv/config --eval "(async () => { const imported = await import('./src/server/jobs/signal-sla-sweep.ts'); const mod = typeof imported.runScheduledSignalSlaSweep === 'function' ? imported : imported.default; const result = await mod.runScheduledSignalSlaSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"` and reported `39` scanned tenants with `3` eligible overdue signals in the current local dataset

### SLA Queue Presets, Automation, And Notifications

- added `SIGNAL_SLA_QUEUE_PRESETS`, so `overview` now exposes explicit `all overdue`, `blocked overdue`, and `handoff overdue` operator queues that can be opened or saved as views in one click
- added `runSignalSlaAutomationAction(...)` and `AnalyticsEngine.runSignalSlaAutomation(...)`, which group eligible overdue signals by escalation preset and apply the shared SLA handoff/note bundles server-side
- SLA automation notes now carry an explicit `automation: "sla"` marker in timeline payloads, so notification summaries and Telegram fan-out can identify them as SLA escalations rather than ordinary comments
- the header notification menu now highlights SLA-driven events with a dedicated badge/icon, making overdue escalation traffic visible without opening each signal

### Verification

- `npm run lint` passed after the SLA queue preset and automation changes
- `npm run build` passed after the SLA queue preset and automation changes
- `npm run smoke:operator:runtime` passed after the SLA queue preset and automation changes

### Team Default Fallback And Pin-First Saved Views

- `AnalyticsEngine` now treats team-scoped `is_default` as a tenant-wide fallback preset, while private defaults remain per-user; changing a saved view between private and team scope now clears the old default semantics instead of leaking them across scopes
- team saved-view naming is now validated by scope, so shared presets stop colliding with private presets that happen to use the same label
- `SignalsFeed` now falls back to the team default when the operator has no personal default and surfaces pinned saved views as a dedicated quick-access strip ahead of the longer `My views` and `Team views` lists
- shared/team cards now show explicit `Team default` semantics, while private cards keep separate `My default` controls so personal and tenant-wide presets are not conflated in the UI

### Verification

- `npm run lint` passed after the team-default fallback and pin-first saved-view changes
- `npm run build` passed after the team-default fallback and pin-first saved-view changes
- `npm run smoke:operator:runtime` passed after the team-default fallback and pin-first saved-view changes

### Shared Saved Views, Pinning, And Ordering

- added `drizzle/0010_silly_vance_astro.sql`, extending `signal_saved_views` with `scope`, `sort_preset`, `is_pinned`, and `position` plus a supporting scope-position index
- `AnalyticsEngine` now returns both private and team views with owner identity and capability flags, and only the owner or a tenant manager can edit shared presets while default selection stays user-specific
- overview server actions and `SignalsFeed` now support saving/editing views with scope + sort preset, split the UI into `My views` and `Team views`, and expose pin/unpin plus move up/down controls
- when an operator opens a read-only team view, the feed now falls back to `save as new view` instead of offering an invalid in-place update path
- `db:repair-local` now repairs and records migration `0010`, bringing the local baseline to 23 public tables / 11 recorded migrations

### SLA Queues, Sort Presets, And Escalation Actions

- added an `overdue_only` queue view plus saved sort presets (`severity`, `sla_pressure`, `newest`) so overview can reopen working queues by urgency, not only by raw filters
- extracted shared escalation presets into `src/lib/signal-workflow-config.ts` and queue/sort/escalation helpers into `src/lib/signal-queue-utils.ts`
- signal cards now expose one-click escalation actions and the signal drawer now shows the same action beside queue age and SLA state, keeping list and details workflows aligned
- `AnalyticsEngine.getSignalDetails(...)` now returns per-signal aging so the drawer can make the same escalation decision as the feed

### Verification

- `npm run lint` passed after the shared saved-view and SLA escalation changes
- `npm run build` passed after the shared saved-view and SLA escalation changes
- `npm run db:repair-local` passed after the shared saved-view and SLA escalation changes and upgraded the local DB to 23 public tables / 11 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate`
- `npm run smoke:operator:runtime` passed after the shared saved-view and SLA escalation changes

### Saved View Defaults And Overview SLA Summary

- added `drizzle/0009_daffy_peter_parker.sql`, extending `signal_saved_views` with `is_default` and a supporting index for per-user default presets
- `AnalyticsEngine` and overview server actions now support editing/renaming an existing saved view plus toggling its default state without recreating the preset
- `SignalsFeed` now lets operators rename the active saved view, mark any saved view as the default, and auto-applies the default preset when `overview` opens
- extracted queue matching into `src/lib/signal-queue-utils.ts` and added `SignalSlaSummaryStrip`, so the overview header now shows counts for overdue `blocked`, overdue `handoff`, and aging `needs action`
- `db:repair-local` now repairs and records migration `0009`, bringing the local baseline to 23 public tables / 10 recorded migrations

### Verification

- `npm run lint` passed after the saved-view default and overview SLA summary changes
- `npm run build` passed after the saved-view default and overview SLA summary changes
- `npm run db:repair-local` passed after the saved-view default and overview SLA summary changes and upgraded the local DB to 23 public tables / 10 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate`
- `npm run smoke:operator:runtime` passed after the saved-view default and overview SLA summary changes

### Saved Signal Views And SLA Aging

- added `signal_saved_views` via `drizzle/0008_mysterious_marrow.sql`, so queue presets now persist per operator and cabinet
- `GET /api/views/dashboard/signals` now returns both saved views and server-derived aging/SLA metadata per signal
- the signals feed now lets operators save/reapply/delete queue presets and shows `time in queue` plus SLA escalation chips for overdue handoff/blocked work

### Verification

- `npm run lint` passed after the saved-view and SLA aging changes
- `npm run build` passed after the saved-view and SLA aging changes
- `npm run db:repair-local` passed after the saved-view and SLA aging changes and upgraded the local DB to 23 public tables / 9 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate`
- `npm run smoke:operator:runtime` passed after the saved-view and SLA aging changes

### Signal Drawer Presets And Working Queues

- extracted shared signal note templates and handoff presets into `src/lib/signal-workflow-config.ts`, so drawer and bulk triage now use the same operator wording and workflow bundles
- added `applySignalHandoffPresetAction(...)` and wired `SignalDetailsPanel` with note template chips plus one-click handoff presets
- `overview` now exposes working-queue views for `needs action`, `blocked`, and `awaiting owner`, layered on top of existing assignee/workflow filters

### Verification

- `npm run lint` passed after the signal drawer preset and working-queue changes
- `npm run build` passed after the signal drawer preset and working-queue changes
- `npm run smoke:operator:runtime` passed after the signal drawer preset and working-queue changes

### Notification Preferences And Bulk Handoff Notes

- added `drizzle/0007_thin_shape.sql` so both `tenants` and `user_tenants` now persist signal notification preferences by channel and event type
- `settings` now separates tenant-wide Telegram event prefs from per-user in-app prefs for `note`, `assignment/reassignment`, and `blocked`
- `AnalyticsEngine` now filters in-app collaboration notifications through the current operator's prefs and suppresses Telegram fan-out when the corresponding tenant event type is disabled
- the signals feed now supports bulk shared notes, quick note templates, and one-click handoff presets that apply bundled assignee/workflow/note updates across the current visible selection
- `db:repair-local` now repairs and records migration `0007` so local workspaces can pick up the new preference columns without resetting the DB

### Verification

- `npm run lint` passed after the notification preference and bulk handoff note changes
- `npm run build` passed after the notification preference and bulk handoff note changes
- `npm run db:repair-local` passed after the notification preference and bulk handoff note changes and upgraded the local DB to 22 public tables / 8 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` generated `drizzle/0007_thin_shape.sql`
- `npm run smoke:operator:runtime` passed after the notification preference and bulk handoff note changes

### Notification Receipts And Bulk Signal Triage

- added `signal_notification_receipts` via `drizzle/0006_fearless_gambit.sql` so collaboration alerts now persist per-user `read` and `acknowledged` state
- the header notification center now auto-marks visible items as read on open and supports explicit acknowledgement per item or in bulk
- the signals feed now supports bulk triage over the visible selection: assign owner, update workflow state, resolve, and ignore
- `db:repair-local` now repairs and records migration `0006`, keeping existing local workspaces aligned with the new receipts table

### Verification

- `npm run lint` passed after the notification receipts and bulk triage changes
- `npm run build` passed after the notification receipts and bulk triage changes
- `npm run db:repair-local` passed after the notification receipts and bulk triage changes and upgraded the local DB to 22 public tables / 7 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate`
- `npm run smoke:operator:runtime` passed after the notification receipts and bulk triage changes

### Signal Workflow Filters And Collaboration Alerts

- the signals list now supports assignee and workflow-state filtering, and each signal card shows its current assignee plus workflow chip directly in the feed
- added `/api/views/dashboard/signal-notifications` plus a global header notification menu for recent collaboration events from other operators
- `AnalyticsEngine` now derives in-app notification items from `signal_operator_timeline` and dispatches Telegram collaboration alerts for new notes, reassignments, and blocked signals
- `BotService` now supports collaboration-event deep-links back into `/overview?signalId=...`, using optional `APP_BASE_URL` for public URLs

### Verification

- `npm run lint` passed after the signal workflow filters and collaboration alerts changes
- `npm run build` passed after the signal workflow filters and collaboration alerts changes
- `npm run smoke:operator:runtime` passed after the signal workflow filters and collaboration alerts changes

### Signal Collaboration Workflow

- extended the shared signal timeline into a real collaboration workflow with signal notes, assignee ownership, and workflow state tracking
- added migration `drizzle/0005_volatile_vin_gonzales.sql` to persist `risk_signals` workflow fields, richer `signal_operator_timeline` event metadata, and `users.email`
- local auth bootstrap, login, cabinet onboarding, and invite acceptance now persist the authenticated email into the local `users` table so timeline events and workflow updates can show stable actor identities
- added server actions for `assignSignalOwner`, `updateSignalWorkflowStateAction`, and `addSignalNote`, all backed by tenant-aware access checks
- `AnalyticsEngine` now returns workflow summary plus note/history context, and writes `assignment`, `workflow_state`, and `note` events into the shared signal timeline
- `SignalDetailsPanel` now exposes operator-ready collaboration controls directly in the drawer: assign owner, change handoff/status, write shared comments, and read note/event history

### Verification

- `npm run lint` passed after the signal-collaboration workflow changes
- `npm run build` passed after the signal-collaboration workflow changes
- `npm run db:repair-local` passed after the signal-collaboration workflow changes and upgraded the local DB to 21 public tables / 6 recorded migrations
- `npm run smoke:operator:runtime` passed after the signal-collaboration workflow changes

### Server-Side Signal Operator Timeline

- replaced the browser-local signal operator memory with a shared server-side timeline backed by `signal_operator_timeline`
- added migration `drizzle/0004_overjoyed_lionheart.sql` and local repair support so existing workspaces can bootstrap the new timeline table without resetting the DB
- `GET /api/views/dashboard/signals/[signalId]` now records the authenticated actor, tenant role, source screen, and timestamp when a signal drawer is opened
- `AnalyticsEngine.getSignalDetails(...)` now returns timeline context alongside signal detail: latest reviewer, per-signal history, and recent reviewed signals across the tenant
- `SignalDetailsPanel` now shows `who / when / from where` instead of a browser-only local history, and focused-screen return flow still preserves `signalReturnFrom`

### Signal Operator Memory Context

- added `src/lib/operator-signal-memory.ts` as a client-side operator memory store for recently reviewed signals using `localStorage` and `useSyncExternalStore`
- `SignalsFeed` now records where a signal was reopened from (`overview`, `economics`, or `explorer`) and surfaces source-aware return badges when the operator comes back to `overview`
- `SignalDetailsPanel` now shows the last-opened source/time plus a quick history of recently reviewed signals, with direct reopen actions for signals that are still active
- focused `economics` and `explorer` return links now include `signalReturnFrom`, and focused explorer tabs preserve `signalId` while switching tabs so the return-to-signal workflow does not break mid-investigation

### Verification

- `npm run db:repair-local` passed after the `P26` server-side signal-timeline changes and upgraded the local DB to 21 public tables / 5 recorded migrations
- `npm run lint` passed after the `P26` server-side signal-timeline changes
- `npm run build` passed after the `P26` server-side signal-timeline changes
- `npm run smoke:operator:runtime` passed after the `P26` server-side signal-timeline changes
- direct engine verification via `AnalyticsEngine.getSignalDetails(...)` returned a live timeline event with `actorEmail`, `openedFrom`, and `createdAt`
- `npm run lint` passed after the `P25` signal-operator-memory changes
- `npm run build` passed after the `P25` signal-operator-memory changes
- `npm run smoke:operator:runtime` passed after the `P25` signal-operator-memory changes

## 2026-04-03

### Added

- repo-level implementation backlog in [docs/IMPLEMENTATION_BACKLOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/IMPLEMENTATION_BACKLOG.md)
- full agent operating rules in [AGENTS.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/AGENTS.md)
- changelog baseline in [docs/CHANGELOG.md](/Users/vitea_b/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics/docs/CHANGELOG.md)

### Documented

- the repo is the `web/SaaS` implementation track, not the literal GAS-only project from the root prompts
- backlog priorities for security, user bootstrap, schema reconciliation, ingestion reliability, docs, testing, and GitHub setup
- initial GitHub state was recorded and then resolved into a connected private remote

### GitHub

- created private repository `viteab-source/enterprise-wb-analytics`
- configured local `origin` remote for SSH fetch/push
- enabled branch-based workflow for future task commits

### Security

- added shared tenant access helper in `src/lib/auth/tenant-access.ts`
- unified tenant membership checks across dashboard-facing API routes
- protected server actions for settings, signals, economics, dynamics, team management, CSV bulk updates, and manual sync trigger
- fixed invitation acceptance so a token cannot be accepted by a different authenticated email
- documented why `/api` remains outside the global proxy matcher due to webhook/system endpoints

### Session And Onboarding

- added bootstrap helper in `src/lib/auth/user-bootstrap.ts` to guarantee a local `users` row and reconcile active tenant state
- login now restores local profile state and redirects users without a cabinet into `/settings`
- signup now sends fresh accounts into the cabinet setup flow instead of `/overview`
- session hydration now populates `tenantId`, `role`, and `needsTenantSetup` consistently
- settings UI now exposes a clearer first-cabinet onboarding path
- tenant switching and cabinet creation now sync the denormalized role state immediately in both DB and client store

### Database And Migrations

- generated reconcile migration `drizzle/0001_swift_the_stranger.sql` and matching snapshot `drizzle/meta/0001_snapshot.json` so Drizzle history now matches the real 19-table schema
- captured previously unmanaged schema drift including invitations, user-to-tenant memberships, product grouping, WB raw data tables, tenant metadata fields, and the nullable `users.tenant_id` bootstrap model
- made `drizzle.config.ts` explicit about writing migration artifacts into `./drizzle`
- fixed `seed-mock-data.js` to create or refresh the demo tenant before inserting child records, aligning seed behavior with the current foreign-keyed schema

### Ingestion Reliability

- hardened `src/lib/wb-api/client.ts` with timeout-aware retry logic, retryable status handling for `408/425/429/5xx`, and richer WB API error diagnostics
- centralized JSON request/error handling in `src/lib/wb-api/index.ts` and added `getAllRealizationReports()` so finance sync now uses one paginated path
- added `sync_runs` tracking via `drizzle/0002_simple_lightspeed.sql` so manual sync requests now persist status, date range, per-source counts, and error summaries
- refactored `src/inngest/sync-wb.ts` to isolate failures source-by-source instead of aborting the full sync on the first failing WB endpoint
- fixed cron ingestion jobs to decrypt stored WB tokens before calling the API and to continue safely on tenant-scoped failures
- normalized funnel and ad-cluster snapshots to day buckets to avoid duplicate rows caused by timestamp-based unique keys

### Product Finish

- added reusable operator-state UI for missing tenant, empty data, retry, and healthy-no-alert scenarios
- dashboard pages now show explicit operator guidance instead of blank screens when the user has no active cabinet or no synchronized data
- `SignalsFeed` now distinguishes loading, failure, and zero-active-signal states and respects viewer-only access on management actions
- `SyncButton` now displays real last-run metadata from `sync_runs` instead of simulated progress
- browser verification confirmed the new empty/no-tenant states on `/overview`, `/economics`, `/dynamics`, and `/explorer`

### Documentation Baseline

- replaced the generic Next.js starter `README.md` with a repo-accurate entry document for `enterprise-wb-analytics`
- documented the actual implementation boundary, environment variables, current screens, and verification baseline in `README.md`
- rewrote `docs/PROJECT_GUIDE.md` to match the committed stack, tenant model, migration baseline, Inngest schedules, and known gaps
- updated `AGENTS.md` so `README.md` is treated as part of the maintained canonical documentation set
- corrected stale backlog wording that still claimed the repository had no GitHub remote configured

### Testing And Release Baseline

- added `scripts/release-baseline.mjs` as a reproducible audit path for worktree cleanliness, drizzle drift, build, and lint
- added `docs/RELEASE_CHECKLIST.md` to document the current release gate, report-only usage, and human verification steps
- reduced eslint noise by excluding root-level scratch scripts from the repo lint baseline
- documented that the current release blockers are repository-wide lint failures and local dirty/untracked runtime files

### Release Blocker Cleanup

- removed the remaining repo-wide lint errors across invite flow, team management, bot webhook handling, dashboard tables, KPI/chart widgets, and layout components
- fixed the `DateRangePicker` state sync path so the repo no longer trips `react-hooks/set-state-in-effect`
- committed the current runtime baseline files that were previously only present in a dirty worktree, including auth pages, dashboard layout/provider setup, Supabase helpers, dashboard tables, and package manifests
- updated `.gitignore` so scratch scripts and Supabase temp artifacts do not contaminate release checks
- advanced the release baseline from `lint failing + dirty runtime worktree` to `build/lint/drizzle/release script passing on the committed branch`

### Operator Smoke Baseline

- added `scripts/smoke-operator-flow.mjs` as a repeatable Playwright smoke for `login -> settings -> manual sync -> overview -> economics`
- added `docs/SMOKE_OPERATOR_FLOW.md` with prerequisites, environment variables, artifact paths, and interpretation rules
- added stable `data-testid` hooks to the login page, cabinet onboarding modal, settings tabs, and sync status UI so smoke checks do not depend on decorative layout text
- updated `README.md` and `docs/RELEASE_CHECKLIST.md` so the repo now points to one real browser verification command instead of ad-hoc manual verification only

### Team Workflow Finish

- fixed the team route for Next 16 client params by unwrapping `params` through `use(params)` instead of reading `params.tenantId` synchronously
- replaced the broken back link from `/cabinets` with a valid return path to `/settings`
- expanded team data to include cabinet metadata and the current user role so the UI can render real cabinet context and role-aware controls
- validated invitation input on the server, blocked self-invites, and removed browser `alert()` usage in favor of inline operator feedback
- aligned UI permissions with server permissions so admins can invite but only owners see revoke/remove actions for invites and members
- updated `README.md` so the cabinet team route is listed as a first-class product surface

### Local DB Migration Repair

- added `scripts/repair-local-db-baseline.mjs` and `npm run db:repair-local` to repair the known local Postgres drift in this workspace
- the repair path now creates `drizzle.__drizzle_migrations`, restores missing `raw_api_prices` and `sync_runs`, and records the committed migration history with real hashes from `0000..0002`
- updated runtime docs so a local `sync_runs` relation error is treated as a DB baseline problem with a concrete repair command, not as an unexplained app failure
- verified that manual sync now writes a real `sync_runs` row with status/error metadata instead of failing on a missing table

### Local Inngest Runtime Baseline

- added `npm run dev:runtime` and `scripts/dev-runtime.mjs` so local development can bring up `next dev` and the Inngest Dev Server together with one command
- added `npm run inngest:dev` as the standalone background-runtime command for teams that still prefer separate terminals
- added `npm run smoke:operator:runtime` and `scripts/smoke-operator-runtime.mjs` as a self-contained end-to-end local runtime check
- updated the core smoke script so it can assert real worker pickup when `SMOKE_EXPECT_INNGEST_RUNTIME=1` is enabled
- `/api/inngest` now registers both manual sync and scheduled jobs, so the local dev server sees the full committed function set instead of only the dashboard-triggered sync
- local manual sync now returns an explicit operator message when the Inngest Dev Server is missing instead of a raw `fetch failed`/`ECONNREFUSED`

### Sync Result UX And Token Diagnostics

- sync runtime now classifies source failures into token/auth/upstream/network categories and stores concise source metadata in `sync_runs.summary`
- `sync_runs.error_message` is now normalized from a diagnosis layer instead of concatenating every raw WB error payload
- settings sync UI now shows a diagnosis banner, per-source result cards, and a direct jump back to the `Wildberries Token` block
- invalid or malformed WB tokens now surface as one short operator instruction instead of a long repeated wall of `401 Unauthorized` responses

### Token Preflight And Sync History UX

- settings now supports an explicit WB token preflight against the main API contours before a full sync starts
- preflight can validate either the draft token from the form or the stored encrypted token for the active cabinet
- preflight feedback is now shown inline with per-contour cards for `Statistics`, `Content`, `Prices`, and `Advertising`
- settings now loads recent `sync_runs` history, exposes expandable per-run source breakdown, and allows quick retry of the latest or any previous range
- the sync history block now has an explicit empty-history placeholder so it does not disappear on a fresh cabinet with only one recorded run

### Guarded Token Save Lifecycle

- `tenants` now stores persisted WB token health via `wb_token_health_status`, `wb_token_checked_at`, and `wb_token_health_summary`
- saving a WB token now runs a server-side draft preflight and stops the first save when the token requires explicit warning acknowledgement
- settings now exposes a separate `save with warning` path for risky tokens instead of silently persisting them
- settings now shows the last-known saved-token health as a dedicated operator card, not only the transient preflight result
- `getTenantSettings()` now returns safe settings fields plus token health instead of returning the encrypted WB token to the client
- `db:repair-local` now repairs the committed tenant token-health columns and records migration `0003_condemned_vermin`

### Guarded Cabinet Onboarding And Sync Risk Surfacing

- `addCabinet()` now follows the same strict preflight policy as the main token card and no longer creates a cabinet silently on the first risky token submission
- the new-cabinet modal now shows inline WB preflight feedback plus a separate `connect with warning` path
- sync controls now read persisted token health and surface missing/unverified/risky token states before launch instead of using neutral copy
- the smoke operator flow now confirms the onboarding warning branch explicitly when a fake WB token is used

### Cabinet Token Health Visibility

- `getAvailableTenants()` now returns `hasStoredToken` plus last-known WB token-health fields for each accessible cabinet
- the `Все магазины` list in settings now shows compact token-health badges for every cabinet card
- the global cabinet switcher now shows the active cabinet token state and the same badge for each dropdown option
- token save and stored-token validation now invalidate both cabinet queries so badge state refreshes immediately after preflight/save

### Chart Container Runtime Baseline

- `PnLChart` no longer mounts through `ResponsiveContainer` against an unresolved parent size
- the chart now waits for a measured drawing area via `ResizeObserver` and renders a lightweight skeleton until dimensions are known
- the operator runtime smoke no longer surfaces the Recharts `width(-1)` / `height(-1)` console warning from the overview chart path

### Smoke Auth Navigation Abort Cleanup

- investigated the remaining `ECONNRESET` / `aborted` dev logs during signup-login smoke and traced them to a redundant `page.goto('/settings')` inside the smoke harness
- `ensureCabinet()` now reuses the auth redirect target when the browser is already on `/settings` instead of forcing a second reload over an active hydration/server-action window
- runtime smoke now completes without the previous auth-window abort noise, confirming that this was harmless harness-level dev noise rather than a backend/runtime bug

### Back To Signal Workflow

- signal follow-up URLs now include the originating `signalId`, not only SKU focus params
- focused `economics` and `explorer` banners now expose a direct `Вернуться к сигналу` action back to `overview`
- `overview` now restores the selected signal from `signalId` and reopens the same signal drawer automatically after the operator returns from a focused screen

### Signal Follow-Up Focus States

- signal recommendation links now carry contextual focus params so `economics` and `explorer` open already narrowed to the relevant SKU instead of landing on a generic screen
- `economics` now surfaces a signal-focus banner, narrows to the focused SKU when present, and highlights the matching row
- `explorer` now supports `nmId` filtering in the API, opens the relevant raw tab from the signal flow, and keeps that focused state visible while the operator switches tabs
- smoke now follows the first signal recommendation link when available and verifies focused target screens via `signal-focus-banner`

### Signals Drill-Down Workflow

- replaced the decorative signal `Детали` button with a real right-side drill-down panel on `overview`
- added a tenant-safe signal detail API route and analytics-engine detail assembly using existing `risk_signals`, product metadata, stock, and 14-day unit-economics context
- signal detail now surfaces SKU context, warehouse breakdown, content metadata, derived insights, recommended next steps, and role-aware resolve/ignore actions
- the operator smoke flow now conditionally opens the signal detail panel when signals are present and fails if the panel renders an error state

### Smoke Auto-Auth Noise Cleanup

- the smoke harness now detects when it uses the default generated email and skips the guaranteed failing login attempt in auto-auth mode
- default runtime smoke logs no longer include the predictable `Invalid login credentials` roundtrip before signup
- explicit smoke credentials still preserve the previous login-first fallback path, so override behavior remains unchanged

### Dashboard Data Freshness Context

- added shared `DataFreshnessBanner` backed by `sync_runs` history for the main operator screens
- `overview` and `economics` now keep last sync context visible even when the page is loading, empty, or in an error state
- `dynamics` and `explorer` now surface the same freshness layer, and `explorer` no longer carries a separate duplicated latest-sync widget
- the banner shows last attempt, last usable sync, sync coverage, active analytics range, and a direct jump back to `/settings`
- runtime smoke now asserts that the freshness banner renders on `/overview` and `/economics`

### Queue Owner Workflow Layer

- `overview` now exposes a dedicated queue-owner filter across shared team views and SLA automation runs, including `unassigned` owner queues
- added owner workload summary cards that show team-view volume, recent runs, pending escalations, assigned signals, overdue pressure, and team-default context per owner
- shared/team saved views are now grouped by queue owner instead of appearing in one flat list
- managers can now seed a new owner-specific team preset directly from the owner group, and the save form reuses the active owner context by default

### SLA Pending Follow-Up Automation

- SLA automation runs now expose reminder metadata (`followUpCount`, `lastFollowUpAt`) in both the run summary and the per-signal drill-down
- the run log now supports one-click `Напомнить pending` over the still-pending subset of any run instead of forcing the operator to reopen each signal manually
- follow-up reminders are recorded as dedicated timeline note payloads (`sla_follow_up`) so summaries and notifications can distinguish them from the original escalation
- added `signalSlaFollowUpJob`, a scheduled Inngest cron sweep that scans recent completed automation runs and can remind stale pending outcomes server-side
- the scheduled follow-up sweep reuses the same engine path as the manual run-log action, so dedupe rules and note payloads stay consistent

### Follow-Up Wave Outcome Tracking

- follow-up reminders now persist a shared `followUpBatchId`, which turns one reminder action into a server-derived wave instead of disconnected note rows
- automation run cards now expose `followUpWaveCount` plus a `latest follow-up wave` summary with current `pending / progressed / resolved / ignored` counts
- expanded automation run drill-down now shows the full follow-up wave history before the per-signal list, so operators can compare reminder batches over time

### Overview Owner KPI Layer

- extracted shared queue-owner summary building into `signal-queue-utils`, so overview-level KPI and feed-level workflow use the same owner workload model
- added `SignalQueueOwnerSummaryStrip` above the existing SLA strip on `/overview`
- the top-level overview now surfaces shared owner pressure earlier, including pending follow-ups, overdue assigned signals, recent runs, team-view count, and team-default context

### Follow-Up Resolution Capture

- added explicit `sla_follow_up_resolution` notes, so reminder waves can now carry `acknowledged`, `action taken`, or `no action` outcomes without waiting for a status change alone
- automation run summaries and per-wave drill-down cards now show explicit follow-up resolution counts and the latest captured resolution timestamp
- expanded run drill-down now lets the operator record that explicit resolution directly from the reminded signal row

### Automation Control Plane

- added `signal_automation_suppressions` and migration `0012_public_brood.sql` for persistent suppression by saved view or queue owner
- `overview` now exposes a dry-run preview panel and a recent automation-health summary inside the SLA automation block
- saved-view cards and queue-owner cards now support one-click suppress/unsuppress, and the scheduled follow-up sweep skips suppressed contexts instead of issuing reminders there

### Verification

- `npm run build` passed after the `P0` security changes
- focused lint on the `P0` files passed via `npx eslint ...`
- `npm run build` passed after the `P1` bootstrap/onboarding changes
- focused lint on the `P1` files passed via `npx eslint ...`
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` generated the expected `P2` reconcile migration
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` generated `drizzle/0002_simple_lightspeed.sql` and then returned `No schema changes, nothing to migrate`
- focused lint on the `P3` files passed via `npx eslint ...`
- `npm run build` passed after the `P3` ingestion reliability changes
- focused lint on the `P4` files passed via `npx eslint ...`
- `npm run build` passed after the `P4` UI-state and sync-status changes
- manual documentation review completed for the `P5` repo docs baseline
- `git diff --check` passed for the `P5` documentation updates
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` passed for the `P6` release baseline
- `npm run build` passed for the `P6` release baseline
- `npm run lint` still fails, but the failure set is now documented as part of the release gate
- `node scripts/release-baseline.mjs --report-only` produced the expected audit report
- `npm run lint` passed after the release-blocker cleanup with warnings only
- `npm run build` passed after the runtime baseline was committed
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` still reports `No schema changes, nothing to migrate`
- `node scripts/release-baseline.mjs` passes on the clean committed baseline
- `npx playwright install chromium` completed for the local browser runtime required by the smoke script
- `npm run smoke:operator` passed against local `next dev`, including auto-signup, cabinet activation, manual sync error-surface validation, `overview`, and `economics`
- `npm run lint` passed after the `P9` smoke-flow changes
- `npm run build` passed after the `P9` smoke-flow changes
- `npm run lint` passed after the `P10` team workflow changes
- `npm run build` passed after the `P10` team workflow changes
- browser verification passed for `settings -> все магазины -> команда`, including owner invite visibility and the corrected `/settings` back link
- `npm run db:repair-local` repaired the local DB from 18 to 20 public tables and recorded 3 migrations in `drizzle.__drizzle_migrations`
- `npm run smoke:operator` passed after the DB repair; manual sync now returns a normal `Ошибка / fetch failed` state instead of a missing-table crash
- `npm run lint` passed after the `P11` DB/runtime baseline changes
- `npm run build` passed after the `P11` DB/runtime baseline changes
- `npm run lint` passed after the `P12` local Inngest runtime changes
- `npm run build` passed after the `P12` local Inngest runtime changes
- `npm run smoke:operator:runtime` passed against the local `Next + Inngest Dev Server` runtime, proving that manual sync leaves the enqueue step and is picked up by the worker path
- `npm run lint` passed after the `P13` sync-diagnostics changes
- `npm run build` passed after the `P13` sync-diagnostics changes
- `npm run smoke:operator:runtime` passed with an intentionally invalid WB token and now ends in a concise terminal `Ошибка` diagnosis instead of raw repeated `401` payload spam
- `npm run lint` passed after the `P14` token-preflight and sync-history changes
- `npm run build` passed after the `P14` token-preflight and sync-history changes
- `npm run smoke:operator:runtime` passed after the `P14` settings UX changes
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` generated `drizzle/0003_condemned_vermin.sql`
- `npm run db:repair-local` repaired and recorded the local tenant token-health migration baseline
- `npm run lint` passed after the `P15` guarded token-lifecycle changes
- `npm run build` passed after the `P15` guarded token-lifecycle changes
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate` after `0003`
- browser verification passed for `strict save blocked -> save with warning -> last-known token health updated`
- `npm run lint` passed after the `P16` guarded onboarding and sync-risk changes
- `npm run build` passed after the `P16` guarded onboarding and sync-risk changes
- `npm run smoke:operator:runtime` passed after the onboarding warning-confirmation flow was added to smoke
- `npm run lint` passed after the `P17` cabinet token-health visibility changes
- `npm run build` passed after the `P17` cabinet token-health visibility changes
- `npm run smoke:operator:runtime` passed after the `P17` cabinet token-health visibility changes
- `npm run lint` passed after the `P18` chart-container runtime baseline changes
- `npm run build` passed after the `P18` chart-container runtime baseline changes
- `npm run smoke:operator:runtime` passed after the `P18` chart-container runtime baseline changes
- `npm run lint` passed after the `P19` smoke auth-navigation cleanup
- `npm run build` passed after the `P19` smoke auth-navigation cleanup
- `npm run smoke:operator:runtime` passed after the `P19` smoke auth-navigation cleanup
- `npm run lint` passed after the `P20` smoke auto-auth cleanup
- `npm run build` passed after the `P20` smoke auto-auth cleanup
- `npm run smoke:operator:runtime` passed after the `P20` smoke auto-auth cleanup
- `npm run lint` passed after the `P21` dashboard freshness-context changes
- `npm run build` passed after the `P21` dashboard freshness-context changes
- `npm run smoke:operator:runtime` passed after the `P21` dashboard freshness-context changes
- `npm run lint` passed after the `P41` queue-owner workflow changes
- `npm run build` passed after the `P41` queue-owner workflow changes
- `npm run smoke:operator:runtime` passed after the `P41` queue-owner workflow changes
- `npm run lint` passed after the `P42` SLA follow-up changes
- `npm run build` passed after the `P42` SLA follow-up changes
- `npm run smoke:operator:runtime` passed after the `P42` SLA follow-up changes
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/tsx -e "import { runScheduledSignalSlaFollowUpSweep } from './src/server/jobs/signal-sla-follow-up.ts'; (async () => { const result = await runScheduledSignalSlaFollowUpSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"` completed against the local database and returned `43` scanned tenants with `0` candidate follow-up runs on the current dataset
- `npm run lint` passed after the `P43` follow-up-wave tracking changes
- `npm run build` passed after the `P43` follow-up-wave tracking changes
- `npm run smoke:operator:runtime` passed after the `P43` follow-up-wave tracking changes
- `npm run lint` passed after the `P44` overview owner-summary strip changes
- `npm run build` passed after the `P44` overview owner-summary strip changes
- `npm run smoke:operator:runtime` passed after the `P44` overview owner-summary strip changes
- `npm run db:repair-local` passed after the `P46` automation control-plane changes and upgraded the local DB to 25 public tables / 13 recorded migrations
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate` after `0012_public_brood`
- `npm run lint` passed after the `P45` follow-up-resolution changes
- `npm run build` passed after the `P45` and `P46` automation workflow changes
- `npm run smoke:operator:runtime` passed after the `P45` and `P46` automation workflow changes
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/tsx -e "import { runScheduledSignalSlaFollowUpSweep } from './src/server/jobs/signal-sla-follow-up.ts'; (async () => { const result = await runScheduledSignalSlaFollowUpSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"` completed after the suppression changes and returned `45` scanned tenants with `0` runs scanned / `0` skippedSuppressed on the current dataset
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` generated `drizzle/0013_fixed_nebula.sql` for the automation governance layer and then returned `No schema changes, nothing to migrate`
- `npm run db:repair-local` passed after the `P47` governance changes and upgraded the local DB to 26 public tables / 14 recorded migrations
- `npm run lint` passed after the `P47` and `P48` automation governance / follow-up lifecycle changes
- `npm run build` passed after the `P47` and `P48` automation governance / follow-up lifecycle changes
- `npm run smoke:operator:runtime` passed after the `P47` and `P48` automation governance / follow-up lifecycle changes
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/tsx -e "import { runScheduledSignalSlaFollowUpSweep } from './src/server/jobs/signal-sla-follow-up.ts'; (async () => { const result = await runScheduledSignalSlaFollowUpSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"` passed after the `P48` follow-up enforcement changes and returned the new aggregate keys (`awaitingExplicitOutcome`, `skippedAcknowledged`, `skippedOutcomeCaptured`) with `46` scanned tenants / `0` current candidates on the local dataset
- `npm run lint` passed after the `P49` automation-notification routing changes
- `npm run build` passed after the `P49` and `P50` automation alert changes
- `npm run smoke:operator:runtime` passed after the `P49` and `P50` automation alert changes
- `npm exec drizzle-kit generate -- --config=drizzle.config.ts` returned `No schema changes, nothing to migrate` after the `P49` and `P50` notification/escalation slice
- `DOTENV_CONFIG_PATH=.env node -r dotenv/config ./node_modules/.bin/tsx -e "import { runScheduledSignalSlaFollowUpSweep } from './src/server/jobs/signal-sla-follow-up.ts'; (async () => { const result = await runScheduledSignalSlaFollowUpSweep({ dryRun: true }); console.log(JSON.stringify(result, null, 2)); })();"` passed after the `P50` escalation-alert changes and returned the new aggregate keys (`escalationEligible`, `escalationAlertsTriggered`, `skippedEscalationRecently`, `skippedEscalationTooFresh`) on the local dataset
- `npm run lint` passed after the `P51` owner-queue entrypoint changes
- `npm run build` passed after the `P51` owner-queue entrypoint changes
- `npm run smoke:operator:runtime` passed after the `P51` owner-queue entrypoint changes
- `2026-04-10`: unit-economics UI density pass v2 applied (unified table paddings, reduced visible column widths, compact `Бренд/Артикул WB/Баркод` row height, larger control/header typography, tighter content side paddings)
- `2026-04-10`: sidebar now supports persistent collapse (`icons-only` mode with localStorage key `dashboard-sidebar-collapsed:v1`), expanding the main workspace area on demand
- `2026-04-10`: deployment on `goal_bot` rebuilt and restarted (`enterprise-wb-analytics`, `enterprise-wb-analytics-inngest`, `enterprise-wb-analytics-cloudflared`), verified with local and external health checks
- `2026-04-11`: dashboard highlights (`Больше всего продавалось` / `Меньше всего продавалось`) switched to `raw_api_orders` source, so counters now rank by order quantity for the selected period; UI labels updated from `продаж` to `заказов`
- `2026-04-11`: dashboard block `Больше всего продавалось` now returns and renders the full ordered list of all SKU with non-zero orders in the selected period (no top-8 cut); added visible item count and scrollable list container
- `2026-04-11`: KPI `Заказы (шт.)` and `Ср. чек` aligned to `raw_api_orders` source to match the product highlights list and remove 1-day snapshot mismatches (`funnel` vs `orders`)
- `2026-04-11`: tax engine unified for all supported modes (`УСН доходы`, `УСН доходы-расходы`, `АУСН доходы`, `АУСН доходы-расходы`, `НПД 4/6`, `ЕСХН`, `ОСНО ИП`, `ОСНО организация`, `ПСН`), including legacy `ausn` alias and minimum tax floors for `УСН Д-Р (1%)` and `АУСН Д-Р (3%)`
- `2026-04-11`: dashboard/analytics tax branches now use a shared formula contour (`profitBeforeTax -> tax -> netProfit`) to avoid divergent results across KPI, daily PnL, and group dynamics
- `2026-04-11`: added API endpoint `GET /api/views/profit-report` (JSON/CSV) with Russian breakdown `из чего сложилась чистая прибыль` by period and optional SKU filter (`nmId`)
- `2026-04-11`: overview header now has `Отчёт по чистой прибыли` button that exports the current-period breakdown as CSV
- `2026-05-09`: clarified dashboard sync freshness wording (`окно sync` instead of `покрытие`) and agent WB realization freshness: reports now use `raw_api_realization_reports.date_to` for finance coverage and `unit_economics_summary` returns an explicit realization coverage note.
- `2026-05-11`: added WB weekly realization retry schedule for Monday-Wednesday at 10:30, 12:00, 14:00 MSK; the job fetches only `realization_reports` and stops retrying a tenant once the previous Monday-Sunday report is loaded.
- `2026-05-11`: dashboard buyouts now prefer finance facts from `mv_daily_pnl_final.quantity_for_cost` when weekly realization is loaded, so provisional zeroes from WB funnel no longer overwrite confirmed buyouts and buyout sums.
- `2026-05-11`: provisional sales tail now starts strictly after the finance cutoff date, preventing daily charts and drilldowns from double-counting raw sales on the weekly report `date_to` day.
- `2026-05-11`: unit-economics tariff snapshots now parse legacy stringified JSON from DB and future sync writes tariff/commission snapshots as JSONB arrays; tariff volume calculation uses WB factual liters first, then card volume/dimensions as fallback.
- `2026-05-11`: unit-economics reverse logistics for `>1 л` now uses WB `tariffs/box` buyer-return fields (`boxDeliveryMarketplaceBase/Liter`) when available, with `46 + 14×extra` only as fallback; economics API fetches live box/return tariffs when DB snapshots are absent.
- `2026-05-12`: advertising product checks now expose structured reason codes (`stock`, `card_content`, `seo`, `semantic`, `bid_economics`, etc.) and show the reason type in Decision Center, product cards and detailed overview.
- `2026-05-12`: advertising dayparting scheduler now respects the cabinet autopilot mode: `Советник` is read-only, while configured schedule mutations run only in `Полуавтомат` or `Автопилот`.
- `2026-05-12`: added `advertising_hourly_stats`, hourly WB fullstats delta sync, `/api/views/advertising/heatmap`, and a 7×24 heatmap UI that falls back to the daily layer until hourly history is accumulated.
- `2026-05-14`: added advertising post-action monitor for bid changes: 2/6/24h before-vs-after reports, group-aware attribution, Operations warnings, and auto rollback only in `Автопилот` when no newer bid change exists.
- `2026-05-14`: Operations tab now has a dedicated bid-change consequences block with savings, extra orders, rollback-needed count, and human-readable before/after cards.
- `2026-05-14`: completed advertising operator loop v1: decision cards now show the bid-action plan before click, Operations includes a period report and WB ad capability map, heatmap shows scope/best/bad hours, and daily advisor digest includes post-action outcomes.
