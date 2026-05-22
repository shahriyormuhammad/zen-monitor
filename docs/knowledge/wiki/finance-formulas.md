# Финансовые формулы

## Суть

Финансовая логика проекта разделяет фактическую экономику WB и плановый расчет партии в юнит-экономике.

Главное правило: себестоимость для PnL и валовой прибыли берется как полная себестоимость единицы, а рекламные показатели CPO/CPS считаются только от внутреннего маркетинга WB.

## Как работает сейчас

Фактический PnL строится вокруг `payout_before_cost`, `quantity_for_cost`, полной себестоимости и рекламы:

```text
cost_total = quantity_for_cost * full_landed_cost
profit_before_tax = payout_before_cost - cost_total - ad_spend
net_profit = profit_before_tax - tax
```

Полная себестоимость единицы описана в [Себестоимость и юнит-экономика](costing-and-unit-economics.md).

В юнит-экономике плановая партия считается от выбранного сценария цены, процента выкупа и `purchaseQtyTotal`:

```text
planned_orders = purchaseQtyTotal / buyoutPercent
batchRevenue = priceAfterWb * purchaseQtyTotal
batchRevenueInOrders = priceAfterWb * planned_orders
batchMarginalProfit = batchRevenueAfterTax - costs_before_marketing
batchGrossProfit = batchMarginalProfit - marketingInternal - marketingExternal - contentCost - otherCosts
```

ДРР:

```text
ДРР в заказах = marketingInternal / batchRevenueInOrders * 100
ДРР в выкупах = marketingInternal / batchRevenue * 100
```

Если пользователь вручную ставит `ДРР в заказах`, то `marketingInternal` считается автоматически:

```text
marketingInternal = batchRevenueInOrders * drrPercent / 100
```

CPO/CPS:

```text
CPO = marketingInternal / planned_orders
CPS = marketingInternal / purchaseQtyTotal
```

`marketingExternal`, `contentCost`, `otherCosts` не входят в CPO/CPS, потому что это не рекламная стоимость заказа/продажи внутри WB.

## Правила изменения

- Не считать CPO/CPS от внешнего маркетинга, контента или прочих затрат.
- `ДРР в заказах` может быть ручным входом, `ДРР в выкупах` должен считаться от того же `marketingInternal`.
- Для PnL использовать полную себестоимость, не только закупку.
- Если меняется налоговая логика, проверять `src/lib/tax/regimes` и SQL helpers.
- Если меняется расчет партии, обновить Excel export и подсказки колонок.

## Риски

- Если CPO/CPS считать от всех маркетинговых затрат, рекламная экономика будет завышена.
- Если ДРР считать от выкупов вместо заказов, план бюджета будет отличаться от фактического закупа трафика.
- Если использовать `purchasePrice` вместо полной себестоимости в PnL, прибыль будет завышена.

## Источники

- `src/server/analytics/services/economics.ts`
- `src/server/analytics/helpers/sql-builders.ts`
- `src/components/economics/row-summary.ts`
- `src/components/economics/table/columns.ts`
- `src/components/economics/table/cellValue.ts`
- `src/components/economics/table/excelExport.ts`
- `src/server/agent/cost-breakdown-detail.ts`
