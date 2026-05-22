# Dashboard KPI E2E Audit - 2026-05-06

## Scope

Проверен текущий дашборд WB Analytics: карточки KPI, формулы в коде, источники WB API, drilldown и места, где показатель является не официальной метрикой WB, а нашей управленческой формулой.

Текущий UI объединяет 14 исходных метрик в 10 карточек:

- `Заказы`: заказано, сумма заказов.
- `Выкупы`: выкуплено, сумма выкупов, процент выкупа.
- `Финансы`: выручка, чистая прибыль.
- `Затраты`: все расходы, ROI.
- `Реклама`: расход рекламы, ДРР/доля выручки.
- `Хранение`: расход хранения, доля выручки.
- `Маржа`: маржинальность, рентабельность.
- `Остатки WB`: на складе, к клиенту, от клиента.
- `Диагностика`: конверсия, локализация.
- `SPP WB`: средний SPP за период или snapshot.

## Sources Checked

Official WB:

- [Finance API: sales reports detailed](https://dev.wildberries.ru/en/docs/openapi/financial-reports-and-accounting) - новый `POST /api/finance/v1/sales-reports/detailed`, лимит 1 запрос/мин, данные с 2024-01-29.
- [WB release notes 2026-04-15](https://dev.wildberries.ru/en/release-notes?id=494) - новый Finance API, старый `GET /api/v5/supplier/reportDetailByPeriod` отключается 2026-07-15.
- [Reports API: orders/sales](https://dev.wildberries.ru/en/docs/openapi/reports) - orders/sales являются предварительными, sales не подходят для точных финансовых расчётов.
- [Analytics API: sales funnel](https://dev.wildberries.ru/en/docs/openapi/analytics) - воронка обновляется раз в час, выкупы/отмены относятся к дате заказа, финальные итоги надо сверять с отчётами реализации.
- [Promotion API: fullstats](https://dev.wildberries.ru/en/docs/openapi/promotion) - `GET /adv/v3/fullstats`, максимум 31 день, статусы кампаний 7/9/11, лимит 3 запроса/мин с 20 сек интервалом.
- [Reports API: paid storage](https://dev.wildberries.ru/en/docs/openapi/reports) - task-flow, окно до 8 дней, download 1 запрос/мин.
- [Analytics API: stocks](https://dev.wildberries.ru/en/docs/openapi/analytics) and [WB March 2026 digest](https://dev.wildberries.ru/en/news/302) - новый stocks endpoint, текущий snapshot, старый `/api/v1/supplier/stocks` отключается 2026-06-23.

GitHub / SDK practice:

- [eslazarev/wildberries-sdk finance OpenAPI spec](https://raw.githubusercontent.com/eslazarev/wildberries-sdk/main/specs/13-finances.yaml)
- [eslazarev/wildberries-sdk analytics OpenAPI spec](https://raw.githubusercontent.com/eslazarev/wildberries-sdk/main/specs/11-analytics.yaml)
- [eslazarev/wildberries-sdk promotion OpenAPI spec](https://raw.githubusercontent.com/eslazarev/wildberries-sdk/main/specs/08-promotion.yaml)
- [eslazarev/wildberries-sdk reports OpenAPI spec](https://raw.githubusercontent.com/eslazarev/wildberries-sdk/main/specs/12-reports.yaml)
- [lanzay/wildberries Go types](https://pkg.go.dev/github.com/lanzay/wildberries/types) - field semantics for `forPay`, `priceWithDisc`, `finishedPrice`, stock quantities.

## Code Map

- KPI labels and help text: `src/components/dashboard/KPICards.tsx`.
- KPI formulas: `src/server/analytics/services/economics.ts`, `getKpis`.
- Profit breakdown: `src/server/analytics/services/economics.ts`, `getNetProfitBreakdown`.
- Drilldown API: `src/app/api/views/kpi-drilldown/route.ts`.
- WB API client: `src/lib/wb-api/index.ts`.
- Sync source order: `src/server/jobs/wb-sync-sources.ts`.

## Audit Matrix

| KPI | Current formula/source | WB / practice check | Verdict |
| --- | --- | --- | --- |
| Заказы, шт | Prefer WB funnel `orderCount`; fallback `raw_api_orders` without cancelled orders. | WB says orders endpoint is operational/preliminary; funnel gives card analytics and is updated hourly. | OK. Correct for demand, not for money. Keep quality badge. |
| Сумма заказов | Prefer WB funnel `orderSum`; fallback raw orders total. | Same as orders: it is demand value, not revenue. | OK. Label must keep "это не выручка". |
| Выкупы, шт | Prefer exact funnel `buyoutCount`; if no exact funnel, finance/sales fallback. | WB funnel has `buyoutCount`; final sales results are still realization reports. | OK with caveat. Exact only when funnel coverage exists. |
| Сумма выкупов | `buyoutSum` from exact funnel only; otherwise `н/д`. | WB funnel provides `buyoutSum`; fallback from finance would change semantics. | OK. Better to keep `н/д` than fake sum. |
| Процент выкупа | `buyouts / (buyouts + cancels) * 100` when exact funnel exists. | WB exposes `buyoutPercent`; this formula matches closed outcomes and avoids counting unresolved orders as failures. | OK. Use only exact funnel. |
| Выручка | `mv_daily_pnl_final.revenue = retail_amount`; optional provisional tail for days after final report. | WB says use realization report details for accurate finance; `retailAmount`/legacy `retail_amount` is buyer-paid value after WB discounts. | OK. This is buyer-paid revenue, not seller list price. |
| Чистая прибыль | `payout_before_cost - себестоимость - реклама - налог`; `payout_before_cost` prefers `forPay/ppvz_for_pay`, fallback from seller price after seller discount minus WB fees. | WB Finance detailed has `forPay`, `retailPriceWithDisc`, `retailAmount`; SDK practice treats `priceWithDisc` as seller-price base for seller remuneration. | OK after previous fix. Tax base remains buyer-paid revenue. |
| Налог | Shared tax engine. For income regimes: tax from `tax_base_revenue`; for profit regimes: profit base with minimum floors where configured. | WB is not tax authority, but WB finance gives the money base. For this cabinet, user rule is AУСН 8% from buyer-paid base. | OK for configured management model. |
| Все расходы | `revenue - netProfit`. Drilldown decomposes WB fees, cost, ads, storage, tax. | WB has no single official "all expenses" KPI. | Conditional OK. This is internal management KPI; label should say "расходы и удержания". |
| ROI | `netProfit / allExpenses * 100`. | Not WB official. Common management ROI formula, but denominator must be clearly named. | Conditional OK. Keep, but label as our ROI. |
| Маржинальность | `profitBeforeTax / revenue * 100`. | Not WB official, but standard PnL ratio. | Conditional OK. Clear label: before tax. |
| Рентабельность | `netProfit / revenue * 100`. | Not WB official, but standard net margin. | OK as management metric. |
| Реклама | Spend from `raw_api_ad_costs` based on `adv/v3/fullstats`; fallback `ad_clusters`. | WB fullstats has `sum`, `orders`, `sum_price`, max 31-day window and strict rate limits. | OK. Proxy badge is required when exact attributed order sum is absent. |
| ДРР / доля рекламы | If WB attributed `order_sum > 0`: `ads / adsOrderSum`; else `ads / revenue`. | WB fullstats supports attributed order sum; revenue fallback is not WB-attributed DRR. | Conditional OK. Must display `точно WB` vs `proxy`. |
| Хранение | Finance storage from final reports + paid-storage tail. | Paid storage is separate task-flow up to 8 days; finance reports remain final source. | OK. Tail must be marked preliminary. |
| Остатки WB | Latest `raw_api_stocks` snapshot: stock, in way to client, in way from client. | New WB stocks endpoints are current snapshot, not period sum. Old supplier stocks is deprecated 2026-06-23. | OK. Never compare as monthly total. |
| Конверсия | `orders / openCardCount * 100` from funnel. | WB funnel returns opens and orders, updates hourly; some data can arrive later. | OK when funnel coverage exists. Otherwise `н/д`. |
| Локализация | Latest successful redistribution run before period end. | WB funnel has `localizationPercent`, but our card currently uses route-scan model, not official WB number. | Conditional OK. Label must say "наша оценка". |
| SPP WB | Finance: `spp_rub / (revenue + spp_rub) * 100`; fallback latest price snapshot. | WB sales fields split seller price and buyer-paid amount; SPP changes over time, so period average is correct for PnL. | OK with caveat. Label must say "средний за период". |

## Findings

### Fixed Now

1. `getNetProfitBreakdown` did not return `taxBaseRevenue` and `payoutBeforeCost` even though it calculated them in SQL. This could make drilldown/CSV less auditable. Fixed in `src/server/analytics/services/economics.ts`.
2. The provisional tail in `getNetProfitBreakdown` used a hardcoded `15% + 50 ₽` estimate. Replaced with the same historical SKU payout ratio approach used by KPI calculations, so finance drilldown and KPI logic are aligned.

### Main Risks Left

1. `Все расходы` and `ROI` are not official WB metrics. They are useful, but must stay explicitly labelled as management formulas.
2. `ДРР` can be exact only when WB fullstats returns attributed `sum_price/order_sum`. If not, we show a revenue proxy and must not present it as WB-attributed.
3. `Остатки`, `SPP snapshot`, `локализация` are snapshot/derived metrics. They should not be interpreted as period totals.
4. Raw `orders` and `sales` are operational. WB explicitly says sales v1 can be incomplete/async and should not be used for accurate finance reconciliation.

## Recommendations

Add:

- `Средний чек`: `orderSum / orders`. It already exists in the backend as `avgCheck`; expose in the order drilldown first, not necessarily as a separate card.
- `Прибыль на 1 выкуп`: `netProfit / buyouts`. Very useful for SKU comparison.
- `CPO рекламы`: `ads / attributedOrders` when fullstats order count exists; otherwise show `proxy`.
- `Запас в днях / оборачиваемость`: use WB stock metrics already parsed from stocks-report products (`saleRate`, `avgStockTurnover`, `lostOrders`). This is more useful than just "остатки штук".
- Data quality row per KPI: exact WB / final WB / preliminary / proxy / snapshot. Partially done in UI, should be kept everywhere including drilldown.

Keep, but rename/clarify:

- `Все расходы` -> `Расходы и удержания`.
- `ROI` -> `ROI по чистой прибыли`.
- `SPP WB` -> `Средний SPP за период`.
- `Локализация` -> `Локализация остатков, наша оценка`.

Do not add as top cards yet:

- Separate `Сумма заказов`, `Сумма выкупов`, `Чистая прибыль` as standalone cards. They already fit better inside combined semantic cards.
- Current-day SPP as "truth for period". It must be a snapshot stream if we want to use it operationally.

## E2E Verdict

The main dashboard formulas are directionally correct and aligned with WB source semantics after the recent finance/payout/tax fixes. The biggest remaining task is not formula math, but data-trust communication: every KPI must clearly show whether it is final WB, operational WB, proxy, or our own model.

Next audit step: run numeric reconciliation for both cabinets against downloaded WB exports from 2026-01-01 to 2026-05-06, metric by metric, and attach deltas to this document.
