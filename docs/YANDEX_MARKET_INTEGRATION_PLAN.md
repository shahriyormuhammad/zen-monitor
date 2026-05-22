# Yandex Market Integration Plan

Last updated: 2026-05-14.

## Goal

Добавить Яндекс Маркет как отдельную площадку в общий личный кабинет селлера:

- селлер входит один раз;
- видит свои рабочие пространства и подключения маркетплейсов;
- выбирает площадку: `Wildberries`, `Ozon`, `Яндекс Маркет`;
- при выборе WB остается текущий WB-интерфейс;
- при выборе Ozon открывается отдельный Ozon workspace;
- при выборе Яндекс Маркета открывается отдельный интерфейс со своим меню,
  статусами, моделями размещения, отчетами и финансовой методологией;
- общими остаются auth, team, billing, platform admin, audit, notifications и
  будущая cross-marketplace сводка.

## Core Product Decision

Яндекс Маркет нельзя добавлять как "еще один токен" в текущую WB-модель.

Правильная модель:

- `tenant` остается клиентским рабочим пространством / бизнесом продавца;
- внутри tenant может быть несколько marketplace-подключений;
- `marketplace_account` хранит площадку, credentials, health, sync state и
  связь с tenant;
- для Яндекс Маркета внутри одного подключения нужен отдельный слой магазинов:
  `businessId` описывает кабинет, `campaignId` описывает магазин;
- WB, Ozon и Яндекс Маркет имеют разные интерфейсы и разные source-specific raw
  таблицы;
- общая аналитика строится только поверх нормализованных facts, а не напрямую
  из WB/Ozon/Yandex raw-источников.

Причина: у WB главный товарный идентификатор - `nmId`, у Ozon - связка
`product_id` / `offer_id` / `sku`, у Яндекс Маркета - `businessId`,
`campaignId`, `shopSku` / offer mappings и разные модели размещения. Если
смешать это в текущем `products.nm_id`, каталог, остатки, заказы и экономика
быстро станут неоднозначными.

## Current Baseline

Сейчас проект WB-центричный:

- `tenants.wb_api_token` хранит WB API token;
- `products.nm_id` является главным товарным идентификатором;
- raw-таблицы называются `raw_api_*`, но фактически отражают WB-источники;
- ingestion живет в `src/inngest/sync-wb.ts`;
- API-клиент живет в `src/lib/wb-api`;
- текущие dashboard pages рассчитаны на WB-методологию прибыли, заказов,
  остатков, рекламы и отзывов.

Это не блокер, но интеграцию Яндекс Маркета нужно вести через платформенный
слой marketplace accounts, а не через расширение существующего WB tenant.

## Yandex Market Model

Ключевая модель API:

- `businessId` - кабинет продавца;
- `campaignId` - магазин внутри кабинета;
- `GET /v2/campaigns` возвращает доступные кабинеты и магазины для токена;
- часть методов работает на уровне кабинета (`businessId`);
- часть методов работает на уровне магазина (`campaignId`);
- отчеты могут требовать `businessId`, `campaignId` или их комбинацию в
  зависимости от типа отчета;
- модели размещения различаются: FBY, FBS, Express, DBS, LaaS.

Для продукта это означает:

- один seller account в Яндекс Маркете может дать несколько магазинов;
- health должен проверять не только токен, но и `apiAvailability` каждого
  `campaignId`;
- интерфейс должен позволять выбрать магазин или смотреть кабинет целиком;
- sync должен хранить coverage и ошибки отдельно по account, shop и source;
- order/stock/finance логика должна учитывать модель размещения.

## UX Architecture

В верхнем уровне интерфейса нужен marketplace switcher:

- `Wildberries`
- `Ozon`
- `Яндекс Маркет`
- позже: `Все площадки`

Первый этап без глобального rewrite маршрутов:

