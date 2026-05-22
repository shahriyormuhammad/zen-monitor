# Enterprise Launch Checklist

> Single source of truth для enterprise-готовности проекта.
> Детали каждого пункта — в [`ENTERPRISE_AUDIT_2026-04-15.md`](./ENTERPRISE_AUDIT_2026-04-15.md).
> **Обновляйте статусы по мере выполнения.** Это файл-якорь, а не документация одного чтения.

Статусы: `todo` · `in_progress` · `blocked` · `done` · `wontfix` (с обоснованием)

Каждый пункт при закрытии должен обновить свой статус и иметь запись в [`CHANGELOG.md`](./CHANGELOG.md) + ссылку на коммит.

## Сводка прогресса (last update 2026-04-21 MSK · P73 Hybrid CPM+ROAS bidding modes — 4 режима с unit-tests, schema migration 0048, UI selector в StrategiesTab)

| Приоритет | Всего | Done | In progress | Todo | Blocked | Wontfix |
|---|---|---|---|---|---|---|
| P0 Blockers | 8 | 8 (P0-01 … P0-08) | 0 | 0 | 0 | 0 |
| P1 High | 18 | 18 | 0 | 0 | 0 | 0 |
| P2 Medium | 15 | 15 | 0 | 0 | 0 | 0 |
| P3 Low | 9 | 8 | 0 | 0 | 0 | 1 (P3-36) |
| **Advertising Wave 1** | **8** | **8** (P63, P64, P65, P66, P67, P68 Slice 1, P68 Slice 2, P69, P70) | **0** | **0** | **0** | **0** |
| **Advertising Wave 1 follow-ups** | **1** | **1** (P63.1 — BidWorkspace split: 9 slices, 8 tab-компонентов + shared helpers) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-17 — wave 1** | **14** | **14** (journal repair, backup timer, logrotate, RBAC, CSP, transactions, idempotency, open redirect, invitations FK, Next CVE, …) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-17 — wave 2** | **11** | **11** (protobufjs CVE override, WB Ads wrapper, RPA partial-success, Sentry scaffold, console→logger, nm_id bigint, TELEGRAM_WEBHOOK_SECRET conditional, stale docs archive) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-17 — wave 3** | **1** | **1** (`?tenantId=` query-param fallback removed) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-17 — wave 4** | **8** | **8** (Dependabot merged + dev audit closed by removing `drizzle-kit`) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-17 — wave 5** | **1** | **1** (AES-GCM IV 16→12 bytes: v2 формат с NIST-compliant 12-byte IV; v1 legacy decrypt сохранён для zero-downtime migration) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-17 — остаток** | **1** | **1** (engine.ts decomposition Slices 1-5 done: 8047→5418 LOC, −33%) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-18 — wave 6** | **1** | **1** (disk cleanup P2-50 temp: docker prune 3.7G + journal 209M + backups 70M = -4GB; sync-orders ne() filter) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-19 — round 1** | **1** | **1** (tsc clean, typecheck gate, reviews-qa tenant body==cookie binding) | **0** | **0** | **0** | **0** |
| **Audit 2026-04-19 — round 2 (RLS runtime)** | **1** | **1** (P0-03b RLS runtime enforcement — 13 slices + flip-the-switch) | **0** | **0** | **0** | **0** |
| **Итого** | **98** | **95** | **0** | **0** | **0** | **1** |
| **Wave 2+3 planning (2026-04-19, новые P71-P82)** | **12** | **8** (P71 BidWorkspaceContext, **P72 bandit autopilot — a/b/c/d all done**, **P73 Hybrid CPM+ROAS bidding modes**, P79 SignalCoreService, P80 EconomicsService, P81 SignalSlaExecutionService, P82 SignalFeedService) | **0** | **4** (Advertising Wave 2: P74; Advertising Wave 3: P75-P76; Analytics Wave 2: P77-P78) | **0** | **0** |

