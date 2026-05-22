# Agent API Integration

Last updated: 2026-05-19

Этот документ описывает два связанных контура:

1. продуктовый контур Telegram-бота проекта;
2. текущий рабочий контур подключения внешнего cloud-агента к уже развернутому private API.

Отдельно: `TELEGRAM_OPS_CHAT_ID` относится только к ops-watchdog алертам. Это не продуктовый бот и не авторизация пользователей; без chat id watchdog работает в log-only режиме.

Полный план Telegram-бота: [`TELEGRAM_BOT_PRODUCT_PLAN.md`](./TELEGRAM_BOT_PRODUCT_PLAN.md).

## 1. Telegram Bot MVP

Бот для проекта делаем как единую точку входа в продукт, а не как замену веб-приложению.

### Роль бота в MVP

- онбординг нового пользователя;
- привязка Telegram к кабинету;
- поддержка;
- быстрые отчёты;
- уведомления.

### Что должно быть в первой версии

- `/start`
- `/help`
- `/dashboard [days]`
- `/unit <nmId> [days]`
- `/economics <nmId> [days]`
- `/stock <nmId>`
- `/ads <nmId> [days]`
- `/reviews [limit]`
- `/sync`
- `/support <text>`

### Security baseline

- sensitive-команды с данными кабинета по умолчанию работают только в личном
  чате с ботом;
- группы используются для уведомлений, а не для отчетов, если явно не включен
  `TELEGRAM_ALLOW_GROUP_REPORT_COMMANDS=true`;
- tenant выбирается только через проверенную связку `chat_id -> tenant_id`;
- новый канонический слой привязки — `telegram_chat_links`; legacy
  `tenants.telegram_chat_id` остается fallback на период миграции;
- новая привязка создаётся через одноразовый deep link
  `https://t.me/<bot>?start=<token>`; в БД хранится только hash токена;
- бот не принимает `tenantId` из текста команды и не исполняет прямые WB-write
  действия без `/approvals`.

### Что не делать в первой версии

- не переносить основной login из Supabase в Telegram;
- не давать боту прямой доступ к `DATABASE_URL`;
- не делать arbitrary SQL;
- не строить сразу multi-agent orchestration;
- не смешивать support-бота и биллинг/продажи в один запутанный сценарий.

## 2. Current Production Agent API

Private API уже развернут на production.

### Base URL

- public base URL: `https://про-цифры.рф`
- API endpoint: `POST https://про-цифры.рф/api/agent/v1/report`

### Auth

Поддерживаются два способа:

- `Authorization: Bearer <AGENT_API_KEY>`
- `X-Agent-Api-Key: <AGENT_API_KEY>`

Без ключа endpoint возвращает `401 Unauthorized`.

### Supported reports (`v1`)

- `dashboard_summary`
- `unit_economics_summary`
- `sync_status`
- `cost_snapshot`
- `cost_breakdown_detail`
- `cost_warehouse_delivery_config`
- `sales_funnel_summary`
- `advertising_by_nm_summary`
- `stocks_summary`
- `stock_history`
- `oos_history`
- `reviews_summary`
- `questions_summary`
- `card_content_summary`
- `card_group_summary`
- `price_history`
- `advertising_campaigns`
- `advertising_campaign_stats`
- `search_positions_summary`
- `competitor_cards_summary`
- `ab_tests_summary`
- `finance_realization_detail`
- `orders_sales_summary`
- `fulfillment_summary`
- `tariffs_rules_summary`
- `worker_artifacts_summary`
- `niche_category_summary`

Полный учебник для WB-worker-ов: [WB_PROCIFRY_AGENT_API.md](./WB_PROCIFRY_AGENT_API.md).
Короткий core context: [WB_PROCIFRY_SKILL_PACK.md](./WB_PROCIFRY_SKILL_PACK.md).
Onboarding отдельного воркера-согласователя: [WB_PROCIFRY_OPERATOR_ONBOARDING.md](./WB_PROCIFRY_OPERATOR_ONBOARDING.md).
Готовый запрос доступов разработчикам: [WB_PROCIFRY_ACCESS_REQUEST_FOR_DEVS.md](./WB_PROCIFRY_ACCESS_REQUEST_FOR_DEVS.md).

