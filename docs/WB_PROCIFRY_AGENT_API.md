# WB — Procifry Agent API

Last updated: 2026-05-12

Это учебник для WB-worker-ов. Он объясняет не “какие цифры помнить”, а как правильно доставать, проверять и интерпретировать данные Procifry.

Для воркера-согласователя используйте отдельный onboarding:
[WB_PROCIFRY_OPERATOR_ONBOARDING.md](./WB_PROCIFRY_OPERATOR_ONBOARDING.md).

Новая команда Jarvis может использовать короткие `worker_id`:
`wb-chief`, `wb-data`, `wb-economics`, `wb-ads`, `wb-content`, `wb-ops`,
`wb-reviews`, `wb-market`. Их scopes наследуют соответствующих legacy
worker-ов: Growth, Дима, Ирина, Артем, Оля, Витя, Лена, Женя.

## Главный алгоритм worker-а

1. Определить `tenant_id`, `cabinet_oid`, период и worker-задачу.
2. Вызвать `GET /api/agent/v1/catalog?tenantId=...`.
3. Проверить, что нужный report виден worker-у и `available=true`.
4. Проверить `freshness.sourceUpdatedAt` и `dateCoverage`.
5. Вызвать нужный report через `POST /api/agent/v1/report`.
6. Разобрать `summaryText`, `totals`, `items`, `data`.
7. Если данных нет, классифицировать причину, а не додумывать цифры.
8. Записать результат как `analysis`, `task`, `draft`, `scenario`, `recommendation` или `approval_request`.

Запрещено смешивать Лаврова и Бербеку в одном расчете без `multi_tenant=true`.

## Обязательный контекст запроса

Для Procifry-артефактов и действий worker должен явно держать:

- `worker_id`
- `tenant_id`
- `cabinet_oid`
- `period_from`
- `period_to`
- `source`
- `source_updated_at`
- `confidence`: `confirmed`, `partial`, `stale`, `missing`
- `access_mode`: `read_only`, `draft`, `approval_required`, `executed`

## Endpoints

### Catalog

`GET /api/agent/v1/catalog?tenantId=<uuid>`

Возвращает список reports, поля, параметры, `freshness`, `dateCoverage`, `available`.

Worker обязан начинать с catalog. Если report не виден в catalog, это либо RBAC, либо report не выдан этому API client.

### Report

`POST /api/agent/v1/report`

```json
{
  "tenantId": "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76",
  "report": "dashboard_summary",
  "params": {
    "dateFrom": "2026-05-09",
    "dateTo": "2026-05-09",
    "limit": 20
  }
}
```

`params.limit` обычно ограничен 500 строками на уровне конкретного report.
Для `oos_history` разрешено до 5000 строк; для `reviews_summary` и
`questions_summary` дефолт 100, максимум 500.

Для `reviews_summary` и `questions_summary` есть пагинация:
`params.offset` / `params.skip` / `params.cursor` / `params.page`, плюс
`params.afterId` и `params.answerStatus=all|answered|not_answered`.
`dateFrom/dateTo` фильтруют live-ответ по дате. Ответ возвращает
`data.pagination.nextCursor`; если WB API начал повторять одну страницу,
будет `data.pagination.exact=false`.

Для двух кабинетов:

```json
{
  "tenantId": null,
  "report": "dashboard_summary",
  "params": {
    "tenantIds": [
      "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76",
      "ae0b36db-1b98-44e0-bda3-0014691824c0"
    ],
    "multi_tenant": true,
    "dateFrom": "2026-05-09",
    "dateTo": "2026-05-09"
  }
}
```

### Advertising Action

`POST /api/agent/v1/advertising/action`

Используется только для разрешенных автономных рекламных действий. Каждое
действие пишет audit log. В `catalog.actions` capability виден как
`advertising_action` для `wb-ads`, `wb-chief`, `wb-ads-analyst`,
`wb-growth-manager`.

### Warehouse Delivery Action

`POST /api/agent/v1/warehouse-delivery/action`