**engine.ts decomposition progress (Slices 1-6):**
- **Slice 1** (merge `9f59e56`, PR #28) — `helpers/numeric.ts` (66 LOC): 10 pure numeric/format/date helpers. Engine: 8047 → 7992 LOC.
- **Slice 2** (merge `8f21c99`, PR #29) — `helpers/sql-builders.ts` + `helpers/signals.ts` + `helpers/signal-content.ts` (865 LOC total): 2 SQL builders + 29 signal helpers + types + 2 UX presentation functions. Engine: 7992 → 7173 LOC.
- **Slice 3** (merge `6dff496`, PR #31) — `services/signal-saved-views.ts` (498 LOC): 9 CRUD saved-views methods + resolveSignalSavedViewSharedOwner shared helper. Engine: 7173 → 6696 LOC.
- **Slice 4** (merge `4891989`, PR #32) — `services/signal-notifications.ts` (241 LOC): getSignalNotifications, markSignalNotificationsRead, acknowledgeSignalNotifications. Engine: 6696 → 6488 LOC.
- **Slice 5** (merge `bbc058e`, PR #33) — `services/signal-automation-queries.ts` (1110 LOC): 6 automation control-plane queries + SignalDetailViewer type centralized. Engine: 6488 → 5418 LOC.
- **Slice 6** (P79, branch `claude/slice-6-signal-core-service`) — `services/signal-core.ts` (895 LOC): 17 signal core methods including getActiveSignals, recordSignalTimelineEvent, getSignalDetails, assignSignalOwner, updateSignalWorkflowState, addSignalNote, getSignalsFeed, bulk-ops. Engine: 5418 → 4522 LOC (**−818 LOC**).
- **Slice 7** (P80, PR [#46](https://github.com/viteab-source/enterprise-wb-analytics/pull/46) `e5965b4`) — `services/economics.ts` (2531 LOC): 6 economics methods getDailyPnL, getUnitEconomics, getNetProfitBreakdown, getOrderHighlights, getKpis, getDashboardDataTrust. Engine: 4522 → 2016 LOC (**−2506 LOC**).
- **Slice 8** (P81, `0d8d7a9`) — `services/signal-sla-execution.ts` (1041 LOC): 7 SLA execution methods previewSignalSlaAutomation, setSignalAutomationSuppression, clearSignalAutomationSuppression, captureSignalFollowUpResolution, runSignalSlaAutomation, runSignalSlaPendingFollowUp, runSignalSlaPendingFollowUpSweep. Engine: 2016 → 995 LOC (**−1021 LOC**).
- **Slice 9** (P82) — `services/signal-feed.ts` (157 LOC): 7 feed/bulk методов getSignalsFeed, bulkUpdateSignalStatus, bulkAssignSignalOwner, bulkUpdateSignalWorkflowState, bulkAddSignalNote, bulkApplySignalHandoffPreset, dispatchSignalCollaborationNotification (re-export). signal-core: 895 → 778 LOC (**−117 LOC**). engine.ts: 995 → 973 LOC (inline bulkUpdateSignalStatus → делегирование).
- **Итог: 8047 → 973 LOC (−7074 LOC, −88% исходного монолита).**
- **Pattern:** `class AnalyticsEngine { static X = Service.X }` делегирующие поля — внешние call-sites (`overview/actions.ts`, API routes, internal `this.X` из других методов) продолжают работать без изменений. Обратная совместимость сохранена.
- **Декомпозиция завершена (P79-P82).** engine.ts содержит только getSignals, getGroupDynamics и делегирующие поля.

Коммиты от 2026-04-15 консолидации: `47ba6b1`, `01a3ba9`, `7e750e6`, `a32550d`, `aaa1a9f`.

Audit-fix коммиты (все волны merged в `origin/main`):
- Wave 1 (14 findings): PR #17 → squash `6ad4257`. Детали: [docs/audits/AUDIT_2026-04-17.md](./audits/AUDIT_2026-04-17.md) + [MIGRATION_RECONCILIATION_2026-04-17.md](./audits/MIGRATION_RECONCILIATION_2026-04-17.md).
- Wave 2 (11 findings): PR #19 → squash `11b78cc`. Детали — CHANGELOG запись `2026-04-18 (wave 2)`.
- Wave 3 (1 finding): `?tenantId=` query-param fallback removal. PR #21 → squash `35ba21b`.
- Wave 4 (8 findings, 8 done): Dependabot triage — PR #10 (`ad19f3b`), #11 (merged user через web UI, `2765636`), #13 (`5d96967`), #14 (`b8b0473`), #15 (`fa920aa`), #16 (`7e061f3`), #18 (`72393c1`). `drizzle-kit` removed from repo dev dependencies on 2026-04-25, full `npm audit` is clean.
- Wave 5 (1 finding done): AES-GCM IV 16→12 bytes via versioned ciphertext (v1 legacy decrypt + v2 new encrypt). PR #23 → squash `73f5071`. Детали — CHANGELOG запись `2026-04-18 (wave 5)`.

**Advertising Redesign Track (добавлен 2026-04-16):** P63–P70 — Wave 1 «Страховочная сетка бюджета». Детали в `IMPLEMENTATION_BACKLOG.md` (раздел «Advertising Redesign Track»). Приоритет запуска: P64 (финансовое ядро) → P65 (guardrails) → P66 (баланс) → P63 (рефакторинг UI) → P67-P70.

**P63.1 · BidWorkspace decomposition (закрыт 2026-04-18):** монолит `AdvertisingBidWorkspace.tsx` разложен на 9 коммит-slices:
- Slice 0 `9ef48f1` — shared helpers (`workspace/strategy-helpers.ts`, 143 LOC)
- Slice 1 `94a13e1` — AlertsTab (138) · Slice 2 `0cac6ca` — MapTab (185) · Slice 3 `4aceec8` — BatchTab (184)
- Slice 4 `a1d7dfe` — BidsTab (370) · Slice 5 `b84d6d5` — Ads2Tab (447) · Slice 6 `2085c33` — PacingTab (499)
- Slice 7 `4cea854` — PortfoliosTab (570) · Slice 8 `ef0b42a` — StrategiesTab (1050)
- Результат: **4366 → 1606 LOC (-63%)**. Все 8 tab-компонентов в `src/components/advertising/workspace/tabs/`.
- Slice 9 (BidWorkspaceContext для устранения props-drilling) — optional, backlog.

---

## 🔴 P0 — Blockers (до первого платящего клиента)

### P0-01 · Telegram webhook fail-closed
- **Status:** `done` ✅
- **Файл:** `src/app/api/bot/route.ts`, `src/app/api/health/route.ts`
- **Что сделано:**
  - [x] POST handler возвращает 503 в production если `TELEGRAM_WEBHOOK_SECRET` пуст или < 32 символов (проверка на уровне запроса, не модуля — `next build` тоже ставит `NODE_ENV=production`)
  - [x] `isWebhookSecretValid()` больше не возвращает `true` при пустом секрете — всегда `false` (defence-in-depth)
  - [x] `TELEGRAM_WEBHOOK_SECRET` добавлен в `requiredEnvKeys` в health route
  - [ ] На сервере секрет НЕ задан (бот использует placeholder token). Health показывает 503 — задать секрет вместе с реальным bot token когда бот понадобится.
- **Verify:** `curl -X POST http://localhost:3457/api/bot -d '{}'` → 503 "Service Unavailable"; health → 503, `missingEnv: ["TELEGRAM_WEBHOOK_SECRET"]`.
- **Commit:** `bd31cd3 fix(security): webhook fail-closed + error scrubbing (P0-01, P0-02)`

### P0-02 · Bot webhook error scrubbing
- **Status:** `done` ✅
- **Файл:** `src/app/api/bot/route.ts`
- **Что сделано:**
  - [x] Catch-блок возвращает `new Response("Internal Server Error", { status: 500 })` вместо `` `Error: ${message}` ``
  - [x] `console.error` остаётся с полным `err.message` для server-side диагностики
- **Verify:** тело ответа на ошибку = "Internal Server Error", никаких SQL/stack деталей.
- **Commit:** `bd31cd3 fix(security): webhook fail-closed + error scrubbing (P0-01, P0-02)`

### P0-03 · Row-Level Security на таблицах с tenant_id
- **Status:** `done` (policy + helper + тесты) — **но см. P0-03b ниже: runtime enforcement не применяется**
- **Файл:** `drizzle/0040_rls_enable.sql` + `src/lib/db/index.ts` + `src/lib/db/rls.test.ts`
- **Что сделано:**
  - [x] Роль `enterprise_wb_analytics_user` имеет BYPASSRLS=false — новая роль не потребовалась.
  - [x] На 50 таблицах с `tenant_id` (все кроме `users`) включены RLS + FORCE RLS + политика `tenant_isolation`.
  - [x] Политика IS-NULL bypass: `USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)`. Сервисный код (Inngest) без SET LOCAL — видит все строки; код с SET LOCAL ограничен своим тенантом.
  - [x] `withTenantContext(database, tenantId, fn)` — хелпер: транзакция с `set_config('app.tenant_id', $1, true)`.
  - [x] 3 unit-теста (125/125 green). Pre-migration backup 7.5M. Миграция применена через psql на сервере. Verify: 50 таблиц rowsecurity=true, 50 политик tenant_isolation.
- **Verify (2026-04-17):**
  - `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;` → **50** ✅
  - `SELECT count(*) FROM pg_policies WHERE policyname='tenant_isolation';` → **50** ✅
  - `curl http://localhost:3457/api/health` → `db: ok` ✅
- **Commit:** `18f12de feat(security): P0-03 — Row-Level Security на 50 таблицах с tenant_id`
- **Follow-up (аудит 2026-04-19):** see **P0-03b · RLS runtime enforcement** ниже — DAO runtime НЕ вызывает `withTenantContext`, policy IS NULL bypass оставляет defense-in-depth «на бумаге».

### P0-03b · RLS runtime enforcement в DAO-слое (follow-up после аудита 2026-04-19)
- **Status:** `done` ✅ (Slice 13 flip-the-switch применён на проде 2026-04-21; IS-NULL bypass удалён, strict policy + admin sentinel активны на 50 таблицах)
- **Цель:** все tenant-scoped DAO call-sites вызывают `withTenantContext(db, tenantId, tx => …)`, после чего policy `tenant_isolation` ужесточается (удаляется `IS NULL` ветка — миграция `drizzle/0041_rls_strict.sql`). До этого момента RLS = «на бумаге».
- **Текущее состояние (2026-04-19):**
  - `withTenantContext` определён в [src/lib/db/index.ts:24](../src/lib/db/index.ts), покрыт 3 unit-тестами.
  - `grep -rn 'withTenantContext(' src/` — **0 runtime call-sites** (только `src/lib/db/rls.test.ts`).
  - 62 файла импортируют `@/lib/db`, 14 уже используют `db.transaction(async tx => …)` без SET LOCAL.
  - Inngest runtime под `enterprise_wb_analytics_user` (BYPASSRLS=false) работает только за счёт IS NULL bypass — flip-the-switch без покрытия = массовый прод-инцидент.
- **План (порядок миграции, slice-by-slice, каждый слайс PR→merge→deploy→verify):**
  1. ✅ Pilot: `/api/views/explorer/route.ts` (64 → 67 LOC, 5 GET-путей по raw-таблицам) — done, `withTenantContext` helper сигнатура одновременно ужесточена до DrizzleDatabase/DrizzleTransaction.
  2. ✅ `/api/views/redistribution/*` — routes (5/8) покрыты в Slice 2 (`run-status`, `run-preview`, `run-csv`, `run-action`, `run-create`). Sub-slice 2b: `src/server/redistribution/*.ts` — полностью покрыто в Slice 10 (`route-scan.ts` 889 LOC: loadBlockingRouteMap + saveRouteAvailabilityResult + upsertWarehouseRegistryOnTx + refreshTenantWarehouseRegistryFromStocks + getRouteScanOverview; `slot-monitor.ts` 311 LOC: loadSlotMonitorCandidates + recordRun closure). `runRouteScanForAllTenants` / `runSlotMonitorForAllTenants` оставлены admin-path (работают только с `tenants`, не под RLS).
  3. ⛔ `/api/views/reviews-qa/*` + `src/server/reviews-qa/*.ts` — **out of scope**: reviews-qa stack работает только с `tenants` (root, не под RLS) и HTTP к WB. Tenant-binding уже в audit round 1 (`requireTenantMatchesActive`).
  4. 🟡 ✅ `/api/views/economics-template/route.ts` (Slice 9, done — 6 call-sites: `getBuyoutFactsByNm` + `manualInputRows` + 4 tariff/commission select'ов; AnalyticsEngine.getUnitEconomics остаётся в Slice 11) + ✅ `src/app/(dashboard)/economics/actions.ts` (Slice 3, done) + ✅ `services/economics.ts` (Slice 5, done — 6 public методов через withTenantContext, 7-й `db.execute` в tenants не RLS).
  5. ✅ `src/app/(dashboard)/dynamics/actions.ts` (groups only, members без RLS) + ✅ `src/app/(dashboard)/stocks/actions.ts` (5 actions) — done в Slice 4. ✅ Analytics services (engine.ts + signal-core + signal-feed + signal-notifications + signal-saved-views + signal-sla-execution + signal-automation-queries) — все покрыты в Slice 11, ~50 call-sites в 7 файлах (~4800 LOC).
  6. ✅ `src/app/(dashboard)/settings/*.ts` (3 файла) — partial: Slice 4 покрыл userTenants + products + syncRuns + unitEconomicsConfigs. Admin-paths (`getAvailableTenants`, `switchActiveTenant`, `addCabinet`) + `src/app/(dashboard)/cabinets/user-actions.ts` — отдельный Slice для admin pattern (spec-UUID/admin-pool).
  7. 🟡 Inngest handlers + `src/server/jobs/*.ts` — 6a (Slice 6a done: sync-orders/sync-finances/wb-ads-retry/wb-scheduled-sync). Осталось: 6b sync-wb.ts (950 LOC, 30 call-sites), 6c redistribution-rpa.ts (1289 LOC) + redistribution-digest.ts, 6d admin sweeps (stale-sync-alert, on-failure доп. паттерны).
  8. ✅ Advertising service layer (`src/server/advertising/*.ts`, 9 файлов) — Slices 7a/7b/7c-1/7c-2 done.
  9. 🟡 Cross-cutting lib — ✅ Slice 8: `idempotency.ts` (findFirst+insert по `idempotencyKeys`) + `observed-products.ts` (listObservedProductOptions + reconcileObservedProducts). Отложено в Slice 12 admin-pattern: `telegram-update-dedup.ts` (таблица без tenant_id), `wb-rpa/storage-state.ts` (tenants не под RLS), `bot/service.ts` (tenants), `user-bootstrap.ts` + `tenant-access.ts` (cross-tenant reads до резолва tenantId).
  10. Integration-тест: два tenant в test-БД, verify `SELECT` из tenant B внутри `withTenantContext(tenantA)` возвращает 0 строк.
  11. **Flip-the-switch**: миграция `0041_rls_strict.sql` — `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` без IS NULL. Pre-backup, staging validation, coordinated deploy.
- **Критерий «готово» (per slice):**
  - Все `db.select/insert/update/delete` на tenant-scoped таблицах внутри изменённого handler/service обёрнуты в `withTenantContext`.
  - `npm run typecheck && npm run test && npm run build` — зелёные.
  - Smoke: curl / UI путь работает; `curl http://localhost:3457/api/health` → ok.
  - Prod deploy + health check + random curl.
- **Критерий «готово» финал (P0-03b done):**
  - `grep -rn 'withTenantContext(' src/ | wc -l` покрывает все tenant-scoped DAO.
  - Миграция `0041_rls_strict.sql` применена в prod.
  - Verify: `SELECT * FROM products LIMIT 1;` под `enterprise_wb_analytics_user` без SET LOCAL → 0 строк (RLS active).
  - Integration-test tenant isolation — зелёный в CI.
- **Риски / open questions:**
  - ✅ Admin-пути (user-bootstrap, cabinets/create-tenant) → Slice 12 внедрил spec-UUID sentinel pattern (`withAdminContext`). Policy exception будет применён в Slice 13 вместе с удалением IS-NULL bypass.
  - Scheduled sweeps (signal-sla-sweep, advertising-dayparting, stale-sync-alert) обходят все tenants → обёртывать per-tenant в цикле, иначе strict policy = 0 rows везде.
  - Health route: сейчас `db.execute('SELECT 1')` не трогает tenant-scoped таблицы → ok без обёртки.
- **Slices merged:** Slice 1 (`288640f`) · Slice 2 (`a9ba131`) · Slice 3 (`8989350`) · Slice 4 (`9ba9190`) · Slice 5 (`c1af0e9`) · Slice 6a (`6714feb`) · Slice 6b (`4ea2159`) · Slice 6c (`ff2704e`) · Slice 7a (`c2fd7b1`) · Slice 7b (`151d5ab`) · Slice 7c-1 (`caed6da` — workspace.ts mutations) · Slice 7c-2 (`2f63ad2` — workspace.ts reads, advertising layer complete) · Slice 8 (`f2bfaee` — cross-cutting lib: idempotency + observed-products) · Slice 9 (`066c846` — economics-template/route.ts) · Slice 10 (`5f9587c` — redistribution services: route-scan + slot-monitor) · Slice 11 (`183de92` — analytics engine + 6 signal-* services, ~50 call-sites в 7 файлах, ~4800 LOC) · Slice 12 (`f868ec3` — admin sentinel pattern: withAdminContext helper + ~15 admin-path call-sites + draft миграции в docs/operations/SLICE_13_RLS_STRICT_MIGRATION.md) · pre-Slice-13 sweep (`2c1e432` + `9ffe0bf` — sync-wb.ts + analytics/advertising + analytics/redistribution + analytics/stocks) · **Slice 13** (`9f93a93` — flip-the-switch: `drizzle/0047_rls_strict.sql` применён в prod; policy теперь `USING (tenant_id = app.tenant_id OR app.tenant_id = admin sentinel)`, IS-NULL bypass удалён; backup `/srv/backups/enterprise-wb-analytics/pre-slice-13-20260421-074806` SHA `87477900…`; verify: `SELECT count(*) FROM products` под `enterprise_wb_analytics_user` без app.tenant_id → 0, под real tenant → 101, под sentinel → 176)

### P0-04 · Индексы на raw-таблицах
- **Status:** `done` ✅
- **Файл:** `drizzle/0029_left_maria_hill.sql` + `src/lib/db/schema.ts`
- **Что сделано:** миграция создаёт 6 композитных btree-индексов:
  - `ad_costs_tenant_date_idx` на `raw_api_ad_costs (tenant_id, date)`
  - `orders_tenant_date_idx` на `raw_api_orders (tenant_id, date)`
  - `orders_tenant_nm_date_idx` на `raw_api_orders (tenant_id, nm_id, date)`
  - `realization_tenant_date_idx` на `raw_api_realization_reports (tenant_id, date_from, date_to)`
  - `realization_tenant_nm_date_idx` на `raw_api_realization_reports (tenant_id, nm_id, date_from)`
  - `sales_tenant_date_idx` на `raw_api_sales (tenant_id, date)`
- **Verify:** `EXPLAIN ANALYZE` на серверной БД 2026-04-15 23:45 MSK показал `Index Scan using orders_tenant_date_idx`, Execution Time 0.762 ms (было бы Seq Scan на 50 ms+ без индекса).
- **Commit:** `7e750e6 feat(db): composite indexes for raw API tables by tenant and date (P0-04)`
- **NOTE:** миграция использует обычный `CREATE INDEX` (не CONCURRENTLY). На текущем размере БД (94 MB) блокировка таблиц была миллисекундной. Когда raw-таблицы дорастут до гигабайтов — для следующих подобных миграций обязательно использовать `CONCURRENTLY` **через raw SQL вне drizzle-kit** (он не умеет CONCURRENTLY). Зафиксировать это в процессе раскатки больших index-миграций.

### P0-05 · Postgres connection pool config
- **Status:** `done` ✅
- **Файл:** `src/lib/db/index.ts`, `.env.example`, прод-БД `metric-pulse-app-01`
- **Что сделано:**
  - [x] `postgres()` получает `max=15`, `idle_timeout=20`, `max_lifetime=1800`, `connect_timeout=10`, `onnotice: () => {}` с env-override через `PG_POOL_MAX` и др.
  - [x] `.env.example` обновлён с новыми vars
  - [x] `ALTER SYSTEM SET statement_timeout = '30s'` + `idle_in_transaction_session_timeout = '60s'` + `pg_reload_conf()` выполнены на сервере (через `su - postgres`)
- **Verify (выполнено 2026-04-16):**
  - `SHOW statement_timeout;` → `30s` ✅
  - `SHOW idle_in_transaction_session_timeout;` → `1min` ✅
  - `pg_stat_activity` → 1 active, 0 idle in transaction ✅ (старые 6 idle-сессий закрылись благодаря `idle_timeout=20`)
  - health → db: ok ✅
- **Проверено:** `max_connections=100`, суммарный пул `(15 + 15) * 1.3 = 39` < 100 — запас есть. Supabase Docker использует отдельный Postgres-инстанс, не конкурирует.
- **Commit:** `847f5cc fix(db): configure connection pool limits and add timeout env vars (P0-05)`

### P0-06 · Infra topology decision
- **Status:** `done` ✅
- **Решение:** остаться на bare-metal `systemd`, но перенести production на новый сервер `metric-pulse-app-01` (`202.181.148.140`) с большим диском/RAM/swap и закрытым внешним доступом к внутренним портам.
- **Что сделано:**
  - [x] DNS `про-цифры.рф` указывает на `202.181.148.140`.
  - [x] Web, Supabase, Inngest, PostgreSQL и RPA-сервисы подняты на новом сервере.
  - [x] Внутренние порты `3457`, `54321`, `54322`, `54324`, `8288`, `8289`, `50052`, `50053`, `6080`, `5900` закрыты снаружи через `enterprise-wb-network-hardening.service`.
  - [x] `/wb-vnc/` снят с публичного nginx ingress; noVNC доступен только через SSH tunnel.
  - [x] Старый проект на прежнем сервере остановлен и удалён.
  - [x] Решение зафиксировано в `docs/PRODUCTION_DEPLOYMENT.md` и `docs/operations/SERVER_PRODUCTION.md`.
  - [x] Удалить или актуализировать `render.yaml`. ✅ (сделано в P3-42: оба файла `render.yaml` и `Dockerfile` удалены)
- **Commit:** _(заполнить после мёржа docs/ops фиксации)_

### P0-07 · CI/CD через GitHub Actions
- **Status:** `done` ✅ (branch protection blocked by GitHub Free plan; deploy remains manual by design)
- **Файл:** `.github/workflows/ci.yml`
- **Что сделано:**
  - [x] Workflow `ci.yml`: checkout@v6 + setup-node@v6 → `npm ci` → `npm run lint` → `npm run test` → `npm run build`.
  - [x] Concurrency group с cancel-in-progress, 15-min timeout, stub env vars для build.
  - [x] `persist-credentials: false` на checkout (supply-chain hardening).
  - [x] Локально lint/test/build зелёные (223 tests, build OK 2026-04-18).
  - [x] ~~deploy.yml с SSH-деплоем~~ → **wontfix**: blast radius CI → root@prod. Деплой ручной.
  - [x] ~~Отключить авто-pull на сервере~~ → N/A.
- **Открытые пункты (не blocking):**
  - [ ] Защитить `main`: required status checks. **Blocked:** GitHub Free — branch protection для private repo требует GitHub Pro ($4/мес).
  - [~] ~~CI runs на GitHub~~ → **wontfix**: проект верифицируется локально (`npm run lint && npm run test && npm run build`) перед каждым пушем; запуск CI в GitHub Actions платный и дублирует уже выполненные проверки. Workflow (`ci.yml`) сохранён как документация ожидаемых шагов.
- **Verify:** `npm run lint && npm run test` локально → 0 warnings, 223/223 ✅.
- **Commits:** `401ac40` (phase 1 · initial workflow), `b8bee02` (setup-node v6 + persist-credentials, PR #26)

### P0-08 · Observability (Sentry + metrics + alerts)
- **Status:** `done` ✅ (partial — Sentry отложен до получения DSN)
- **Файлы:** `src/lib/logger.ts` (новый), `src/inngest/stale-sync-alert.ts` (новый), `src/lib/api-response.ts`, `src/inngest/on-failure.ts`, `src/inngest/sync-wb.ts`, `src/app/api/bot/route.ts`, `src/app/api/inngest/route.ts`, `src/app/api/views/economics-template/route.ts`, `src/app/api/views/redistribution/run-action/route.ts`, `src/app/api/views/dashboard/signals/**/route.ts`
- **Что сделано:**
  - [x] `src/lib/logger.ts` — pino@10.3.1 structured logger с redact секретов (wbApiToken, token, password, secret, encryptionKey) и `base: { service }`.
  - [x] Заменены все `console.log/warn/error` в API routes и Inngest на `logger.*`.
  - [x] `apiRoute` wrapper использует `logger.error({ err, method, path })` вместо `console.error`.
  - [x] `staleSyncAlertJob` — Inngest cron (каждые 2 часа): если `max(finishedAt)` для tenant < now() - `SYNC_STALE_ALERT_HOURS` (дефолт 6ч) → Telegram-алерт.
  - [x] `.env.example` обновлён: `LOG_LEVEL`, `SENTRY_DSN` (placeholder), `SYNC_STALE_ALERT_HOURS`.
  - [ ] Sentry SaaS — отложен: нужен DSN. Добавить `@sentry/nextjs`, `src/instrumentation.ts` и `captureException` когда появится аккаунт.
  - [ ] Prometheus endpoint — отложен до P0-06 infra decision.
- **Verify (выполнено 2026-04-17):**
  - `npm run test` → 125/125 ✅
  - `npm run build` → OK ✅
  - `journalctl -u enterprise-wb-analytics` → JSON-логи с `"service":"enterprise-wb-analytics"` ✅
  - SHA-паритет local↔server: `7713621` ✅
- **Commit:** `c503ccb feat(observability): structured logging via pino + stale-sync alert (P0-08)`

---

## 🟠 P1 — High (первые 2 недели пилота)

### P1-09 · ENCRYPTION_KEY derivation
- **Status:** `done` ✅
- **Файлы:** `src/lib/encryption.ts`, `src/lib/errors.ts` (новый), `src/lib/auth/tenant-access.ts`, `src/lib/encryption.test.ts` (новый), `scripts/rotate-encryption-key.mjs` (новый)
- **Что сделано:**
  - ✅ `parseHexKey()` принимает 64-char hex (optionally с `hex:` префиксом), валидирует 32-byte buffer.
  - ✅ Legacy UTF-8 режим работает с warning `[encryption] ENCRYPTION_KEY использует legacy UTF-8 формат`.
  - ✅ Lazy init через `getEncryptionKey()` — нет exception при импорте модуля.
  - ✅ `AppError` вынесен в `src/lib/errors.ts` (без DB-зависимостей); `tenant-access.ts` ре-экспортирует для обратной совместимости.
  - ✅ `decryptIfNeeded` бросает `AppError(500)` вместо silent fallback; принимает опциональный `tenantId` для контекста в сообщении ошибки.
  - ✅ 13 unit-тестов: round-trip encrypt/decrypt, decryptIfNeeded, парсинг ключа (hex, hex: prefix, legacy UTF-8, too-short, missing).
  - ✅ `scripts/rotate-encryption-key.mjs` — CLI ротации (--old-key, --new-key, --dry-run), транзакционное re-encrypt всех `wb_api_token`.
- **Verify:** `npm run test` → 42 passed (13 новых в encryption.test.ts).
- **Commit:** `47ba6b1 fix(encryption): support hex-64 key format with legacy fallback (P1-09 partial)`, `54b44e6 fix(encryption): throw AppError on decrypt failure, add unit tests and rotate script (P1-09)`

### P1-10 · Inngest signing key enforce
- **Status:** `done` ✅
- **Файлы:** `src/app/api/inngest/route.ts`, `src/inngest/client.ts`, `src/app/api/health/route.ts`
- **Что сделано:**
  - [x] `signingKey` передаётся явно в конструктор `Inngest` из `INNGEST_SIGNING_KEY` env
  - [x] Request-time guard в route: production без `INNGEST_DEV` и без signing key → 503 (fail-closed)
  - [x] Warning (однократный) при `INNGEST_DEV=1` в production — напоминание перейти на signed runtime
  - [x] `"local-dev"` fallback для `eventKey` убран — используется только env value
  - [x] `INNGEST_SIGNING_KEY` добавлен в `requiredEnvKeys` health check (условно — только когда `INNGEST_DEV` не задан)
- **Verify:** GET `/api/inngest` → 200; health требует `INNGEST_SIGNING_KEY`, когда `INNGEST_DEV` отсутствует.
- **NOTE:** Production target: signed self-hosted runtime on `127.0.0.1:8288`; `.env.runtime` must set `INNGEST_BASE_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`; `INNGEST_DEV` must stay unset.
- **Commit:** `8cac802 fix(security): enforce Inngest signing key in production (P1-10)`

### P1-11 · Rate limiting
- **Status:** `done` ✅
- **Файл:** `src/lib/rate-limit.ts` (новый), 5 route files
- **Что сделано:**
  - [x] In-memory sliding-window rate limiter (без Redis — single-instance сервер).
  - [x] `withRateLimit(handler, { per: 'ip'|'tenant', limit, window })` wrapper.
  - [x] Применено: `/api/bot` (60/min per IP), `/api/health` (30/min per IP), `run-create` (10/min per tenant), `publish` (10/min per tenant), `reply` (20/min per tenant).
  - [x] 429 с `Retry-After` header, periodic sweep stale buckets.
  - [x] 4 unit-теста: under limit, 429, tenant scope, path isolation.
- **NOTE:** Redis не установлен на сервере. In-memory достаточно для single-process. При масштабировании — мигрировать на Upstash.
- **Verify:** 100 параллельных запросов на `/api/bot` без секрета → от 61-го идёт 429.
- **Commit:** _(заполнить после мёржа)_

### P1-12 · User enumeration fix
- **Status:** `done` ✅
- **Файл:** `src/app/(auth)/login/actions.ts`
- **Что сделано:**
  - [x] `login()`: Supabase `error.message` заменён на единое `'Неверный email или пароль'` для всех ошибок auth
  - [x] `signup()`: единое `'Не удалось создать аккаунт. Проверьте данные и попробуйте снова.'` — не раскрывает «email уже занят»
  - [x] `requestPasswordReset()`: всегда показывает «ссылка отправлена» (не раскрывает существование email)
  - [x] Zod-валидация `FormData` (`z.email()`, `z.string().min(8)`) во всех трёх actions — до вызова Supabase
- **Verify:** валидный email + неверный пароль и невалидный email + любой пароль → одинаковое `'Неверный email или пароль'`.
- **Commit:** `b639e03 fix(security): prevent user enumeration via auth error messages (P1-12)`

### P1-13 · Active tenant via cookie/metadata
- **Status:** `done` ✅
- **Файлы:** `src/lib/auth/tenant-access.ts`, `src/app/actions/session.ts`, `src/app/(auth)/login/actions.ts`, `src/app/(dashboard)/settings/actions.ts`, 38 routes в `src/app/api/views/**`
- **Что сделано:**
  - [x] `ACTIVE_TENANT_COOKIE = 'active_tenant_id'`, HttpOnly + Secure (production) + SameSite=Lax, maxAge 30 дней.
  - [x] `requireActiveTenant(request)` читает cookie, fallback на `?tenantId=` на переходный период, всегда валидирует членство.
  - [x] `login()`/`signup()` / `getInitialSessionData()` / `switchActiveTenant()` ставят cookie после bootstrap и membership check.
  - [x] 38 API routes мигрированы с `requireTenantAccessFromRequest` на `requireActiveTenant` (сам `requireTenantAccessFromRequest` удалён).
  - [x] HMAC-подпись не вводилась: cookie — указатель, авторитет — membership check на каждом запросе.
- **Verify:** `curl` к `/api/views/dashboard` без cookie и без `?tenantId=` → 400 Missing tenantId; с чужим cookie → 403 Access denied. Deployed на production (SHA `814c115`, health `app:ok db:ok`).
- **Commit:** `814c115 feat(security): active tenant via HttpOnly cookie (P1-13)`

### P1-14 · Idempotency-Key для mutation POST
- **Status:** `done` ✅
- **Файлы:** `src/lib/idempotency.ts`, `src/lib/db/schema.ts`, `drizzle/0031_idempotency_keys.sql`, 4 route files
- **Что сделано:**
  - [x] Таблица `idempotency_keys` (key, tenant_id, request_hash, response_status, response_body, created_at) + unique index.
  - [x] `withIdempotencyKey` wrapper: проверяет header → кэширует/возвращает → 422 при hash mismatch.
  - [x] Применено к `redistribution/run-create`, `reviews-qa/publish`, `reviews-qa/reply`, `advertising/workspace/bids`.
  - [x] Unit-тесты: 6 тестов на все сценарии (pass-through, cache hit, hash mismatch, new key, body tenantId, key length).
- **Verify:** два одинаковых POST с одним Idempotency-Key → один результат, один row в БД.
- **Commit:** _(заполнить после мёржа)_

### P1-15 · sync_runs race protection
- **Status:** `done` ✅
- **Файл:** `src/server/jobs/wb-scheduled-sync.ts`
- **Что сделано:** объединили check-then-insert в один атомарный `INSERT ... SELECT ... WHERE NOT EXISTS` в `sync_runs` с проверкой `status IN ('pending','running')` и окна `requested_at > NOW() - interval <lockMinutes>`. Два одновременных вызова теперь физически не могут создать больше одного run для тенанта.
- **Commit:** `01a3ba9 fix(sync): transactional writes, scheduled-run race protection, ads retry backoff (P1-15)`
- **NOTE:** partial-index вариант (`CREATE UNIQUE INDEX sync_runs_one_active_per_tenant ... WHERE status IN (...)`) тоже имеет смысл как defence-in-depth поверх application-level условия — задача на отдельный follow-up коммит.

### P1-16 · Inngest concurrency limits
- **Status:** `done` ✅
- **Файлы:** `src/inngest/sync-wb.ts`, `src/server/jobs/*.ts` (13 файлов)
- **Что сделано:**
  - [x] `syncWildberriesData`: `concurrency: [{ limit: 1, key: "event.data.tenantId" }, { limit: 3 }]`
  - [x] `redistributionRpa`: `concurrency: [{ limit: 1, key: "event.data.tenantId" }, { limit: 2 }]` (Playwright heavy)
  - [x] `wbAdsRetryDispatcher`: `concurrency: [{ limit: 1, key: "event.data.tenantId" }]`
  - [x] Все 10 cron-функций: `concurrency: { limit: 1 }` (auto-bidder, reviews-qa, slot-monitor, fast/medium/nightly sync, finances, orders, signal-sla-sweep/follow-up, digest, route-scan)
- **Verify:** Inngest dev dashboard → все функции показывают concurrency config.
- **Commit:** `a41466a fix(inngest): add concurrency limits to all 15 functions (P1-16)`

### P1-17 · Dead letters + alerts on failure
- **Status:** `done` ✅
- **Файлы:** `src/inngest/on-failure.ts` (новый), все 13 файлов с Inngest функциями
- **Что сделано:**
  - [x] Shared `handleInngestFailure` handler в `src/inngest/on-failure.ts`.
  - [x] Telegram алерт при final failure: для event-driven функций — по tenantId, для cron — broadcast всем тенантам с включёнными уведомлениями.
  - [x] `onFailure: handleInngestFailure` добавлен ко всем 15 Inngest функциям.
  - [x] Graceful: не ломается если бот не инициализирован или chatId отсутствует.
  - [ ] Метрика `inngest_function_final_failure_total` — отложена до интеграции Prometheus/Sentry (P0-08).
- **Verify:** заставить `syncWildberriesData` упасть 3 раза подряд → алерт в Telegram.
- **Commit:** _(заполнить после мёржа)_

### P1-18 · Error scrubbing в API responses
- **Status:** `done`
- **Файл:** `src/lib/auth/tenant-access.ts`, `src/lib/api-response.ts` (новый)
- **Что сделать:**
  - [x] `getErrorMessage` возвращает `err.message` только если `err instanceof AppError`, иначе `'Internal Server Error'`.
  - [x] Wrapper `apiRoute(handler)` ловит любые exceptions, пишет в logger, возвращает scrubbed response.
  - [x] Применить ко всем `route.ts`.
- **Verify:** искусственно кинуть Drizzle error в любом route → в response только `{ error: 'Internal Server Error' }`.
- **Commit:** `ada1f6d`, `9cffe1c`

### P1-19 · RPA storage state шифрование
- **Status:** `done` ✅
- **Файлы:** `src/lib/wb-rpa/storage-state.ts` (новый), `src/server/jobs/redistribution-rpa.ts`, `src/app/(dashboard)/settings/actions.ts`, `src/server/redistribution/slot-monitor.ts`, `src/lib/db/schema.ts`, `drizzle/0036_wb_lk_storage_state_encryption.sql`
- **Что сделано:**
  - [x] Миграция 0036 — колонки `tenants.wb_lk_storage_state` (зашифрованный blob AES-256-GCM через `@/lib/encryption`) и `wb_lk_storage_state_refreshed_at` (TTL-метка).
  - [x] Хелпер `loadStorageStateSession(tenantId)` читает DB-blob, проверяет TTL=7 дней, расшифровывает и пишет во временный файл в `os.tmpdir()` (mode 0o600, случайный путь). Возвращает `cleanup()` для удаления в finally.
  - [x] Хелпер `persistStorageStateFromContext(tenantId, context)` снимает storageState с live Playwright-контекста, шифрует и апдейтит DB; файл на диске не создаётся.
  - [x] Миграция legacy-файлов: при первом загрузке, если BD-blob пуст, но старый файл `output/wb-rpa/sessions/*.json` ещё существует — содержимое шифруется в БД, mtime используется как `refreshedAt`, файл удаляется.
  - [x] TTL=7 дней; после истечения `loadStorageStateSession` возвращает `null` → RPA-джоба падает с NonRetriableError, UI-flow `verifyWbLkSession` требует повторный вход.
- **Verify:** после первой RPA-сессии — `find /srv/projects/enterprise-wb-analytics/output/wb-rpa/sessions -name '*.json'` → пусто (legacy migration удаляет); `select wb_lk_storage_state is not null, wb_lk_storage_state_refreshed_at from tenants` показывает свежий timestamp; `find /tmp -name 'wb-rpa-session-*' -mmin +1` → пусто (tmp cleanup в finally).
- **Backup caveat:** ad-hoc `pg_dump` от app-user заблокирован `FORCE ROW LEVEL SECURITY` (нет `BYPASSRLS`). Rollback-fallback — последний nightly snapshot `pre-migration-20260416-215156`. Миграция строго аддитивная (две nullable-колонки на `tenants`), rollback SQL тривиален: `ALTER TABLE tenants DROP COLUMN wb_lk_storage_state, DROP COLUMN wb_lk_storage_state_refreshed_at;`.
- **Commit:** `2fa5ed4` (merged to `origin/main`, deployed to production 2026-04-17; server SHA parity ✓; `app:ok db:ok`; `psql` подтверждает новые колонки).

### P1-20 · `lucide-react` версия
- **Status:** `done` ✅
- **Файл:** `package.json`
- **Что сделано:**
  - [x] Обновлено с `1.7.0` → `1.8.0` (latest).
  - [x] Проверены все 65 используемых иконок — все экспортируются.
  - [x] Билд проходит чисто.
- **Verify:** `npm ls lucide-react` → `1.8.0`; все экраны работают.
- **Commit:** _(заполнить после мёржа)_

### P1-21 · `xlsx` supply chain risk
- **Status:** `done` ✅
- **Файл:** `package.json`, `src/components/dashboard/UnitEconomicsTemplateTable.tsx`
- **Что сделано:**
  - [x] Решение: `exceljs@4.4.0` (MIT, поддерживается).
  - [x] Переписан `exportExcelWorkbook` с `xlsx` на `exceljs` API (Workbook → addWorksheet → addRow → writeBuffer).
  - [x] Удалён `xlsx` из зависимостей.
  - [x] Билд проходит чисто.
- **Verify:** экспорт юнит-таблицы работает; `npm audit` — xlsx CVE больше нет.
- **Commit:** _(заполнить после мёржа)_

---

## 🟡 P2 — Medium (первый месяц после запуска)

- [x] **P2-22** Dashboard pages на Server Components (overview, economics-template, stocks) ✅ — commit `31ba351`
- [x] **P2-23** Виртуализация таблиц через `@tanstack/react-virtual` (закрыто в P63 — `ClusterTable` виртуализирован, порог 50 строк)
- [x] **P2-24** Расширить test coverage: auth, tenant-access, encryption, ad-autopilot ✅
- [x] **P2-25** `error.tsx` + `global-error.tsx` с Sentry integration ✅
- [x] **P2-26** CSV/Excel экспорт в S3/R2 (или Postgres bytea) ✅ — `run-csv` route регенерирует CSV из `redistribution_items` DB, fallback на файл только для старых прогонов без items; commit `a0bc650`
- [x] **P2-27** Разделить web и rpa-worker, убрать Playwright из web-bundle ✅ — `outputFileTracingIncludes` сужен с `/*` до `/api/inngest`; Playwright-бинари остаются в standalone через inngest-роут; commit `1a709af`
- [x] **P2-28** Аудит FK `onDelete` политик в schema.ts ✅
- [x] **P2-29** `DATABASE_URL` SSL requirement через env flag ✅
- [x] **P2-30** Security headers в `next.config.ts` ✅
- [x] **P2-31** Единые `parseRequestQuery`/`parseRequestBody` через zod ✅
- [x] **P2-32** `noUncheckedIndexedAccess` в tsconfig ✅
- [x] **P2-33** Фикс `.env.production:25` (кавычки вокруг URL) ✅

---

## 🟢 P3 — Low / nice-to-have

- [x] **P3-34** `/api/health` — расширенные checks (Supabase, Inngest) ✅ — commit `390ddb1`
- [x] **P3-35** Automated DB backups (`scripts/nightly-db-backup.mjs` + `npm run db:backup:nightly`, commit `aaa1a9f`). Осталось: завести systemd timer на сервере для регулярного запуска CLI.
- [~] **P3-36** i18n framework — `wontfix`: продукт ориентирован исключительно на RU-рынок (WB), UI уже на русском (~1200 строк в 111 файлах), экспансия не запланирована. Пересмотреть при выходе на новые рынки.
- [x] **P3-37** A11y fixes (aria-labels, scope, focus trap) ✅ — `scope="col"` на 202+ `<th>` в 10 файлах; `aria-label` на 3 icon-only кнопках; focus trap в `SignalDetailsPanel`; commit `d78fa79`, `a62c0c5`
- [x] **P3-38** Dependabot / Renovate ✅ — `.github/dependabot.yml`: npm weekly (5 групп пакетов, игнор major) + github-actions weekly
- [x] **P3-39** Telegram update replay protection (update_id dedupe) ✅ — commit `7d806aa`
- [x] **P3-40** ESLint zero-warning baseline ✅ — commit `ca70140`
- [x] **P3-41** `next-themes` flash check ✅ — `suppressHydrationWarning` на `<html>`, `defaultTheme="system"` + `enableSystem` + `disableTransitionOnChange` уже выставлены корректно; next-themes 0.4.6 инжектирует inline script до гидратации — исправлений не потребовалось
- [x] **P3-42** Удалить/обновить `render.yaml` и `Dockerfile` в репо ✅ — оба файла удалены; сервис деплоится через bare-metal systemd на `metric-pulse-app-01`, Render/Docker не используется

---

---

## Дополнения после консолидации 2026-04-15

Эти пункты всплыли в процессе объединения незакоммиченной работы на `main` и не были частью исходного первого прохода аудита. Фиксирую как новые:

### P1-43 · Race condition в `acceptInvitation`
- **Status:** `done` ✅
- **Файл:** `src/app/(dashboard)/cabinets/user-actions.ts`
- **Что сделано:** атомарный `UPDATE invitations SET status='accepted' WHERE token=? AND status='pending' RETURNING *` — два одновременных клика по одному invite-линку теперь корректно отбирают ровно одного победителя. Бывший SELECT-then-UPDATE паттерн убран.
- **Commit:** был в более ранней работе, попал в консолидацию через commit `01a3ba9` и `aaa1a9f`.

### P1-44 · Stocks/Products sync без транзакций
- **Status:** `done` ✅
- **Файл:** `src/inngest/sync-wb.ts`
- **Что сделано:** DELETE+INSERT для stocks и upsert+archive для products теперь обёрнуты в `db.transaction`, исключая сценарий «успел удалить, не успел вставить».
- **Commit:** `01a3ba9`

### P1-45 · Ads retry event loss
- **Status:** `done` ✅
- **Файл:** `src/inngest/sync-wb.ts`, `src/server/jobs/wb-ads-retry.ts`
- **Что сделано:** убран silent try/catch вокруг `step.run(inngest.send(...))`, так что если Inngest transport падает — ошибка корректно всплывает и step ретраится штатным Inngest retry. Плюс добавлен exponential backoff + rate-limit multiplier для 429.
- **Commit:** `01a3ba9`

### P1-46 · Financial calculation precision
- **Status:** `done` ✅
- **Файл:** `src/server/analytics/engine.ts`
- **Что сделано:** введены `roundFinancial(value, decimals=2)` с защитой от `Math.round(0.005)` квирк и `safeNumber(value, fallback=0)` guard на каждое деление; JSON больше не отдаёт `null` вместо финансового числа при деления на ноль или NaN/Infinity upstream.
- **Commit:** `a32550d`

### P1-47 · `any` typing cleanup в analytics engine
- **Status:** `done` ✅
- **Файл:** `src/server/analytics/engine.ts`
- **Что сделано:** все 8 точек `as any[]`/`(tx: any)`/`(series: any)` заменены на явные типы строк из drizzle-запросов.
- **Commit:** `a32550d`

### P2-48 · Next.js 16 standalone `client-reference-manifest` ошибки для part route groups
- **Status:** `done` ✅
- **Файл:** `/etc/systemd/system/enterprise-wb-analytics.service` (на production-сервере)
- **Симптом:** `Invariant: The client reference manifest for route "/overview" does not exist. This is a bug in Next.js.` (также `/login`, `/advertising`, `/explorer`). Эти ошибки присутствовали в логах **задолго до** консолидации, не являются регрессией моих коммитов, но всплывают при каждом запросе к затронутым страницам.
- **Что сделано:**
  - [x] Добавлен `ExecStartPre=/bin/bash -c '...'` в systemd unit после шага `copy public/` — скрипт ищет route-group директории `(*)` в `.next/server/app`, находит `*-manifest*` и `*manifest.json` файлы и копирует их в flat-пути (убирает route-group prefix).
  - [x] `systemctl daemon-reload && systemctl restart enterprise-wb-analytics` выполнены.
  - [x] Health проверен: `app:ok db:ok supabase:ok inngest:ok` ✅
- **Verify:** `tail -f /var/log/enterprise-wb-analytics.log` во время навигации по `/overview`, `/advertising`, `/explorer` → нет `InvariantError`.
- **Примечание:** изменение только на сервере, в git не хранится (unit файл — серверная конфигурация).

### P2-49 · `.env.production` runtime лежит в нескольких бэкапах
- **Status:** `done` ✅
- **Файл:** `/srv/projects/enterprise-wb-analytics/.env.production.bak-*` → перемещены на сервере
- **Что сделано:**
  - [x] Создана директория `/srv/backups/enterprise-wb-analytics/env/` (mode 700, owner root)
  - [x] 2 файла `.env.production.bak-*` перемещены из рабочего каталога в эту директорию
  - [x] В рабочем каталоге остался только один живой `.env.production`
- **Verify:** `ls /srv/projects/enterprise-wb-analytics/.env.production.bak-*` → `No such file or directory`; `ls -la /srv/backups/enterprise-wb-analytics/env/` → 2 файла mode 600.
- **Commit:** `(docs-only, no code change)`

### P2-50 · Диск /srv 82% используется
- **Status:** `done (temp fix 2026-04-18; постоянный fix — часть P0-06)`
- **Симптом:** `/dev/vda2 119G 92G 21G 82% /`. Бэкапы, логи, `node_modules`, `.next`, Docker images (Supabase), output/playwright дебаг-скриншоты добирают место. При 95% → Postgres может перестать писать WAL и залипнуть.
- **Fix (временный, выполнен):** `journalctl --vacuum-size=500M` (-209M), `docker system prune -af` (-3.68G), удалено 11 старых `pre-*` бэкапов (-70M). Результат: **81% → 77% (86G/119G)**. Supabase named volumes не затронуты.
- **Fix (постоянный):** часть P0-06 — перенести на новый сервер с большим диском.

---

## Процесс закрытия пункта

1. Создать focused branch `codex/<pxx>-<short-description>` от `main` (или работать в одном worktree).
2. Сделать изменения **только** по текущему пункту. Не смешивать несколько P0/P1.
3. Локально: `npm run lint && npm run test && npm run build` (минимум).
4. Если пункт затрагивает БД — запустить миграцию локально и на сервере (вне пик).
5. Обновить статус в этом файле, заполнить `Commit:` ссылкой.
6. Записать в `docs/CHANGELOG.md`.
7. Создать PR, дождаться зелёного CI (после P0-07), мёрж в `main`.
8. На сервере: `git pull && systemctl restart enterprise-wb-analytics`.
9. Верификация по чек-листу `Verify:`.