### Jarvis worker IDs

Код RBAC поддерживает legacy worker-ов и новую укрупненную команду Jarvis:

| Jarvis ID | Legacy scope |
|---|---|
| `wb-chief` | `wb-growth-manager` |
| `wb-data` | `wb-data-integrator` |
| `wb-economics` | `wb-economics-analyst` |
| `wb-ads` | `wb-ads-analyst` |
| `wb-content` | `wb-seo-card-analyst` |
| `wb-ops` | `wb-assortment-ops` |
| `wb-reviews` | `wb-reviews-qna-manager` |
| `wb-market` | `wb-niche-researcher` + competitor read reports |

Для прямого использования этих ID нужны отдельные entries в `AGENT_API_CLIENTS`
с соответствующим `workerId`.

### Approval-required actions

- `warehouse_delivery_cost_update` — заполнение блока
  “Склады / доставка до ВБ” в `economics-v2`.
  Endpoint: `POST /api/agent/v1/warehouse-delivery/action`.
  Доступ: `wb-economics-analyst`, `wb-growth-manager`,
  `wb-procifry-operator`.
  Без approval action только создает заявку; реальные значения применяются
  после подтверждения в `/approvals`.
- `unit_economics_indices_update` — заполнение ИЛ/ИРП
  (`localityIndexPercent`, `irpPercent`) в `economics-v2`.
  Endpoint: `POST /api/agent/v1/unit-economics-indices/action`.
  Доступ: `wb-economics-analyst`, `wb-growth-manager`,
  `wb-procifry-operator`.
  Без approval action только создает заявку; реальные значения применяются
  после подтверждения в `/approvals`.
- `fulfillment_stock_update` — заполнение остатков ФФ/своего склада и партий
  из Китая в производстве/пути.
  Endpoint: `POST /api/agent/v1/fulfillment/action`.
  Доступ: `wb-assortment-ops`, `wb-growth-manager`, `wb-procifry-operator`.
  Без approval action только создает заявку; реальные строки пишутся в
  `own_stock_batches`, `own_stock_movements`, `production_orders` и
  `production_order_lines` после подтверждения в `/approvals`.

CLI helper для Jarvis/debug:

```bash
node scripts/procifry-agent.mjs catalog --tenant-id <uuid>
node scripts/procifry-agent.mjs report --tenant-id <uuid> --report oos_history --limit 5000
node scripts/procifry-agent.mjs unit-economics-indices-action \
  --tenant-id <uuid> \
  --cabinet-oid <oid> \
  --worker-id wb-economics \
  --scope all_active_skus \
  --locality-index-percent 1.01 \
  --irp-percent 0.31
```

### Рекомендуемый контур работы (WB Growth Штаб)

- Профильные воркеры (Ирина, Витя, Артем и т.д.) делают анализ и формируют
  что менять.
- Отдельный worker `wb-procifry-operator` ставит изменение в approval через
  action endpoint.
- Применение делается только после ручного подтверждения в `/approvals`.
- Формулировка “изменение применено” допустима только при статусе
  `executed`.

### Request body

```json
{
  "tenantId": "uuid",
  "report": "dashboard_summary",
  "params": {
    "days": 7,
    "nmId": 12345678,
    "limit": 5,
    "from": "2026-04-18",
    "to": "2026-04-24"
  }
}
```

Для `cost_snapshot` можно передать сразу несколько кабинетов:

```json
{
  "report": "cost_snapshot",
  "params": {
    "tenantIds": ["uuid-1", "uuid-2"],
    "days": 30
  }
}
```

### Params by report

#### `dashboard_summary`