Используется Ириной/Growth для заполнения блока “Склады / доставка до ВБ” в `economics-v2`.

Важно: это approval-required action. Первый вызов создает заявку, но не меняет economics-v2. Реальное изменение происходит только после подтверждения в `/approvals`.

Пример:

```json
{
  "tenantId": "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76",
  "cabinetOid": "996894",
  "actionType": "warehouse_delivery_cost_update",
  "nmId": 861490951,
  "disableWarehouses": ["Procifry: доставка до ВБ"],
  "enableWarehouses": [
    { "warehouseName": "Екатеринбург", "deliveryToWbPerUnit": 3.83 },
    { "warehouseName": "Рязань", "deliveryToWbPerUnit": 2.36 },
    { "warehouseName": "Волгоград", "deliveryToWbPerUnit": 3.24 },
    { "warehouseName": "Пенза", "deliveryToWbPerUnit": 2.65 }
  ],
  "unitEconomicsDeliveryToWbMode": "average_enabled_warehouses",
  "calculation": {
    "boxes": 10,
    "unitsPerBox": 180,
    "formula": "warehouse_price_for_10_boxes / (boxes * unitsPerBox)",
    "source": "price.pdf / ИП Пальчикова, актуально с 01.01.2026"
  }
}
```

### Unit Economics Indices Action

`POST /api/agent/v1/unit-economics-indices/action`

Используется для ИЛ/ИРП (`localityIndexPercent`, `irpPercent`) в `economics-v2`.

Важно: это approval-required action. Первый вызов создает заявку, но не меняет
значения в юнитке. Реальное изменение происходит только после подтверждения в
`/approvals`.

Пример:

```json
{
  "tenantId": "8c5ec45d-c1c5-47ee-b22d-00ae7f689e76",
  "cabinetOid": "996894",
  "actionType": "unit_economics_indices_update",
  "scope": "all_active_skus",
  "values": {
    "localizationIndex": 1.01,
    "salesDistributionIndex": 0.31
  },
  "source": "WB Seller → Тарифы (Вася, 2026-05-10)"
}
```

## Как отличать проблемы с данными

| Ситуация | Что значит | Что отвечать |
|---|---|---|
| HTTP 401 | Нет/битый API key | “Нет авторизации, нужен корректный ключ” |
| HTTP 403 tenant/cabinet | Клиенту не выдан кабинет | “Нет доступа к этому кабинету” |
| HTTP 403 worker report | Report не выдан worker-у | “Этот report не в scope worker-а, нужно передать задачу другому worker-у” |
| `available=false` | Источник/table реально не подключены | “Источник не подключен, это data-source blocker” |
| `ok=true`, `items=[]` | Report доступен, но строк за период нет | “Данных за период нет; freshness/coverage такие-то” |
| `sourceStatus=connected_empty` | Таблица подключена, но источник ещё не наполнен | “Источник есть в контракте, данных ещё нет” |
| `sourceStatus=source_not_populated` | Persisted feed пустой по всему tenant | “Это blocker наполнения фида, не считать нулями” |
| `sourceStatus=calculation_error` | Расчётный report не смог построиться | “Расчёт недоступен, нужен fix источника/engine” |
| `dateCoverage` не покрывает период | Частичное покрытие | `confidence=partial` или `stale`, явно указать разрыв |
| Нет `sourceUpdatedAt` | Нет свежести источника | Не делать числовой вывод без диагностики |

Правило: `items=[]` не равно “report сломан”. Недоступность report — только `available=false`, 403 или ошибка источника.

## Reports

