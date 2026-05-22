# Enterprise Audit — 2026-04-15

> Status: **baseline audit complete, fixes in progress**
> HEAD: `7419e54` (`main`) · Local ↔ server parity: **OK**
> Snapshot: `/srv/backups/enterprise-wb-analytics/pre-audit-20260415-224500/` + local copy in `~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/pre-audit-20260415-224500/` (sha256 verified)

Этот документ — фиксация полного enterprise-аудита перед боевым запуском. Все находки привязаны к файлам и строкам в репозитории. Чек-лист с приоритетами P0–P3 и статусами — в [`ENTERPRISE_LAUNCH_CHECKLIST.md`](./ENTERPRISE_LAUNCH_CHECKLIST.md). Модель угроз — в [`THREAT_MODEL.md`](./THREAT_MODEL.md). Runbook инцидентов — в [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md).

## 1. Контекст

- **Продукт:** Enterprise WB Analytics, multi-tenant SaaS для продавцов Wildberries.
- **Стек:** Next.js 16.2.2 (App Router, standalone output), React 19.2.4, Tailwind 4, Supabase Auth (SSR, cookies), Drizzle ORM 0.45 + PostgreSQL 17.9, Inngest 4.1, Zod 4, TanStack Query, Zustand, Playwright (RPA), grammY (Telegram), YandexGPT (reviews-QA).
- **Размер кода:** 154 TS/TSX файла, 39 API routes, 43 таблицы БД, 29 миграций, 5 test-файлов.
- **Деплой:** выделенный сервер `goalbot` (Debian 13, 4 CPU, 5.8 Gi RAM, 119 Gi диск, 82% used), systemd units:
  - `enterprise-wb-analytics.service` — Next.js Web App
  - `enterprise-wb-analytics-inngest.service` — Inngest Dev Runtime
  - `enterprise-wb-analytics-cloudflared.service` — публичный tunnel (DNS ещё не cutover)
  - `enterprise-wb-x11vnc / xvfb / novnc` — виртуальный дисплей для Playwright/RPA
  - `postgresql@17-main.service` — локальный Postgres (БД приложения, 94 MB, 42 таблицы)
- **Supabase self-hosted** в Docker (`supabase_auth_*`, `supabase_kong_*`, `supabase_db_*`, `supabase_inbucket_*`) — используется для аутентификации.
- **Render.yaml / Dockerfile в репо** — **не актуальный деплой**. Репо содержит эти файлы, но прод живёт на bare-metal. Это нужно либо документировать как «план миграции», либо убрать из репо, чтобы не путать новых контрибьюторов.
- **Методика аудита:** 6 параллельных специализированных агентов (security, database, API, jobs/WB API, frontend, DevOps/observability) + самостоятельная верификация ключевых находок по исходнику.

## 2. Вердикт

**Проект НЕ готов к коммерческому enterprise-запуску в текущем состоянии.**

Бизнес-логика зрелая и богатая, Telegram/WB/RPA/Inngest/Supabase интеграции работают. Но есть блокирующие проблемы безопасности, наблюдаемости и инфраструктуры, которые в энтерпрайзе всплывут в первые недели.

Все блокеры закрывабельны в ~1–2 недели фокусной работы. Ниже — полный список.

---

## 3. P0 — Blockers (закрыть до первого платящего клиента)