- текущие WB routes остаются как есть;
- Ozon routes остаются под `/ozon/*`;
- Яндекс Маркет routes добавляются под `/yandex-market/*`;
- marketplace switcher редиректит на landing выбранной площадки;
- активное marketplace-подключение хранится отдельно от `active_tenant_id`;
- для Яндекс Маркета дополнительно нужен shop/campaign selector внутри
  workspace.

Минимальные routes:

```text
/yandex-market/overview
/yandex-market/products
/yandex-market/orders
/yandex-market/stocks
/yandex-market/prices
/yandex-market/finance
/yandex-market/reviews
/yandex-market/settings
```

## Yandex Market Menu MVP

Меню Яндекс Маркета не должно копировать WB или Ozon.

Минимальное меню:

- `Обзор` - продажи, заказы, остатки, финансы, ошибки sync, магазины;
- `Товары` - offer mappings, карточки, `shopSku`, категории, статусы;
- `Заказы` - заказы по `businessId`/`campaignId`, статусы, отгрузки, возвраты;
- `Остатки` - остатки по магазинам, складам и моделям размещения;
- `Цены и акции` - цены, price quarantine, рекомендации, промо;
- `Финансы` - отчеты, услуги Маркета, закрывающие документы, сверки;
- `Отзывы и вопросы` - feedback, questions, comments, chats;
- `Настройки Яндекс Маркета` - Api-Key, права, кабинеты, магазины, health,
  sync history.

Не добавлять управление ставками/бустом продаж в первый MVP. В API есть bids и
sales boost, но это отдельный контур с денежными side effects, approvals и
аудитом.

## Data Model

### Shared Marketplace Layer

Переиспользовать платформенную модель из Ozon-плана, но сразу заложить
поддержку магазинов внутри подключения:

```text
marketplace_accounts
- id
- tenant_id
- marketplace: wildberries | ozon | yandex_market
- display_name
- external_seller_id nullable
- external_business_id nullable
- status: active | warning | invalid | disabled
- health_status
- health_checked_at
- health_summary jsonb
- credentials_encrypted jsonb/text
- created_at
- updated_at
```

```text
marketplace_account_shops
- id
- tenant_id
- marketplace_account_id
- marketplace
- external_shop_id nullable
- external_campaign_id nullable
- display_name
- placement_model nullable
- api_availability nullable
- status
- settings jsonb
- raw jsonb
- created_at
- updated_at
```

Для Яндекс Маркета:

- `external_business_id` = `businessId`;
- `external_campaign_id` = `campaignId`;
- `api_availability` хранит статус доступности API магазина;
- `placement_model` хранит FBY/FBS/Express/DBS/LaaS, если API возвращает это в
  настройках/кампании.

### Product Links

Расширить общую связь товаров:

```text
marketplace_product_links
- id
- tenant_id
- marketplace_account_id
- marketplace_shop_id nullable
- marketplace
- external_product_id nullable
- offer_id nullable
- sku nullable
- shop_sku nullable
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

Для Яндекс Маркета главным операционным ключом в MVP считать `shopSku` +
`businessId`/`campaignId`, а не пытаться привести его к `nmId`.

### Yandex Market Raw Tables

Raw MVP:

```text
raw_yandex_market_campaigns
raw_yandex_market_campaign_settings
raw_yandex_market_offer_mappings
raw_yandex_market_offer_cards
raw_yandex_market_offer_prices
raw_yandex_market_offer_stocks
raw_yandex_market_orders
raw_yandex_market_returns
raw_yandex_market_reports
raw_yandex_market_finance_services
raw_yandex_market_closure_documents
raw_yandex_market_goods_feedback
raw_yandex_market_goods_questions
raw_yandex_market_chats
raw_yandex_market_promos
```

Для будущей общей аналитики:

```text
marketplace_fact_orders
marketplace_fact_sales
marketplace_fact_stocks
marketplace_fact_finance_operations
marketplace_fact_promotions
marketplace_fact_ad_spend
```

WB raw-таблицы на первом этапе не мигрировать массово. Сначала добавить общий
слой account/shop и backfill WB account для текущих tenants. Яндекс Маркет
делать через новую модель сразу.

### Sync Runs

`sync_runs` сейчас привязан к `tenant_id`. Для маркетплейсов нужен минимум:

```text
marketplace_account_id uuid null
marketplace_shop_id uuid null
marketplace varchar default 'wildberries'
source varchar
coverage_from date/timestamptz nullable
coverage_to date/timestamptz nullable
```

Это позволит хранить историю WB как раньше и добавить Яндекс Маркет без
смешивания магазинов и источников.

## Yandex Market API Client

Создать `src/lib/yandex-market-api`.

Обязательные элементы:

- base URL: `https://api.partner.market.yandex.ru`;
- auth через header `Api-Key`;
- OAuth не использовать в MVP, потому что для seller-интеграций официальные
  best practices рекомендуют Api-Key;