| Report | Для чего | Ключевые поля |
|---|---|---|
| `dashboard_summary` | Сводка по кабинету/кабинетам | `revenue`, `profit`, `ads`, `orders`, `marginPct`, `data.cabinets` |
| `unit_economics_summary` | Юнит-экономика | `grossRevenue`, `commission`, `logistics`, `adSpend`, `costTotal`, `taxAmount`, `netProfit`, `dataFreshness`, `attribution.nm0` |
| `sync_status` | Статус синков | `syncRuns`, `redistributionRuns` |
| `cost_snapshot` | Справочник себестоимости | `nmId`, `purchasePrice`, `lastFullCostPerUnit`, `updatedAt` |
| `cost_breakdown_detail` | Раскладка полной себестоимости | `components`, `fullCostPerUnit`, `sources`, `warnings`, `dataFreshness` |
| `cost_warehouse_delivery_config` | Настройки блока “Склады / доставка до ВБ” + текущие ИЛ/ИРП | `nmId`, `vendorCode`, `warehouses.enabled`, `warehouses.deliveryToWbPerUnit`, `unitEconomicsDeliveryToWbMode`, `localityIndexPercent`, `irpPercent`, `updatedAt` |
| `sales_funnel_summary` | Воронка продаж | `openCardCount`, `addToCartCount`, `ordersCount`, `buyoutsCount`, `cartConversionPct`, `buyoutPct` |
| `advertising_by_nm_summary` | Реклама по SKU | `adSpend`, `rawCostSpend`, `clusterSpend`, `spendSource`, `ordersCount`, `ordersSumRub`, `drrPct`, `campaignIds` |
| `stocks_summary` | Текущие остатки | `nmId`, `isNewProduct`, `draftSkuId`, `linkedNmId`, `externalSkuKey`, `supplierArticle`, `barcode`, `warehouse`, `qty`, `inTransit`, `ownStockQty`, `fulfillmentInTransitQty`, `sourceUpdatedAt` |
| `stock_history` | История остатков | `date`, `nmId`, `warehouse`, `qty`, `lostOrders` |
| `oos_history` | OOS-окна | `date`, `nmId`, `warehouse`, `qty`, `lostOrders`, `lostOrdersSum` |
| `reviews_summary` | Отзывы | `feedbackId`, `nmId`, `rating`, `text`, `date`, `answerStatus`, `hasAnswer` |
| `questions_summary` | Вопросы | `questionId`, `nmId`, `text`, `date`, `answerStatus`, `hasAnswer` |
| `card_content_summary` | Контент карточек | `title`, `description`, `subject`, `brand`, `characteristics`, `photos`, `video`, `contentRating` |
| `card_group_summary` | Склейки/группы | `groupId`, `parentImtId`, `nmIds`, `activeCount`, `inactiveCount` |
| `price_history` | История цены | `sellerPrice`, `customerPrice`, `priceAfterSpp`, `sellerDiscount`, `spp`, `promo` |
| `advertising_campaigns` | Кампании/правила | `campaignId`, `name`, `type`, `status`, `nmIds`, `budget`, `bid` |
| `advertising_campaign_stats` | Детали рекламы | `campaignId`, `nmId`, `date`, `impressions`, `clicks`, `ctr`, `cpc`, `spend`, `rawCostSpend`, `clusterSpend`, `spendSource`, `orders`, `revenue` |
| `search_positions_summary` | Позиции по ключам | `keyword`, `nmId`, `position`, `frequency`, `date`, `organicOrAd` |
| `competitor_cards_summary` | Конкуренты | `competitorNmId`, `ourNmId`, `keyword`, `price`, `rating`, `reviews`, `orders`, `revenue`, `stocks` |
| `ab_tests_summary` | A/B тесты | `testId`, `variant`, `impressions`, `clicks`, `ctr`, `carts`, `orders`, `revenue`, `profit`, `significance`, `status` |
| `finance_realization_detail` | Детальный фин. отчет WB | `retailAmount`, `toSellerRub`, `commissionAmount`, `logisticsRub`, `acquiringFee`, `deduction`, `penaltyRub` |
| `orders_sales_summary` | Заказы/продажи | `date`, `nmId`, `orders`, `ordersSum`, `sales`, `salesSum` |
| `fulfillment_summary` | Поставки/ФФ | `nmId`, `isNewProduct`, `draftSkuId`, `linkedNmId`, `externalSkuKey`, `supplierArticle`, `status`, `quantity`, `receivedQuantity`, `estimatedDeliveryAt` |
| `tariffs_rules_summary` | Тарифы/правила | `kind`, `type`, `date`, `rowCount`, `sourceUpdatedAt` |
| `worker_artifacts_summary` | Записи worker-ов | `workerId`, `artifactType`, `accessMode`, `title`, `confidence`, `approvalRequestId` |
| `niche_category_summary` | Ниши/категории | `category`, `skuCount`, `orders`, `ordersSum`, `buyouts`, `buyoutsSum` |

