# Ozon Integration Plan

Last updated: 2026-05-14.

## Goal

Добавить Ozon как второй маркетплейс в один личный кабинет продавца, не превращая
его в расширение Wildberries-кода.

Целевая UX-модель:

- селлер входит один раз;
- видит свои рабочие пространства/магазины;
- сверху или в sidebar выбирает маркетплейс: `Wildberries` или `Ozon`;
- при выборе WB открывается текущий WB-интерфейс;
- при выборе Ozon открывается отдельный интерфейс Ozon со своим меню,
  источниками, статусами, экономикой и операционными сценариями;
- общими остаются auth, команда, подписка, админка, аудит, уведомления и
  будущая cross-marketplace сводка.

## Core Product Decision

Не делать "WB + ещё один токен Ozon" в таблице `tenants`.

Правильная модель:

- `tenant` остается клиентским рабочим пространством / бизнесом продавца;
- внутри tenant может быть несколько marketplace-подключений;
- каждое подключение имеет тип площадки, свои креды, health, sync runs и raw
  данные;
- WB и Ozon имеют разные интерфейсы и разные меню;
- общая аналитика строится только поверх нормализованного слоя, а не напрямую
  из WB/Ozon raw-таблиц.

Причина: WB использует `nmId`, Ozon использует `product_id`, `offer_id`, `sku`.
Если смешать их в текущем `products.nm_id`, мы быстро сломаем каталог,
остатки, рекламу и unit economics.

## Current Baseline

Сейчас проект WB-центричный:

- `tenants.wb_api_token` хранит WB API token;
- `products.nm_id` является главным товарным идентификатором;
- raw-таблицы называются `raw_api_*`, но фактически являются WB-источниками;
- ingestion живет в `src/inngest/sync-wb.ts`;
- API-клиент живет в `src/lib/wb-api`;
- текущие dashboard pages рассчитаны на WB-методологию.

Это нормальная база для WB, но не для Ozon. Интеграцию нужно делать через
эволюцию платформенного слоя.

## UX Architecture

### App Shell

В верхнем уровне интерфейса нужен marketplace switcher:

- `Wildberries`
- `Ozon`
- позже: `Все площадки` для сводных отчетов

Первый этап без большой переделки маршрутов:

- текущие WB routes остаются как есть: `/overview`, `/economics`, `/stocks-v2`,
  `/advertising`, `/reviews-qa`, `/settings`;
- добавляются Ozon routes под отдельным namespace: `/ozon/overview`,
  `/ozon/products`, `/ozon/orders`, `/ozon/stocks`, `/ozon/finance`,
  `/ozon/reviews`, `/ozon/settings`;
- switcher редиректит на landing выбранной площадки;
- активное marketplace-подключение хранится отдельно от `active_tenant_id`.

Дальше можно привести маршруты к единой модели, но не в MVP.

### Ozon Menu MVP

Ozon-интерфейс не должен копировать WB-меню. Минимальное меню:

- `Обзор` — продажи, заказы, остатки, финансы, ошибки sync;
- `Товары` — Ozon products, offer_id, sku, цены, статусы, видимость;
- `Заказы` — FBO/FBS отправления и статусы;
- `Остатки` — FBO/FBS остатки, склады, оборачиваемость;
- `Финансы` — транзакции, реализации, отчеты, комиссии, выплаты;
- `Отзывы и вопросы` — если доступно по тарифу/правам Ozon;
- `Настройки Ozon` — Client-Id, Api-Key, preflight, sync history.

Не добавлять рекламный автопилот в первый Ozon MVP. Реклама Ozon живет через
Performance API и должна идти отдельным этапом.

## Data Model

### New Tables

Минимальный платформенный слой:

```text
marketplace_accounts
- id
- tenant_id
- marketplace: wildberries | ozon
- display_name
- external_seller_id / company_id nullable
- status: active | warning | invalid | disabled
- health_status
- health_checked_at
- health_summary jsonb
- credentials_encrypted jsonb/text
- created_at
- updated_at
```

```text
marketplace_account_settings
- marketplace_account_id
- settings jsonb
```

```text
marketplace_product_links
- id
- tenant_id
- marketplace_account_id
- marketplace
- external_product_id
- offer_id nullable
- sku nullable
- wb_nm_id nullable
- title
- vendor_code nullable
- barcode nullable
- brand nullable
- category nullable
- photo_url nullable
- status
- raw jsonb
```