- `YandexMarketApiError` с `status`, `code`, `details`, `operation`,
  `retryable`, `campaignId`, `businessId`;
- `fetchWithYandexMarketBackoff`;
- таймауты на уровне операции;
- per-operation throttle, потому что лимиты различаются по методам;
- обработка 401/403 как invalid credentials / insufficient access;
- обработка campaign `apiAvailability` как отдельного health-сигнала;
- retry только для network/5xx/явных limit transient cases, не для обычных 4xx;
- unknown enum values не должны валить parsing;
- skip unknown fields, не полагаться на порядок полей;
- логирование без `Api-Key`;
- typed DTO только для реально используемых endpoint-ов.

Официальный OpenAPI repo использовать как источник контракта и для генерации
reference types, но не тащить сгенерированный SDK в production blindly.
Сторонние GitHub-клиенты можно использовать только как reference.

## Yandex Market API MVP Matrix

Read-only MVP:

| Area | Endpoint family | Purpose |
| --- | --- | --- |
| Auth/preflight | `/v2/auth/token`, `/v2/campaigns` | Проверить Api-Key, получить `businessId`, `campaignId`, права и магазины |
| Campaign health | `/v2/campaigns`, `/v2/campaigns/{campaignId}` | Проверить `apiAvailability`, статус магазина и доступ API |
| Settings | `/v2/businesses/{businessId}/settings`, `/v2/campaigns/{campaignId}/settings` | Настройки кабинета и магазина |
| Catalog | `/v2/businesses/{businessId}/offer-mappings`, `/offer-cards` | Товары, карточки, `shopSku`, категории, заполненность |
| Prices | `/v2/businesses/{businessId}/offer-prices`, `/v2/campaigns/{campaignId}/offer-prices` | Цены на уровне кабинета и магазина |
| Stocks | `/v2/campaigns/{campaignId}/offers/stocks`, reports | Остатки по магазинам и складам |
| Orders | `/v1/businesses/{businessId}/orders`, `/v2/campaigns/{campaignId}/orders` | Заказы, статусы, позиции, отгрузки |
| Returns | `/v2/campaigns/{campaignId}/returns`, `/v1/businesses/{businessId}/returns/decisions` | Невыкупы и возвраты |
| Reports | `/v2/reports/*/generate`, report info/download | Асинхронные отчеты по продажам, остаткам, услугам, документам |
| Feedback | `/v2/businesses/{businessId}/goods-feedback` | Отзывы и комментарии |
| Questions | `/v1/businesses/{businessId}/goods-questions` | Вопросы и ответы |
| Chats | `/v2/businesses/{businessId}/chats*` | Чаты с покупателями, если нужен операторский контур |

Later:

| Area | Why later |
| --- | --- |
| Price/stock writes | Нужны approvals, idempotency, read-after-write и rollback UX |
| Order mutations | Меняют операционный процесс склада, нужны роли и аудит |
| Promos writes | Денежные последствия и риск неверной цены |
| Sales boost / bids | Аналог рекламного money-spending контура, не MVP |
| Notifications/webhooks | Полезно для нагрузки, но сначала нужен стабильный read sync |
| Auto replies | Сначала drafts + explicit approval |

