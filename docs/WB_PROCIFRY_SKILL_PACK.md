# WB — Procifry Skill Pack

Last updated: 2026-05-12

Этот файл надо давать всем WB-worker-ам как core context.

Отдельный план обучения/сертификации воркера-согласователя:
[WB_PROCIFRY_OPERATOR_ONBOARDING.md](./WB_PROCIFRY_OPERATOR_ONBOARDING.md).

Jarvis IDs: `wb-chief`, `wb-data`, `wb-economics`, `wb-ads`, `wb-content`,
`wb-ops`, `wb-reviews`, `wb-market`.

## Нельзя

- Нельзя придумывать цифры, если report пустой, stale или недоступен.
- Нельзя смешивать Лаврова и Бербеку без `multi_tenant=true`.
- Нельзя менять WB-кабинет напрямую, кроме явно разрешенного рекламного action endpoint.
- Нельзя называть `items=[]` ошибкой API.

## Всегда

1. Сначала `GET /api/agent/v1/catalog?tenantId=...`.
2. Проверить, что report виден worker-у.
3. Проверить `available`.
4. Проверить `freshness.sourceUpdatedAt`.
5. Проверить `dateCoverage`.
6. Только потом вызывать report и делать вывод.
7. В ответе указывать confidence: `confirmed`, `partial`, `stale` или `missing`.

## Как классифицировать проблему

| Признак | Класс |
|---|---|
| 401 | нет авторизации |
| 403 tenant/cabinet | нет доступа к кабинету |
| 403 worker/report | report не выдан worker-у |
| `available=false` | источник не подключен |
| `ok=true`, `items=[]` | данных за период нет |
| `dateCoverage` не покрывает период | partial/stale |
| нет `sourceUpdatedAt` | missing freshness |

## Минимальная карта задач

| Задача | Worker | Reports |
|---|---|---|
| Сводка за вчера по кабинетам | `wb-chief` | `catalog`, `dashboard_summary` |
| Почему нули | `wb-data` | `catalog`, `sync_status`, нужный report |
| Прибыль/маржа | `wb-economics` | `catalog`, `unit_economics_summary`, `finance_realization_detail`, `cost_breakdown_detail` |
| Склады / доставка до ВБ | `wb-economics` / `wb-chief` / Procifry Оператор | `catalog`, `cost_warehouse_delivery_config`, затем `warehouse_delivery_cost_update` approval |
| ИЛ/ИРП в юнитке | `wb-economics` / `wb-chief` / Procifry Оператор | `catalog`, `cost_warehouse_delivery_config`, затем `unit_economics_indices_update` approval |
| ФФ / свой склад / Китай | `wb-ops` / `wb-chief` / Procifry Оператор | `catalog`, `fulfillment_summary`, `stocks_summary`, затем `fulfillment_stock_update` approval |
| Реклама/ДРР/ставки | `wb-ads` | `catalog`, `advertising_campaigns`, `advertising_campaign_stats`, `advertising_by_nm_summary`, `ab_tests_summary`, `sales_funnel_summary` |
| Остатки/OOS | `wb-ops` | `catalog`, `stocks_summary`, `stock_history`, `oos_history`, `orders_sales_summary` |
| SEO карточки | `wb-content` | `catalog`, `card_content_summary`, `search_positions_summary`, `competitor_cards_summary`, `reviews_summary`, `questions_summary` |
| Конкуренты | `wb-market` | `catalog`, `competitor_cards_summary`, `search_positions_summary`, `price_history` |
| Креативы | `wb-content` | `catalog`, `card_content_summary`, `reviews_summary`, `questions_summary`, `competitor_cards_summary` |
| A/B и CTR | `wb-ads` | `catalog`, `ab_tests_summary`, `sales_funnel_summary`, `advertising_campaign_stats` |
| Цена/промо | `wb-economics` | `catalog`, `price_history`, `unit_economics_summary`, `cost_breakdown_detail`, `competitor_cards_summary` |
| Отзывы/вопросы | `wb-reviews` | `catalog`, `reviews_summary`, `questions_summary` |
| Тарифы/API/rules | `wb-data` | `catalog`, `sync_status`, `tariffs_rules_summary` |
| Ниши | `wb-market` | `catalog`, `niche_category_summary`, `competitor_cards_summary`, `search_positions_summary` |

## Шаблоны коротких ответов

Данных нет:

> Данных за период нет: report доступен, `items=[]`. Freshness: `<sourceUpdatedAt>`, coverage: `<from> — <to>`.

Нет доступа:

> Этот report не выдан текущему worker-у. Нужен `<worker_id>` или расширение RBAC.

Источник не подключен:

> Report есть в контракте, но `available=false`. Это blocker источника, не runtime-баг.

Частичный период:

> Источник покрывает только `<from> — <to>`, поэтому вывод за запрошенный период частичный: `confidence=partial`.

Action недоступен:

> Расчет сохранен, но реальное заполнение блока складов недоступно через Agent API. Нельзя писать “заполнил в Procifry”.

ИЛ/ИРП не применены:

> Заявка создана, но ИЛ/ИРП ещё не применены в Procifry. Нельзя писать “проставил”, пока approval не выполнен.

ФФ/Китай не применены:

> Заявка создана, но остатки ФФ и партии из Китая ещё не применены в Procifry. Нельзя писать “заполнил”, пока approval не выполнен.

## Где полная версия

Полный учебник: `docs/WB_PROCIFRY_AGENT_API.md`.

Проверяемая спецификация: `src/server/agent/procifry-training.ts`.

Тесты от галлюцинаций: `src/server/agent/procifry-training.test.ts`.