### P0-01 · Telegram webhook fail-open при отсутствии секрета
**Файл:** [`src/app/api/bot/route.ts:9-12`](../src/app/api/bot/route.ts#L9-L12)

```ts
function isWebhookSecretValid(incomingSecret: string | null): boolean {
  if (!TELEGRAM_WEBHOOK_SECRET) {
    return true; // ← любой запрос проходит, если env пуст
  }
```

При пустом/отсутствующем `TELEGRAM_WEBHOOK_SECRET` webhook принимает любой POST. Атакующий может слать фейковые Telegram Updates и выполнять команды от имени любого chat-id. В production prod-env это блокер.

**Fix:**
- В prod-режиме (`NODE_ENV === 'production'`) кидать исключение при загрузке модуля, если секрет пуст.
- Добавить `TELEGRAM_WEBHOOK_SECRET` в `requiredEnvKeys` в [`src/app/api/health/route.ts`](../src/app/api/health/route.ts).
- Убедиться что на сервере в `.env.production` секрет задан и длиной ≥ 32 символов.

### P0-02 · Bot webhook утекает сырые error messages
**Файл:** [`src/app/api/bot/route.ts:45-49`](../src/app/api/bot/route.ts#L45-L49)

```ts
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown bot route error";
  console.error("[Bot Route] Error:", message);
  return new Response(`Error: ${message}`, { status: 500 });
}
```

Стектрейсы Drizzle/Postgres с именами колонок, SQL-фрагменты, внутренние ID — всё это уезжает в Response клиенту (Telegram, но также любому, кто простучит webhook прямым POST).

**Fix:** возвращать `new Response('Internal Server Error', { status: 500 })`. Полные детали — только в server-лог.

### P0-03 · Нет Row-Level Security на уровне Postgres
Нет ни одного `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` в `drizzle/` или `supabase/`. Tenant-isolation опирается **только** на функцию [`requireTenantAccess`](../src/lib/auth/tenant-access.ts#L42) и дисциплину разработчиков в каждом запросе добавлять `.where(eq(table.tenantId, ...))`.

Одна забытая проверка или SQL-инъекция через Drizzle (сейчас их нет, но на горизонте год риск ненулевой) — и произойдёт cross-tenant data leak. В enterprise SaaS это недопустимо.

**Fix (defense in depth):**
1. Создать роль `app_rls` с ограниченными привилегиями.
2. На всех таблицах с `tenant_id` включить RLS:
   ```sql
   ALTER TABLE raw_api_orders ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON raw_api_orders
     USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
   ```
3. В middleware/хелпере перед каждым запросом: `SET LOCAL app.tenant_id = $1`.
4. Даже если приложение ходит под более привилегированной ролью, RLS останется защитой в случае новой дыры.

Приоритетные таблицы (все с `tenant_id`): 42 шт. — см. `src/lib/db/schema.ts`.

### P0-04 · Отсутствие индексов на больших raw-таблицах
**Файл:** [`src/lib/db/schema.ts`](../src/lib/db/schema.ts)

Верифицировано: у `rawApiOrders` единственный индекс — `PRIMARY KEY (srid)`. Нет `(tenant_id, date)`. Та же проблема у `rawApiRealizationReports`, `rawApiSales`.

Дашборд фильтрует по `tenant_id + диапазон дат` — это **full-table scan** на многогигабайтных таблицах. На текущих 94 MB сейчас незаметно, но к середине пилота (10 тенантов, 3 месяца истории) SQL ляжет в 20–30 сек и connection pool выдохнется.

**Fix:** новая миграция с `CREATE INDEX CONCURRENTLY`:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_orders_tenant_date
  ON raw_api_orders (tenant_id, date DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_reports_tenant_period
  ON raw_api_realization_reports (tenant_id, date_from, date_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_sales_tenant_date
  ON raw_api_sales (tenant_id, date DESC);
```
Обязательно `CONCURRENTLY`, чтобы не заблокировать writes. Drizzle миграции не поддерживают `CONCURRENTLY` напрямую — нужно писать raw SQL миграцию вне drizzle-kit.

### P0-05 · Postgres connection pool не сконфигурирован
**Файл:** [`src/lib/db/index.ts:5-10`](../src/lib/db/index.ts#L5-L10)

```ts
const client = postgres(connectionString, { prepare: false });
```

Нет `max`, `idle_timeout`, `connect_timeout`, `max_lifetime`. Дефолты `postgres` npm: `max: 10`, `idle_timeout: 0` (никогда не отпускает). На сервере с 5.8 Gi RAM, где БД и Next в одном хосте, это приведёт к Connection exhausted при средней нагрузке.

**Fix:**
```ts
const client = postgres(connectionString, {
  prepare: false,
  max: Number(process.env.PG_POOL_MAX ?? 15),
  idle_timeout: 20,        // sec
  max_lifetime: 60 * 30,   // sec
  connect_timeout: 10,     // sec
  onnotice: () => {},
});
```
Плюс на стороне Postgres в `postgresql.conf` / ALTER SYSTEM:
```sql
ALTER SYSTEM SET statement_timeout = '30s';
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
SELECT pg_reload_conf();
```

### P0-06 · Инфраструктура не проходит enterprise-SLA
Текущее состояние на `goalbot`:
- 5.8 Gi RAM, уже 2.2 Gi swap used → нет запаса для пиков.
- Диск 82% used (92 / 119 GB) → бэкапы и логи будут упираться в место ещё до миграции на прод.
- Web + Inngest + Postgres + Supabase + Playwright RPA + novnc/xvfb — всё на одной ноде. Один OOM убьёт всё.
- ~~Cloudflared Quick Tunnel вместо нормального DNS+TLS~~ **RESOLVED**: nginx reverse-proxy with Let's Encrypt TLS for `про-цифры.рф` / `процифры.рф`, DNS A-record direct to server. Cloudflared quick tunnel service still running but NOT in production chain (legacy/dev convenience).
- В `render.yaml` описан `starter` план Render, который не используется в реальности. Репо противоречит прод-деплою.

**Fix (варианты):**
1. **Мин. улучшение на текущем железе:** добавить диск, увеличить swap, разнести supabase/postgres контейнеры по ресурсам через systemd `MemoryMax=`, настроить `logrotate`, убрать `render.yaml`/`Dockerfile` из репо (или честно задокументировать как «план миграции»).
2. **Правильное enterprise-решение:** выделить роли:
   - `web` (Next.js standalone) — 2 vCPU, 4 GB
   - `worker` (Inngest + RPA + Playwright + xvfb) — 2 vCPU, 4 GB, отдельный диск под `./output`
   - `db` (managed Postgres) — с бэкапами, мониторингом, репликой
   - `supabase` — либо managed Supabase, либо выделенная нода
   - DNS + TLS already in place (Let's Encrypt via nginx); consider Cloudflare proxy for DDoS protection

Конкретное решение — бизнес-вопрос. В чек-лист фиксируем задачу «определиться с целевой топологией и задокументировать».

### P0-07 · Нет CI/CD
`.github/workflows/` не существует. Нет pre-commit hooks. Deploy на сервер идёт через ручной `git pull` + `systemctl restart`. Любой push в `main` с падающими тестами или битой сборкой улетит в прод без единой защиты.

**Fix:**
1. Создать `.github/workflows/ci.yml`:
   ```yaml
   on: [pull_request, push]
   jobs:
     verify:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '22' }
         - run: npm ci
         - run: npm run lint
         - run: npm run test
         - run: npm run build
   ```
2. Защита ветки `main` в настройках GitHub: required status checks, no force-push, required review.
3. На сервере — вместо ручного pull оформить `deploy.sh` с проверками: `git fetch`, `git log` сравнение с PR status, `systemctl reload`.

### P0-08 · Нулевая observability
`grep -r "Sentry\|@opentelemetry\|pino\|winston" src/` → пусто. Весь логинг — через `console.log/warn/error`. Никаких correlation IDs, метрик, traces, alert'ов.

Когда продадите первому клиенту и у него ночью упадёт sync WB API — вы узнаете об этом из Telegram от оператора, а не из алерта. Это не enterprise-ready.

**Fix (минимальный набор):**
1. Sentry (self-hosted GlitchTip если нужен on-premise, либо Sentry SaaS) — на фронт и бэк. `Sentry.captureException` во всех catch блоках API routes и Inngest `step.run`.
2. Structured logging через `pino` — заменить `console.*` на `logger.*` с correlation ID (сгенерированным в middleware).
3. Метрики Prometheus через Next instrumentation.ts: request count, latency p95/p99, Inngest step success rate, sync freshness по тенантам.
4. Alert: `max(sync_runs.finishedAt) < now() - interval '6 hours'` → Telegram.

---

## 4. P1 — High (первые 2 недели пилота)

### P1-09 · ENCRYPTION_KEY derivation без HKDF
**Файл:** [`src/lib/encryption.ts:18-27`](../src/lib/encryption.ts#L18-L27)

Берутся первые 32 байта UTF-8 строки. Для ASCII ок (32 символа = 32 байта = 256 бит), но формат не принуждает — в `.env.example` подсказка «replace-with-32-byte-secret», эмодзи/кириллица дадут переменный байт-count и потерю энтропии.

**Fix:** требовать hex64 или base64; `Buffer.from(keyRaw, 'hex')`; временно поддержать старый формат для миграции, параллельно написать CLI `scripts/rotate-encryption-key.mjs`.

Дополнительно: [`decryptIfNeeded`](../src/lib/encryption.ts#L54-L71) при ошибке возвращает исходную строку — молчаливая коррупция. Должен кидать явную ошибку с tenantId в контексте.

### P1-10 · Inngest signing key — нет явной привязки
**Файлы:**
- [`src/app/api/inngest/route.ts:7-13`](../src/app/api/inngest/route.ts#L7-L13) — `serve({ client, functions: [...] })` без явного `signingKey`.
- [`src/inngest/client.ts:8`](../src/inngest/client.ts#L8) — `eventKey: ... ?? (isDevRuntime ? "local-dev" : undefined)`.

Inngest SDK v4 читает `INNGEST_SIGNING_KEY` из env автоматически, но:
- нет fail-fast в prod при отсутствии ключа;
- dev-флаг `INNGEST_DEV=1` случайно в прод → клиент примет любые события.

**Fix:** явно передавать `signingKey` в `serve()`, добавить проверку `if (NODE_ENV === 'production' && !INNGEST_SIGNING_KEY) throw`, включить в `/api/health`.

### P1-11 · Rate limiting отсутствует
Нет ни одного middleware/обёртки для rate-limit. Публичные/полупубличные endpoints:
- `/api/bot` (Telegram webhook)
- `/api/inngest` (fan-out)
- `/api/views/reviews-qa/reply` (POST, вызов LLM = деньги)
- `/api/views/redistribution/run-create` (POST, тяжёлые run-ы)
- `/api/health` (разведка)

**Fix:** `@upstash/ratelimit` + Upstash Redis (или in-memory LRU для старта). Per-IP ≥ 60 req/min, per-tenant ≥ 10 mutation POST/min. Применить через `proxy.ts` middleware.

### P1-12 · User enumeration на login
**Файл:** [`src/app/(auth)/login/actions.ts:38-40`](../src/app/(auth)/login/actions.ts#L38-L40)

```ts
if (error) {
  redirect('/login?message=' + encodeURIComponent(error.message))
}
```

Supabase возвращает разные тексты для `Invalid login credentials`, `Email not confirmed`, `User not found`. По ответам можно выяснить, какие email зарегистрированы.

**Fix:** единое сообщение «Неверный email или пароль» для всех auth-ошибок. Отдельно — маркировать неподтверждённые email (без раскрытия факта существования).

Плюс: `FormData` не валидируется zod. Ввести `z.email()` / `z.string().min(8)`.

### P1-13 · `requireTenantAccessFromRequest` — tenantId из query-string
**Файл:** [`src/lib/auth/tenant-access.ts:70-76`](../src/lib/auth/tenant-access.ts#L70-L76)

Сама проверка членства корректна, но паттерн `?tenantId=...` в GET ведёт к:
- утечкам tenantId в logs / referrer headers / browser history;
- лёгким ошибкам при copy-paste ссылок между тенантами;
- трудностям аудита «кто что смотрел».

**Fix:** перенести активный tenant в серверную куку (подписанную) либо в Supabase user metadata. URL-параметр оставить только для переключения.

### P1-14 · Нет idempotency на mutation POST
Routes: [`redistribution/run-create`](../src/app/api/views/redistribution/run-create/route.ts), [`reviews-qa/publish`](../src/app/api/views/reviews-qa/publish/route.ts), bid-changes. Повторный POST из-за сетевой ошибки может создать дубли run-ов, отправить второй ответ на WB, сдвинуть ставку дважды.

**Fix:** принимать `Idempotency-Key` header, кешировать результат в БД 24 часа.

### P1-15 · Гонка при одновременном старте sync_runs
**Файл:** [`src/server/jobs/wb-scheduled-sync.ts:106-123`](../src/server/jobs/wb-scheduled-sync.ts#L106-L123)

Два запуска могут просклизнуть одновременно (check-then-act).

**Fix:** unique partial index:
```sql
CREATE UNIQUE INDEX sync_runs_one_active_per_tenant
  ON sync_runs (tenant_id)
  WHERE status IN ('pending', 'running');
```
Или `pg_advisory_xact_lock(hashtext(tenant_id::text))` внутри транзакции.

### P1-16 · Inngest concurrency не лимитирована
В `inngestFunctions` нет `concurrency: { limit: N, key: event.data.tenantId }`. Fast-profile cron каждый час × много тенантов → все стартуют параллельно, выдыхают connection pool и WB rate limit.

**Fix:** для `syncWildberriesData` `concurrency: { limit: 3, key: "event.data.tenantId" }` и global `{ limit: 10 }`.

### P1-17 · Нет dead letters / alerts на последнем retry
Inngest retry-логика есть, но финальный failure только пишет в console.error. Оператор узнает о проблеме из следующего ручного обновления дашборда, а не из push-уведомления.

**Fix:** в Inngest function добавить `onFailure` handler → отправлять alert через BotService в оперативный канал. Плюс stale-freshness алерт (см. P0-08).

### P1-18 · Raw errors в ответах `/api/views/**`
Общий паттерн `return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 })` раскрывает имена таблиц/колонок и SQL-фрагменты.

**Fix:** `getErrorMessage` должен возвращать детальное сообщение **только** для `AppError` (известного подкласса), иначе константу `'Internal Server Error'`. Полное логирование — только server-side.

### P1-19 · RPA storage state в plaintext
**Env:** `WB_RPA_STORAGE_STATE_PATH=./output/wb-rpa/sessions/{tenantId}.json`. Playwright пишет `cookies + localStorage + sessionStorage` в plain JSON на диск. Если сервер скомпрометирован или бэкап утечёт — все WB-сессии клиентов у атакующего + lateral movement в seller.wildberries.ru.

**Fix:** шифровать файл через `encryption.ts` перед записью, хранить зашифрованный blob в БД (колонка `tenants.wb_rpa_storage_state`), TTL 7 дней. Файл на диске — временный, только для активной RPA-сессии, удаляется после.

### P1-20 · Подозрительная версия `lucide-react@1.7.0`
В `package-lock.json` integrity hash присутствует, пакет реально установлен. Но `lucide-react` 1.x — legacy ветка до rebrand. Современные проекты используют `lucide-react@^0.5xx`. Почти наверняка опечатка/конфлюкс.

**Fix:** проверить реально используемые иконки, мигрировать на актуальную `^0.4xx+`. Тесты визуально.

### P1-21 · `xlsx@0.18.5` — SheetJS больше не в npm, были CVE
Пакет 0.18.5 — последний опубликованный в npm. Актуальные 1.x только через CDN sheetjs.com (proprietary). Исторические CVE: GHSA-4r6h-8v6p-xvw6 (Prototype Pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS). В enterprise-аудитах это красный флаг — supply chain risk + отсутствие патчей.

**Fix:** мигрировать на `exceljs` (open source, maintained) или купить SheetJS Pro. Минимум — задокументировать принятый риск в threat model и ограничить xlsx только read-only операциями.

---

## 5. P2 — Medium (первый месяц после запуска)

### P2-22 · Dashboard pages почти все `'use client'`
10 из 11 `src/app/(dashboard)/**/page.tsx` начинаются с `'use client'`. Единственное исключение — `economics/page.tsx` (простой redirect).

**Последствия:** тяжёлые страницы целиком уезжают в JS bundle; нельзя делать server-side preloading; auth/tenant проверяется только через отдельные `/api/views/*` запросы; SEO и first paint страдают.

**Fix (итеративный):** Server Component `page.tsx` делает `requireTenantAccess` + preload data, затем рендерит `<ClientOnlyWidget initialData={...} />`. Начать с `overview`, `economics-template`, `stocks`.

### P2-23 · Монолитные компоненты без виртуализации
Верифицировано:
- [`AdvertisingWorkspace.tsx` — 4190 строк](../src/components/advertising/AdvertisingWorkspace.tsx)
- [`UnitEconomicsTemplateTable.tsx` — 4214 строк](../src/components/dashboard/UnitEconomicsTemplateTable.tsx)
- [`SignalsFeed.tsx` — 3394 строк](../src/components/dashboard/SignalsFeed.tsx)
- [`SignalDetailsPanel.tsx` — 1100 строк](../src/components/dashboard/SignalDetailsPanel.tsx)
- [`DynamicsTable.tsx` — 839 строк](../src/components/dashboard/DynamicsTable.tsx)

Таблицы рендерят все строки в DOM. При 500+ SKU — лаги. Один ререндер родителя — полная пересборка дерева.

**Fix:** `@tanstack/react-virtual` для таблиц > 100 rows; `React.memo` на строки; декомпозиция на контейнер + presentational; тяжёлые панели через `next/dynamic`.

### P2-24 · Coverage vitest — только 2 файла
[`vitest.config.ts:17-22`](../vitest.config.ts#L17-L22) включает в покрытие только `operator-signal-timeline.ts` и `signal-queue-utils.ts`. Всего тестов — **5 файлов**.

Критические пути БЕЗ тестов: auth, tenant-access, encryption, почти все API routes, redistribution-планирование, **self-learning autobidder (новый P1-feature!)**, сервисы Telegram.

**Fix (минимум):**
- unit: `tenant-access`, `encryption`
- integration: WB-sync happy path + retention fallback
- contract: bot webhook (валидный/невалидный secret)
- e2e через Playwright: auth flow + dashboard smoke

### P2-25 · Нет `error.tsx`/`loading.tsx`/`not-found.tsx`
`find src/app -name "error.tsx"` → пусто. Любая ошибка в RSC (истёк WB token, упала БД) → белый экран.

**Fix:** `src/app/(dashboard)/error.tsx` + `global-error.tsx` с Sentry-интеграцией.

### P2-26 · CSV/Excel экспорт на локальный диск
`REDISTRIBUTION_OUTPUT_DIR=./output/redistribution`. Каждый redeploy = потеря файлов. Файлы cross-tenant в одной папке — неавторизованный access возможен при misconfiguration.

**Fix:** S3/R2-совместимое хранилище (или Postgres `bytea`). Отдать через authenticated endpoint, проверяющий tenant-ownership.

### P2-27 · Playwright в web standalone bundle
[`next.config.ts:4-9`](../next.config.ts#L4-L9) включает `playwright/**` в `outputFileTracingIncludes`. Образ раздувается на 200–300 MB. Web-сервис не нуждается в Playwright — только RPA-worker.

**Fix:** разделить `web` и `rpa-worker` как отдельные Next apps/сервисы, `outputFileTracingIncludes` оставить только на worker. Либо хранить Playwright в отдельном контейнере и вызывать через IPC/очередь.

### P2-28 · Непоследовательные FK `onDelete` политики
Часть таблиц — `cascade`, часть — без явной политики (PostgreSQL defaults to `NO ACTION`). При удалении тенанта часть raw-данных осиротеет, что усложнит GDPR-запросы на полное удаление.

**Fix:** аудит всех `.references(() => ...)` в [`schema.ts`](../src/lib/db/schema.ts), зафиксировать политику: tenant-специфичные → `cascade`, справочники → `restrict`.

### P2-29 · `DATABASE_URL` без SSL-требования
В `postgres(...)` клиенте нет `ssl: 'require'`. Локальный сокет сейчас — ок, но при переносе БД на managed-сервис это must-have.

**Fix:**
```ts
ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
```

### P2-30 · Нет security headers (CSP, HSTS, X-Frame-Options)
В `next.config.ts` нет `headers()`. Для SaaS с внешними картинками WB и potential embed-скриптами нужен хотя бы базовый CSP.

**Fix:**
```ts
headers: async () => [{
  source: '/(.*)',
  headers: [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ],
}]
```

### P2-31 · Zod-валидация непоследовательна
`reviews-qa` использует zod, `advertising` / `redistribution` / `dashboard` — `searchParams.get('from')` + ручной парсинг. URL-параметры типа `[signalId]` не валидируются как UUID.

**Fix:** ввести хелпер `parseRequestQuery<T>(req, schema)` / `parseRequestBody<T>(req, schema)` и применять везде. `tenantId: z.string().uuid()` строго.

### P2-32 · tsconfig без `noUncheckedIndexedAccess`
Массовые array-accesses без проверок. Для enterprise-quality стоит включить.

**Fix:** добавить в `tsconfig.json`:
```json
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true
```
Прогнать `tsc --noEmit`, пофиксить пачкой по директориям.

### P2-33 · `.env.production:25` ломается при bash source
`WB_RPA_LOGIN_URL=https://...?redirect_url=...&fromSellerLanding` — URL без кавычек. Для systemd `EnvironmentFile=` работает, но `source .env.production` в bash-скриптах падает на `&fromSellerLanding: command not found`.

**Fix:** обернуть все env-значения с `&`, `;`, `?`, `$`, `#`, spaces в двойные кавычки. Добавить в CI проверку `grep -n '[&;$#?]' .env.production` + предупреждение.

---

## 6. P3 — Low / nice-to-have

- **P3-34 · `/api/health` проверяет только env + `SELECT 1`.** Добавить ping Supabase auth admin API и Inngest connectivity, вернуть детальные checks.
- **P3-35 · Нет automated DB backups cron.** `scripts/nightly-db-backup.mjs` есть, но не подключён в systemd timer. Добавить `enterprise-wb-analytics-db-backup.timer`.
- **P3-36 · Нет i18n.** Интерфейс целиком на русском строками в TSX. Если будете расширять за границы — критично.
- **P3-37 · A11y gaps.** `<th>` без `scope`, иконочные кнопки без `aria-label`, нет focus-trap в модалях `SignalDetailsPanel`.
- **P3-38 · Dependabot/Renovate не настроен.** Зависимости не обновляются автоматически.
- **P3-39 · Telegram update replay.** Нет timestamp/`update_id` дедупликации. При ретраях Telegram один update может обработаться дважды.
- **P3-40 · ESLint baseline может быть грязный.** CI должен упасть на warnings, а не игнорировать их.
- **P3-41 · `next-themes` flash.** Проверить, нет ли мигания при переключении темы (SSR hydration).
- **P3-42 · `render.yaml` + `Dockerfile` vs реальный bare-metal деплой.** Либо удалить, либо задокументировать как «plan B».

---

## 7. Что сделано хорошо (strengths)

1. **Чистый TypeScript strict.** 154 файла, всего 4 `: any`, 5 `as any`, **0** `@ts-ignore`. Это редкость.
2. **Нет SQL injection.** Drizzle везде параметризован. `sql.raw(userInput)` не обнаружен. `dangerouslySetInnerHTML` — 0 совпадений.
3. **Схема tenancy консистентна.** 124 упоминания `tenantId` в `schema.ts`, практически все таблицы scoped по тенанту, FK на `tenants.id` с `cascade`.
4. **Единая точка tenant-access.** `requireTenantAccess` используется всеми public routes (единственный легитимный exception — `/api/health`).
5. **WB API client с тестами.** `src/lib/wb-api/index.ts` + `src/lib/wb-api/index.test.ts` — retry/backoff/Retry-After/timeout/chunking, `getPaidStorage` с отдельным timeout, кэш ad campaigns.
6. **Snapshot retention fallback (P61).** Зрелая работа над устойчивостью к флаками WB API: skipped + retained_previous_snapshot.
7. **Telegram webhook: timingSafeEqual.** Правильная защита от timing attack (если только secret задан, см. P0-01).
8. **Supabase SSR: `getUser()`, а не `getSession()`.** Правильно — валидирует токен у Supabase, а не доверяет куки.
9. **AES-256-GCM с random IV и authTag.** Алгоритм выбран правильно. Слабое место — только деривация ключа (P1-09).
10. **Честный CHANGELOG.** Видны осмысленные итерации, фиксы признаются по именам багов, продукт эволюционирует.
11. **Классификация sync-ошибок.** `wb_token_invalid`, `wb_auth_failed`, `wb_upstream_error`, `network_error`, `unknown_error` — хорошая основа для targeted remediation.
12. **Inngest step.run per source.** Ошибка одного источника не валит весь sync pipeline. Хорошая изоляция.
13. **`proxy.ts` matcher исключает `/api`.** С комментарием почему (webhook'и и Inngest) — правильно и задокументировано.
14. **Stale-run автозакрытие.** `WB_SYNC_STALE_TIMEOUT_MINUTES` + метка `[sync_run_stale_timeout]` — зрелое решение висящих sync.
15. **Self-learning autopilot (P62).** Амбициозный бизнес-функционал с транспарентной телеметрией, position-aware actions, guardrails, run history, retest cycle. Это отличает продукт от конкурентов.

---

## 8. Методология и ограничения аудита

**Что проверено:**
- Исходный код (статический анализ + grep по ~150 файлам).
- Файлы конфигурации: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `drizzle.config.ts`, `render.yaml`, `Dockerfile`, `.env.example`.
- Состояние сервера `goalbot`: systemd сервисы, БД размер и структура, env, git parity.
- Все 39 API routes, все Inngest функции, все миграции drizzle.
- Ключевые хелперы: encryption, tenant-access, db client, supabase middleware.
- 6 параллельных специализированных агентов для разных аспектов (security, DB, API, jobs/WB, frontend, DevOps).

**Что НЕ проверено в этом проходе:**
- Dynamic security testing (fuzz API, OWASP ZAP, SQLMap).
- Load testing / performance profiling под нагрузкой.
- Penetration testing внешним аудитором.
- Compliance (152-ФЗ, GDPR) — только упомянут риск.
- Полный bundle size analysis клиентского JS.
- A11y audit через axe / Lighthouse accessibility score.
- Детальный анализ business logic ad-autopilot на корректность (нужен product-owner review).

**Ограничения:**
- Аудит делался в 1 заход за ~2 часа. Некоторые находки могут быть ложно-положительными или пропущенными.
- Агенты иногда галлюцинируют конкретные строки — все P0/P1 находки верифицированы мной вручную по исходнику.

---

## 9. Приложения

- Полный чек-лист с приоритетами и статусами: [`ENTERPRISE_LAUNCH_CHECKLIST.md`](./ENTERPRISE_LAUNCH_CHECKLIST.md)
- Threat model (STRIDE): [`THREAT_MODEL.md`](./THREAT_MODEL.md)
- Runbook инцидентов: [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md)
- Существующий бэкап: `~/Desktop/Боты/РНП_Gemini/enterprise-wb-analytics-backups/pre-audit-20260415-224500/`
  - `database.dump` — pg_dump custom binary format, 6.4 MB
  - `project-files.tar.gz` — исходники без node_modules, 7.5 MB
  - `env-files.tar.gz` — `.env.production + .env.runtime + .env.example`, mode 600
  - `repo-all-refs.bundle` — git bundle со всеми ветками
  - `systemd/*.service` — копии unit-файлов
  - `checksums.sha256` — проверены ✓
- Локальная git-ветка со снапшотом: `backup/pre-audit-fixes-20260415-2245` (от main@7419e54)