- `tenantId` optional, если передаётся `params.tenantIds`
- `params.tenantIds` optional array для сводки по кабинетам одним запросом
- `params.multi_tenant=true` required, если `tenantIds.length > 1`
- `days` optional, default `7`
- `dateFrom` + `dateTo` optional pair, включая однодневный период
- `from` + `to` поддерживаются как backward-compatible aliases
- `limit` optional, default `5`, max `20`
- в multi-tenant ответе `range.days` остается фактической длиной запроса:
  `dateFrom=dateTo=2026-05-09` возвращает `days: 1`, а не default 7 дней
- в `data.cabinets[]` возвращаются KPI по каждому кабинету, в `data.totals`
  и `totals` — суммарная сводка

#### `unit_economics_summary`

- `nmId` optional, but usually нужен
- `days` optional, default `7`
- `from` + `to` optional pair
- `limit` optional, default `5`, max `20`
- в `data.items[]` теперь возвращаются все SKU за период
- на каждый SKU теперь есть:
  - `unitsSold`
  - `soldQuantity`
  - `purchasePrice`
  - `costPerUnit`
  - `fullCostPerUnit`

#### `cost_snapshot`

- `tenantId` optional, если передаётся `params.tenantIds`
- `params.tenantIds` optional array, если нужен multi-tenant snapshot одним запросом
- `days` optional, default `30`
- `from` + `to` optional pair
- в `data.items[]` возвращаются:
  - `tenantId`
  - `tenantName`
  - `nmId`
  - `vendorCode`
  - `name`
  - `purchasePrice`
  - `lastFullCostPerUnit`
  - `updatedAt`

#### `cost_breakdown_detail`

- `tenantId` optional, если передаётся `params.tenantIds`
- `params.tenantIds` optional array для multi-tenant breakdown одним запросом
- `dateFrom` + `dateTo` required
- `from` + `to` поддерживаются как backward-compatible aliases
- `nmIds` optional array
- `includeZeroSales` optional, default `false`
- `includeInactive` optional, default `false`
- в `data.items[]` на каждый SKU возвращаются:
  - `tenantId`
  - `tenantName`
  - `nmId`
  - `vendorCode`
  - `name`
  - `sales.unitsSold`
  - `sales.grossRevenue`
  - `purchasePrice`
  - `fullCostPerUnit`
  - `components`
  - `componentsTotal`
  - `sources`
  - `updatedAt`
  - `warnings`
- важно: `fullCostPerUnit` в этом report вычисляется как сумма `components`
- дополнительно report возвращает `dataFreshness` и alias `data_freshness`

#### `cost_warehouse_delivery_config`

- `tenantId` required
- `params.nmId` или `params.nmIds` required
- в `data.items[]` возвращаются:
  - `nmId`
  - `vendorCode`
  - `warehouses[].warehouseId`
  - `warehouses[].warehouseName`
  - `warehouses[].enabled`
  - `warehouses[].deliveryToWbPerUnit`
  - `unitEconomicsDeliveryToWbMode`
  - `unitEconomicsDeliveryToWb`
  - `localityIndexPercent`
  - `irpPercent`
  - `updatedAt`
- источник: `unit_economics_manual_inputs.manual_fields`

#### `sales_funnel_summary`

- `tenantId` required
- `dateFrom` + `dateTo` required
- `from` + `to` поддерживаются как backward-compatible aliases
- `nmIds` optional array; пустой `[]` означает “все товары”
- `groupBy` optional, сейчас поддерживается только `product`
- если данных нет, report возвращает `ok: true`, нулевые `totals` и пустой `items[]`
- в ответе возвращаются:
  - `period`
  - `totals`
  - `items`
  - `summaryText`
- источник: локальная таблица `raw_api_funnel_stats`, без live-вызова WB API

#### `advertising_by_nm_summary`