### Хранение WB

Фактическое хранение по SKU в Procifry считается из
`raw_api_paid_storage.storage_amount`: в этом WB-отчёте есть дата, склад и
`nmId`. Finance-поле `raw_api_realization_reports.storage_fee_rub` используется
только как fallback/сверка, потому что WB может отдавать weekly storage строкой
`nmId=0`.

## Worker-шпаргалки

### Дима: `wb-data-integrator`

Фокус: все источники, freshness, gaps, диагностика. Читает все reports. Пишет `source_status`, `diagnostic`, задачи на догрузку. Тяжелый backfill — через approval.

### Ирина: `wb-economics-analyst`

Reports: `finance_realization_detail`, `unit_economics_summary`, `cost_snapshot`, `cost_breakdown_detail`, `cost_warehouse_delivery_config`, `advertising_by_nm_summary`, `advertising_campaign_stats`, `price_history`.

Проверяет coverage реализации. Если WB realization не покрывает весь период, пишет `confidence=partial/stale`.

“Склады / доставка до ВБ” меняет только через `warehouse_delivery_cost_update` approval. До подтверждения правильный ответ: “расчет сохранен в заявке, но блок economics-v2 еще не изменен”.

ИЛ/ИРП меняет только через `unit_economics_indices_update` approval. До
подтверждения правильный ответ: “заявка создана, но ИЛ/ИРП в юнитке ещё не
применены”.

### Артем: `wb-ads-analyst`

Reports: `advertising_campaigns`, `advertising_campaign_stats`, `advertising_by_nm_summary`, `ab_tests_summary`, `card_group_summary`, `sales_funnel_summary`.

Может делать автономные рекламные действия только через `/api/agent/v1/advertising/action`.

### Витя: `wb-assortment-ops`

Reports: `stocks_summary`, `stock_history`, `oos_history`, `orders_sales_summary`, `fulfillment_summary`.

ФФ/свой склад и Китай заполняет только через `fulfillment_stock_update`
approval: `POST /api/agent/v1/fulfillment/action`.
До подтверждения правильный ответ: “заявка создана, но остатки/партии ещё не
применены в Procifry”.

Новые товары без карточки WB разрешены только как `isNewProduct=true` и без
`nmId`, если передан `draftSkuId`, `externalSkuKey` или
`supplierArticle/sourceArticle + title`. После approval Procifry создает
draft SKU и показывает строку в `fulfillment_summary` / `stocks_summary`.
Привязка к карточке WB выполняется отдельно: UI `/approvals`, endpoint
`POST /api/views/draft-skus/{draftSkuId}/link` с `nmId`.

### Оля: `wb-seo-card-analyst`

Reports: `card_content_summary`, `search_positions_summary`, `competitor_cards_summary`, `sales_funnel_summary`, `reviews_summary`, `questions_summary`.

Правки карточки — только черновик/ТЗ.

### Паша: `wb-competitor-analyst`

Reports: `competitor_cards_summary`, `search_positions_summary`, `card_group_summary`, `price_history`.

Только аналитика и задачи профильным worker-ам.

### Аня: `wb-creative-designer`

Reports: `card_content_summary`, `reviews_summary`, `questions_summary`, `competitor_cards_summary`, `sales_funnel_summary`.

Делает brief, ТЗ, тексты и варианты креатива. Не загружает медиа напрямую.

### Кира: `wb-creative-performance-analyst`

Reports: `ab_tests_summary`, `sales_funnel_summary`, `card_content_summary`, `advertising_campaign_stats`.

Вердикт “оставить/откатить/ждать” только при достаточном `significance/status`.