Для Ozon raw MVP:

```text
raw_ozon_products
raw_ozon_prices
raw_ozon_stocks
raw_ozon_postings_fbo
raw_ozon_postings_fbs
raw_ozon_finance_transactions
raw_ozon_finance_realization
raw_ozon_reports
raw_ozon_returns
raw_ozon_reviews
raw_ozon_questions
```

Для новых общих отчетов:

```text
marketplace_fact_orders
marketplace_fact_sales
marketplace_fact_stocks
marketplace_fact_finance_operations
marketplace_fact_ad_spend
```

Важно: WB raw-таблицы на первом этапе не мигрировать массово. Сначала добавить
`marketplace_accounts` и создать WB account для каждого текущего tenant. Новые
Ozon-таблицы делать правильно сразу.

### Sync Runs

Текущий `sync_runs` привязан к `tenant_id`. Для Ozon нужен новый nullable field:

```text
marketplace_account_id uuid null
marketplace varchar default 'wildberries'
```

Это позволит не ломать существующую WB history и добавить Ozon history рядом.

## Ozon API Client

Создать `src/lib/ozon-api` по аналогии с `src/lib/wb-api`, но без копирования
WB-специфики.

Обязательные элементы:

- `OzonApiError` с `status`, `code`, `details`, `operation`, `retryable`;
- `fetchWithOzonBackoff`;
- таймауты на уровне операции;
- per-operation throttle;
- поддержка `Client-Id` и `Api-Key`;
- аккуратное логирование без секретов;
- unit tests через mock fetch;
- typed DTO только для реально используемых endpoint-ов.

Не подключать сторонний SDK как production dependency на первом этапе. GitHub
клиенты полезны как reference, но не как runtime-контракт.

## Ozon API MVP Matrix

Read-only MVP:

| Area | Endpoint family | Purpose |
| --- | --- | --- |
| Auth/preflight | seller/product lightweight calls | Проверка `Client-Id` + `Api-Key` |
| Products | Product API | Каталог, `product_id`, `offer_id`, `sku`, статус |
| Prices/stocks | Prices & Stocks API | Цены, скидки, остатки |
| Orders FBO | FBO postings | Заказы со склада Ozon |
| Orders FBS | FBS postings | Заказы со склада продавца |
| Finance | Finance API | Транзакции, реализации, итоги |
| Reports | Report API | Асинхронные отчеты и download URLs |
| Returns | Returns API | Возвраты |
| Reviews/questions | Review / Question API | Очередь клиентских обращений, если доступна |

Later:

| Area | API | Why later |
| --- | --- | --- |
| Ads | Performance API | Отдельная авторизация, лимиты, другая модель кампаний |
| Mutations | Product/price/stock writes | Нужны approvals, idempotency, read-after-write |
| Auto-actions | Ads/prices/replies | Нужны guardrails и аудит |

## Ozon Sync Design

Создать `src/inngest/sync-ozon.ts`.

Источники MVP:

```text
ozon_products
ozon_prices
ozon_stocks
ozon_postings_fbo
ozon_postings_fbs
ozon_finance_transactions
ozon_finance_realization
ozon_returns
ozon_reviews
ozon_questions
ozon_catalog_reconcile
```

Профили:

- fast: orders + stocks;
- medium: products + prices + returns;
- nightly: finance + reports + full catalog reconcile.

Правила:

- каждый source пишет source-level summary;
- recoverable ошибки не должны валить весь sync, если есть прошлый snapshot;
- 401/403 переводят connection в `invalid`/`warning`;
- все даты хранить с явным coverage;
- финансовые данные помечать как final/provisional, если источник это позволяет.

## Ozon Finance Methodology

Нельзя механически перенести WB PnL.

Для Ozon нужно отдельно описать:

- что считать заказом;
- что считать продажей;
- как учитывать возвраты;
- какие finance operation types входят в revenue/cost/commission/logistics;
- где появляется acquiring;
- как Ozon показывает realization и выплаты;
- какие периоды final, а какие provisional;
- как связать transactions с postings и sku.

Первый finance MVP:

- показать валовые продажи;
- показать комиссии/логистику/прочие удержания по finance transactions;
- показать выплату/начисления по отчетам;
- явно маркировать расхождения и незакрытые периоды.

Только после этого строить полноценную unit economics Ozon.

## Security

Ozon credentials — такой же critical secret, как WB token.

Требования:

- хранить encrypted через текущий `encrypt/decrypt`;
- не логировать `Api-Key`, `Client-Id`, Performance tokens;
- preflight перед сохранением;
- `save with warning` только для частичных доступов, не для явно неверных ключей;
- route/server action checks через `requireTenantAccess`;
- raw данные отдавать только через auth + tenant + marketplace account access;
- platform admin не видит секреты, только health/status.

## Implementation Slices

### OZ-00. Product and Architecture Plan

Status: `done` after this document is accepted.

Output:

- this plan;
- backlog link;
- no code changes.

### OZ-01. Marketplace Account Foundation

Goal:

- add marketplace account model;
- backfill one WB marketplace account per existing tenant;
- keep current WB flows working.

Files:

- `src/lib/db/schema.ts`
- `drizzle/*`
- settings/server actions
- tenant switcher/store

Checks:

- migration check;
- typecheck;
- existing WB token settings smoke.

### OZ-02. App Shell Switcher

Goal:

- add UI switcher between WB and Ozon;
- keep current WB routes stable;
- add empty Ozon shell with its own menu.

Output:

- Ozon pages render empty/connection-required states;
- no Ozon API calls yet.

### OZ-03. Ozon API Client and Preflight

Goal:

- implement `src/lib/ozon-api`;
- add Ozon settings card;
- validate `Client-Id` + `Api-Key`.

Checks:

- mocked API tests for success, 401, 403, 429, 5xx, timeout;
- no secret leak in errors/logs.

### OZ-04. Ozon Read-only Sync MVP

Goal:

- sync products, prices, stocks, FBO/FBS postings;
- persist raw Ozon tables;
- show source-level sync history.

Checks:

- unit tests for mapping/dedupe;
- local sync against mock payloads;
- real sync only with explicit test credentials.

### OZ-05. Ozon Dashboard MVP

Goal:

- `/ozon/overview`, `/ozon/products`, `/ozon/orders`, `/ozon/stocks`;
- platform-specific labels and statuses;
- no copied WB economics assumptions.

### OZ-06. Ozon Finance MVP

Goal:

- finance transaction ingestion;
- realization/report ingestion;
- first Ozon finance screen with coverage and reconciliation notes.

### OZ-07. Ozon Reviews and Questions

Goal:

- read queue;
- draft replies through existing AI layer if enabled;
- publish replies only after explicit approval.

### OZ-08. Performance API Research and Ads Plan

Goal:

- separate research and plan for Ozon ads;
- decide whether first version is read-only reporting or controlled actions;
- do not reuse WB advertising autopilot blindly.

## MVP Definition

MVP is complete when:

- existing WB user can still work as before;
- same user can add Ozon connection in settings;
- marketplace switcher opens Ozon workspace;
- Ozon products/orders/stocks/finance sync works read-only;
- Ozon pages show data freshness and source errors;
- no Ozon secret leaks in UI/logs;
- no WB calculations silently applied to Ozon finance.

## Non-goals For MVP

- no shared WB+Ozon profit dashboard until normalized facts are stable;
- no Ozon ad autopilot;
- no price/stock write actions;
- no automatic reply publishing;
- no mass migration of existing WB raw tables;
- no route rewrite of the whole dashboard.

## Open Questions

- Первый Ozon use case: FBO, FBS или оба?
- Нужна ли поддержка нескольких Ozon магазинов внутри одного tenant на старте?
- Есть ли у пилотного клиента доступ к Ozon Premium Plus для reviews API?
- Нужно ли сразу подключать Ozon Performance API или сначала закрыть продажи,
  остатки и финансы?
- Как пользователь должен видеть cross-marketplace сводку: отдельная вкладка
  `Все площадки` или виджет на главной?

## Sources

- Ozon Seller API intro: https://docs.ozon.com/global/api/intro/
- Ozon product upload via API: https://docs.ozon.com/global/api/via-api/
- Ozon Performance API: https://docs.ozon.com/global/api/perfomance-api/
- Ozon analytics charts: https://docs.ozon.com/global/analytics/analytics-and-metrics/charts/
- Ozon seller contract and final documents timing:
  https://docs.ozon.com/global/contracts-for-sellers-omk/dogovor-omk/
- GitHub reference, Python client:
  https://github.com/irenicaa/ozon-seller
- GitHub reference, Go client:
  https://github.com/diPhantxm/ozon-api-client
- GitHub reference, TypeScript client:
  https://github.com/salacoste/ozon-daytona-seller-api