## Yandex Market Sync Design

Создать `src/inngest/sync-yandex-market.ts`.

Источники MVP:

```text
yandex_market_campaigns
yandex_market_campaign_settings
yandex_market_offer_mappings
yandex_market_offer_cards
yandex_market_offer_prices
yandex_market_offer_stocks
yandex_market_orders
yandex_market_returns
yandex_market_reports
yandex_market_finance_services
yandex_market_closure_documents
yandex_market_goods_feedback
yandex_market_goods_questions
yandex_market_chats
```

Профили:

- fast: campaigns health, orders, stocks;
- medium: catalog, prices, returns, feedback/questions;
- nightly: reports, closure documents, full catalog reconcile.

Правила:

- каждый source пишет source-level summary;
- каждый run пишет coverage и granularity: account-level или shop-level;
- recoverable ошибки не должны валить весь sync, если есть прошлый snapshot;
- 401/403 переводят account в `invalid` или `warning`;
- `apiAvailability != AVAILABLE` переводит конкретный shop в warning/disabled,
  но не обязательно валит весь account;
- асинхронные reports хранить как job lifecycle: requested, processing,
  ready, failed, expired;
- финансовые и отчетные данные маркировать final/provisional, если источник
  позволяет это определить;
- для дат использовать timezone-aware timestamps и явно хранить период отчета.

## Finance Methodology

Нельзя механически перенести WB PnL или будущую Ozon PnL.

Для Яндекс Маркета нужно отдельно описать:

- что считать заказом;
- что считать продажей;
- как учитывать невыкупы и возвраты;
- какие услуги Маркета относятся к commission/logistics/storage/other fees;
- как отчеты `united-marketplace-services`, `closure-documents` и детализация
  закрывающих документов сходятся между собой;
- какие периоды являются предварительными, а какие закрытыми;
- как связать строки отчетов с `campaignId`, заказом и `shopSku`;
- как учитывать разные модели FBY/FBS/Express/DBS/LaaS.

Первый finance MVP:

- показать заказы/продажи по магазинам;
- показать услуги и удержания Маркета из отчетов;
- показать закрывающие документы и детализацию;
- явно маркировать расхождения, незакрытые периоды и неполные отчеты;
- не включать Яндекс Маркет в общую прибыль WB+Ozon до нормализации facts.

## Security

Api-Key Яндекс Маркета - critical secret.

Требования:

- хранить encrypted через текущий `encrypt/decrypt`;
- не логировать `Api-Key`;
- preflight перед сохранением;
- сохранять минимальные права токена: продавец должен выдавать только нужные
  группы методов;
- `save with warning` допустим только для частичных доступов, не для явно
  неверного токена;
- route/server action checks через `requireTenantAccess`;
- raw данные отдавать только через auth + tenant + marketplace account/shop
  access;
- platform admin не видит секреты, только masked status/health;
- audit events для добавления, обновления, отключения токена и запуска sync.

## Implementation Slices

### YM-00. Product and Architecture Plan

Status: `done` after this document is accepted.

Output:

- this plan;
- backlog link;
- no code changes.

### YM-01. Marketplace Account and Shop Foundation

Goal:

- add/extend `marketplace_accounts`;
- add `marketplace_account_shops`;
- backfill one WB marketplace account per current tenant;
- keep existing WB flows unchanged.

Files:

- `src/lib/db/schema.ts`
- `drizzle/*`
- settings/server actions
- tenant/marketplace switcher store

Checks:

- migration check;
- typecheck;
- current WB settings smoke.

### YM-02. App Shell and Yandex Market Workspace

Goal:

- extend marketplace switcher with `Яндекс Маркет`;
- add `/yandex-market/*` routes;
- add empty states and connection-required UX;
- add shop selector placeholder.