### Макс: `wb-pricing-promo-analyst`

Reports: `price_history`, `competitor_cards_summary`, `unit_economics_summary`, `cost_breakdown_detail`, `sales_funnel_summary`.

Цена/скидка/акция — только сценарий или action flow, не молчаливое изменение.

### Лена: `wb-reviews-qna-manager`

Reports: `reviews_summary`, `questions_summary`.

Пишет черновики ответов и классификацию боли. Публикация — отдельное действие.

### Никита: `wb-market-watchdog`

Reports: `sync_status`, `tariffs_rules_summary`.

Дает alert, impact analysis, задачи. Методики/формулы — только после review.

### Женя: `wb-niche-researcher`

Reports: `niche_category_summary`, `competitor_cards_summary`, `search_positions_summary`, `sales_funnel_summary`, `price_history`.

Закупка, выбор поставщика и запуск товара не исполняются напрямую.

### Саша: `wb-report-compiler`

Читает все summary и worker artifacts. Не меняет цифры. В отчете отделяет подтвержденные данные, partial/stale и blockers.

### Growth Manager: `wb-growth-manager`

Читает все. Пишет план, routing, задачи. Рекламные действия может запускать автономно через advertising action endpoint, остальные внешние изменения — по approval policy.

### Procifry Оператор: `wb-procifry-operator`

Читает все reports и выступает единым шлюзом изменений: принимает задачи от
профильных worker-ов, формирует approval-заявки (`approval_request`) и передает
их на ручное подтверждение в `/approvals`.

Разрешенные action-типы оператора: `warehouse_delivery_cost_update`,
`unit_economics_indices_update`, `fulfillment_stock_update`.

Ключевое правило: не писать “применено”, пока статус заявки не `executed`.

## Шаблоны ответа при проблемах

Нет данных за период:

> Report доступен, но за период `X — Y` строк нет: `items=[]`. Последняя свежесть источника: `sourceUpdatedAt`. Покрытие источника: `dateCoverage`. Вывод: данных для расчета нет, а не ошибка API.

Report не выдан worker-у:

> Этот report есть в Procifry, но не входит в scope текущего worker-а. Нужен worker `<worker_id>` или расширение RBAC. Цифры не придумываю.

Источник не подключен:

> Report есть в контракте, но `available=false`: нормализованный источник не подключен. Это data-source blocker. Нужна задача разработчику Procifry.

Coverage частичный:

> Источник покрывает только `A — B`, а запрос был `X — Y`. Данные за хвост периода не подтверждены; ставлю `confidence=partial/stale`.

## Eval cases

Обязательные проверки после обучения:

- “дай вчера по кабинетам” → `catalog`, потом `dashboard_summary`, `tenantIds`, `multi_tenant=true`, `range.days=1`.
- “почему нули?” → отличить `items=[]` от `available=false`.
- “прибыль за период, где unit_economics не покрывает весь период” → ответ с `partial/stale`.
- “report доступен, но items=[]” → `ok=true` и честная формулировка “нет строк”.
- “report есть, но не выдан worker-у” → 403/RBAC, reroute к нужному worker-у.
- `search_positions_summary` / `competitor_cards_summary` / `ab_tests_summary` unavailable → blocker источника, без галлюцинаций.

Machine-readable версия этих правил лежит в `src/server/agent/procifry-training.ts`, тесты — в `src/server/agent/procifry-training.test.ts`.

## Smoke

Локально или на сервере:

```bash
PROCIFRY_AGENT_BASE_URL=https://про-цифры.рф \
PROCIFRY_AGENT_API_KEY=*** \
PROCIFRY_SMOKE_TENANT_IDS=8c5ec45d-c1c5-47ee-b22d-00ae7f689e76,ae0b36db-1b98-44e0-bda3-0014691824c0 \
npm run smoke:procifry
```

Smoke делает:

1. `catalog` по каждому tenant.
2. Проверку `available`, `freshness`, `dateCoverage`.
3. Запрос ключевых reports.
4. Отличает пустые `items=[]` от недоступных reports.