- `tenantId` required
- `dateFrom` + `dateTo` required
- `from` + `to` поддерживаются как backward-compatible aliases
- `nmIds` optional array; пустой `[]` означает “все SKU с рекламой”
- в ответе возвращаются:
  - `totals.adSpend`
  - `totals.campaignCount`
  - `totals.nmCount`
  - `items[].adSpend`
  - `items[].ordersCount`
  - `items[].ordersSumRub`
  - `items[].drrPct`
  - `items[].campaignIds`
- источник: локальная `raw_api_ad_costs`, для history-fallback возможны `campaignIds` из `placement=campaign:<advertId>`

#### `sync_status`

- `limit` optional, default `5`, max `20`

### Response shape

```json
{
  "ok": true,
  "clientId": "cloud-agent",
  "report": "dashboard_summary",
  "tenantId": "uuid",
  "generatedAt": "2026-04-24T07:53:32.625Z",
  "range": {
    "from": "2026-04-18",
    "to": "2026-04-24",
    "days": 7
  },
  "summaryText": "Сводка за 7 дн. ...",
  "data": {
    "...": "structured report payload"
  }
}
```

Для `cost_snapshot` дополнительно возвращается `tenantIds`, потому что ответ может быть multi-tenant.

Главное поле для Telegram/LLM-агента: `summaryText`.

`data` нужен, если агент хочет:

- дополнительно форматировать ответ;
- строить таблицу;
- делать follow-up reasoning;
- показывать top SKU / latest sync runs / breakdown.

## 3. Current tenant ids

На production сейчас есть два основных tenant:

- `ae0b36db-1b98-44e0-bda3-0014691824c0` — `ИП Бербека`
- `8c5ec45d-c1c5-47ee-b22d-00ae7f689e76` — `ИП Лавров`

Если cloud-агент работает только с одним кабинетом, лучше ограничить его на уровне ключа через `AGENT_API_ALLOWED_TENANT_IDS`.

## 4. How to connect a cloud agent

Cloud-агент не “подключится сам” только по URL. Ему нужно явно задать HTTP tool/action.

### Минимально нужно передать агенту

- base URL
- endpoint
- auth header
- `tenantId`
- список report ids
- примеры payload

### Рекомендуемый tool contract

Tool name:

- `wb_analytics_report`

Tool input:

```json
{
  "tenantId": "uuid",
  "report": "dashboard_summary | unit_economics_summary | sync_status | cost_snapshot | cost_breakdown_detail | cost_warehouse_delivery_config | sales_funnel_summary | advertising_by_nm_summary",
  "days": 7,
  "nmId": 12345678,
  "limit": 5,
  "tenantIds": ["uuid-1", "uuid-2"],
  "dateFrom": "2026-04-01",
  "dateTo": "2026-04-24",
  "nmIds": [12345678, 23456789],
  "includeZeroSales": false,
  "includeInactive": false,
  "groupBy": "product"
}
```

Tool execution:

```bash
curl -X POST https://про-цифры.рф/api/agent/v1/report \
  -H "Authorization: Bearer <AGENT_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "ae0b36db-1b98-44e0-bda3-0014691824c0",
    "report": "unit_economics_summary",
    "params": {
      "days": 7,
      "nmId": 12345678
    }
  }'
```

### What the agent should do

1. Определить tenant.
2. Выбрать report id.
3. Сформировать `params`.
4. Вызвать `/api/agent/v1/report`.
5. Показать `summaryText`.
6. При необходимости добавить детали из `data`.

## 5. Suggested intent mapping for the external agent

### Intent: dashboard summary

Примеры:

- “дай сводку”
- “что по кабинету за 7 дней”
- “как дела за неделю”
- “пришли сводку за вчера по кабинетам”

API call:

- `report = dashboard_summary`
- для одного кабинета: `tenantId = ...`
- для нескольких кабинетов: `params.tenantIds = [...]`, `params.multi_tenant = true`
- для одного дня: `params.dateFrom = YYYY-MM-DD`, `params.dateTo = YYYY-MM-DD`