Checks:

- UI smoke for WB routes unchanged;
- `/yandex-market/overview` renders without credentials.

### YM-03. API Client and Preflight

Goal:

- implement `src/lib/yandex-market-api`;
- validate Api-Key through token/campaign methods;
- persist account health and discovered shops.

Checks:

- mocked API tests for success, 401, 403, 429/limit, 5xx, timeout;
- no secret leak in logs/errors.

### YM-04. Campaigns, Shops and Settings Sync

Goal:

- sync `/v2/campaigns`;
- store `businessId`, `campaignId`, shop names, `apiAvailability`, settings;
- show health in settings.

### YM-05. Catalog, Prices and Stocks Read-only Sync

Goal:

- sync offer mappings, offer cards, prices, stocks;
- persist raw tables;
- map `shopSku` into `marketplace_product_links`.

Checks:

- mapping/dedupe tests;
- mock payload sync.

### YM-06. Orders and Returns MVP

Goal:

- sync orders and returns at business/shop level;
- show orders page with statuses and model-specific labels;
- no mutations.

### YM-07. Reports and Finance MVP

Goal:

- implement report generation lifecycle;
- ingest services/closure documents/detalization;
- build first finance page with coverage and reconciliation notes.

### YM-08. Feedback, Questions and Chats

Goal:

- read queues;
- draft replies through existing AI layer if enabled;
- publish only after explicit approval in a later slice.

### YM-09. Promotions, Bids and Actions Research

Goal:

- separate plan for promos, price writes, sales boost/bids and order mutations;
- define approvals, idempotency and audit model before any write endpoint.

## MVP Definition

MVP is complete when:

- existing WB user can still work as before;
- same user can add Яндекс Маркет Api-Key in settings;
- preflight discovers `businessId` and shops/campaigns;
- marketplace switcher opens Яндекс Маркет workspace;
- shop selector works for accounts with multiple shops;
- products/orders/stocks/finance sync works read-only;
- pages show freshness, coverage, shop-level status and source errors;
- no Яндекс Маркет secret leaks in UI/logs;
- no WB/Ozon calculations silently applied to Яндекс Маркет finance.

## Non-goals For MVP

- no write actions for prices, stocks, orders, promos or bids;
- no sales boost automation;
- no automatic reply publishing;
- no shared WB+Ozon+Yandex profit dashboard until normalized facts are stable;
- no mass migration of existing WB raw tables;
- no route rewrite of the whole dashboard.

## Open Questions

- Первый пилот Яндекс Маркета работает по FBY, FBS, DBS, Express или смешанно?
- Нужна ли поддержка нескольких магазинов внутри одного кабинета на старте?
- Какие права Api-Key готов дать пилот: read-only all methods или точечные
  группы?
- Нужны ли чаты в MVP или достаточно отзывов/вопросов?
- Finance MVP строим от отчетов или от заказов + отчеты только для сверки?
- Где показывать будущую cross-marketplace сводку: отдельная вкладка
  `Все площадки` или виджет на общей главной?

## Sources

- Yandex Market API overview:
  https://yandex.ru/dev/market/partner-api/doc/ru/overview/
- Yandex Market API best practices:
  https://yandex.com/dev/market/partner-api/doc/en/concepts/best-practices
- Api-Key tokens:
  https://yandex.ru/dev/market/partner-api/doc/en/concepts/api-key
- API access control and `apiAvailability`:
  https://yandex.ru/dev/market/partner-api/doc/en/concepts/api-access
- Business-level methods:
  https://yandex.ru/dev/market/partner-api/doc/ru/overview/business
- Orders by business:
  https://yandex.ru/dev/market/partner-api/doc/ru/reference/orders/getBusinessOrders
- Official OpenAPI repository:
  https://github.com/yandex-market/yandex-market-partner-api
- GitHub reference, generated PHP client:
  https://github.com/apiship/yandex-market-php-client
