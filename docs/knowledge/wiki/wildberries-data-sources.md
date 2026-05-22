# Источники данных Wildberries

## Суть

Данные WB приходят в raw-таблицы, затем используются аналитическими сервисами, дашбордами, остатками, юнит-экономикой и Agent API.

Перед изменением расчета важно понимать не название виджета, а конкретный источник данных и его свежесть.

## Как работает сейчас

Основные источники:

- Товары и карточки: `products`, `raw_api_product_metadata`.
- Заказы: `raw_api_orders`.
- Продажи: `raw_api_sales`.
- Финальный финансовый отчет WB: `raw_api_realization_reports`.
- Реклама по SKU: `raw_api_ad_costs`; fallback/дополнение по кластерам: `raw_api_ad_clusters`.
- Воронка продаж: `raw_api_funnel_stats`.
- Остатки WB: `raw_api_stocks`, `raw_api_stock_sizes`, `raw_api_stock_offices`.
- Региональные продажи и ФО: `raw_api_region_sales`.
- Платное хранение: `raw_api_paid_storage`.
- Цены: `raw_api_prices`, `raw_api_price_snapshots`.
- Себестоимость и ручные настройки: `unit_economics_manual_inputs`, fallback `unit_economics_configs`.

`sync-wb` грузит WB-источники и обновляет `products`. Каталог должен включать все наблюдаемые SKU: карточки, заказы, продажи, realization, рекламу, метаданные и уже существующие продукты.

## Где используется

- Dashboard/PnL: realization, sales tail, ad costs, full landed cost.
- Юнит-экономика: каталог SKU, цены, воронка, себестоимость, тарифы складов.
- Себестоимость: ручные поля на SKU и доставка до ВБ по выбранным складам.
- Остатки 2.0: products, stocks, funnel orders, realization, region sales, production orders, full landed cost.
- Agent API: reports поверх тех же источников с freshness/coverage.

## Правила изменения

- Не фильтровать SKU только по продажам за последние дни, если задача требует весь кабинет.
- Старые товары без продаж должны попадать вниз списка, а не исчезать.
- Для финансовых ответов обязательно учитывать coverage realization: хвост периода может быть provisional.
- Для рекламы основной источник `raw_api_ad_costs`; fallback надо явно помечать.
- Для остатков брать самый свежий snapshot, а не смешивать разные даты без явной агрегации.

## Риски

- Однодневные запросы к части источников могут возвращать более широкое окно; это нужно явно маркировать в ответах Agent API.
- Разные WB API имеют разные задержки свежести, поэтому нельзя молча смешивать final realization и оперативные sales/orders.
- Если скрытие SKU применяется на уровне `products.is_hidden`, оно влияет на витрины и расчеты, где явно исключены скрытые товары.

## Источники

- `src/inngest/sync-wb.ts`
- `src/server/catalog/observed-products.ts`
- `src/lib/db/schema.ts`
- `src/server/analytics/services/economics.ts`
- `src/server/analytics/stocks-v2/service.ts`
- `src/server/agent/reports.ts`
- `docs/PROJECT_GUIDE.md`
- `docs/WB_PROCIFRY_AGENT_API.md`