Пример multi-tenant за один день:

```json
{
  "report": "dashboard_summary",
  "params": {
    "tenantIds": [
      "ae0b36db-1b98-44e0-bda3-0014691824c0",
      "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76"
    ],
    "multi_tenant": true,
    "dateFrom": "2026-05-09",
    "dateTo": "2026-05-09",
    "limit": 5
  }
}
```

### Intent: unit economics

Примеры:

- “юнит экономика по sku 12345678”
- “прибыль по товару 12345678”
- “разбери SKU 12345678”

API call:

- `report = unit_economics_summary`
- `params.nmId = ...`

### Intent: sync status

Примеры:

- “статус синков”
- “когда был последний sync”
- “есть ли ошибки импорта”

API call:

- `report = sync_status`

### Intent: cost snapshot

Примеры:

- “дай слепок себестоимости по двум кабинетам”
- “выгрузи текущие закупки по всем SKU”
- “нужен справочник себестоимостей”

API call:

- `report = cost_snapshot`
- `params.tenantIds = [...]`

### Intent: cost breakdown detail

Примеры:

- “разложи себестоимость по sku 12345678”
- “покажи из чего складывается полная себестоимость”
- “дай breakdown по всем sku за апрель”

API call:

- `report = cost_breakdown_detail`
- `params.dateFrom = ...`
- `params.dateTo = ...`
- `params.tenantIds = [...]`
- `params.nmIds = [...]` optional

Пример:

```json
{
  "report": "cost_breakdown_detail",
  "params": {
    "tenantIds": [
      "ae0b36db-1b98-44e0-bda3-0014691824c0",
      "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76"
    ],
    "dateFrom": "2026-04-01",
    "dateTo": "2026-04-24",
    "nmIds": [12345678],
    "includeZeroSales": false,
    "includeInactive": false
  }
}
```

### Intent: sales funnel summary

Примеры:

- “пришли отчёт по воронке продаж за 26 апреля”
- “воронка продаж за вчера”
- “дай funnel по товарам за период”

API call:

- `report = sales_funnel_summary`
- `params.dateFrom = ...`
- `params.dateTo = ...`
- `params.groupBy = product`
- `params.nmIds = []` для всех товаров или список SKU

Пример:

```json
{
  "tenantId": "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76",
  "report": "sales_funnel_summary",
  "params": {
    "dateFrom": "2026-04-26",
    "dateTo": "2026-04-26",
    "nmIds": [],
    "groupBy": "product"
  }
}
```

### Intent: advertising by nm summary

Примеры:

- “покажи рекламу по sku за 26 апреля”
- “сколько рекламы списалось по товарам”
- “дай ДРР по SKU за день”

API call:

- `report = advertising_by_nm_summary`
- `params.dateFrom = ...`
- `params.dateTo = ...`
- `params.nmIds = []` для всех SKU или список SKU

Пример:

```json
{
  "tenantId": "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76",
  "report": "advertising_by_nm_summary",
  "params": {
    "dateFrom": "2026-04-26",
    "dateTo": "2026-04-26",
    "nmIds": []
  }
}
```

## 6. Error handling

### `401 Unauthorized`

Причина:

- нет ключа;
- неверный ключ.

Действие:

- проверить `Authorization` header.

### `403`

Причина:

- ключ не имеет доступа к этому report или tenant.

Действие:

- проверить allowlist в server env.

### `400`

Причина:

- сломан payload;
- неверные даты;
- плохой `nmId`.

Действие:

- проверить body schema.

### `500`

Причина:

- внутренняя ошибка сервиса.

Действие:

- смотреть server logs и повторить запрос.

## 7. Security notes

- Это private API, не public API.
- Ключ нельзя встраивать в frontend.
- Ключ должен жить только в server-side secrets cloud-агента.
- Лучше иметь отдельный ключ на каждого внешнего агента.
- Для production-клиентов нужен отдельный audit trail по agent requests.
