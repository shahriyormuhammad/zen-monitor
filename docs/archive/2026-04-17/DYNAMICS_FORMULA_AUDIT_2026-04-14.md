# Аудит формул динамики склейки (2026-04-14)

## 1) Использованные источники WB (официальные)

1. Sales Funnel API (`/api/analytics/v3/sales-funnel/products`): структура полей `orderCount`, `orderSum`, `buyoutCount`, `buyoutSum`, `cancelCount`, `conversions.addToCartPercent`, `conversions.cartToOrderPercent`, `conversions.buyoutPercent`  
   Источник: https://dev.wildberries.ru/en/docs/openapi/analytics
2. Reports API (`/api/v1/supplier/orders`, `/api/v1/supplier/sales`): данные предварительные (для операционного мониторинга), финансовая сверка должна идти через realization report  
   Источник: https://dev.wildberries.ru/en/docs/openapi/reports
3. Financial Reports API (`/api/v5/supplier/reportDetailByPeriod`): детализация отчётов реализации (финансовый факт)  
   Источник: https://dev.wildberries.ru/en/docs/openapi/financial-reports-and-accounting
4. Инструкция WB Media: формула ДРР  
   `ДРР = расходы на рекламу / выручка от продажи рекламируемых товаров * 100`  
   Источник: https://seller.wildberries.ru/instructions/ru/ru/material/how-to-evaluate-results-of-advertisement
5. Инструкция “Отчёт «Данные отчёта»”: формула `% выкупа` и воронки  
   `% выкупа = выкупы / (выкупы + отмены + возвраты) * 100`  
   `конверсия в корзину = добавили в корзину / открыли карточку * 100`  
   `конверсия в заказ = заказали / добавили в корзину * 100`  
   Источник: https://seller.wildberries.ru/instructions/ru/ru/material/data-report

## 2) Блок: Общая прибыль склейки

| Метрика | Эталон/формула | Было в реализации | Стало в реализации |
|---|---|---|---|
| ЧП склейка без рекламы | Внутренняя производная: `netProfit + adSpend` | Уже так | Без изменений |
| ЧП склейка с рекламой | Внутренняя производная от financial fact (`reportDetailByPeriod`) | Уже так | Без изменений |
| Бюджет рекламы (общий) | Сумма рекламных расходов | Уже так (`adSpend`) | Без изменений |
| ДРР (общий) | WB: `adSpend / revenue_from_orders * 100` | Считался от базы выкупов (`financeRevenue`/`revenue`) | Переведён на базу заказов: `funnelOrderRevenue`, fallback `orderRevenue` |
| Заказы | WB funnel `orderCount` | Уже так (`funnelOrderQty`) | Без изменений |
| Выкупы | WB funnel `buyoutCount` | Уже так (`funnelBuyoutQty`) | Без изменений |
| % выкупа | WB: `buyout/(buyout+cancel+return)` или `conversions.buyoutPercent` | Считался как `buyout/orders` | Приоритет WB-поля `funnelOrderToBuyoutPercent`, fallback `buyout/(buyout+cancel)` |
| Оборотка / заказы | WB funnel `orderSum` | Уже использовалась сумма заказов | Без изменений |
| Оборотка / выкупы | WB funnel `buyoutSum` / finance fact для денежного контура | Уже так (в таблице отдельные поля) | Без изменений |
| Средняя цена / заказы | Производная: `orderSum/orderCount` | Считалась как `orderRevenue/orderQty` (raw orders база) | Переведена на funnel-базу: `funnelOrderRevenue/funnelOrderQty`, fallback raw |
| Средняя цена / выкупы | Производная: `buyout_sum/buyout_count` (или financial revenue / sold qty в финансовом контуре) | Уже так | Без изменений |
| Хранение склейки | Сумма `paid_storage` (операционный контур) | Уже так | Без изменений |
| Прибыль на единицу | Внутренняя производная: `netProfit / soldQty` | Уже так | Без изменений |

## 3) Блок: Поартикульно

| Метрика | Эталон/формула | Было в реализации | Стало в реализации |
|---|---|---|---|
| Прибыль общая с рекламой | Внутренняя производная от financial fact | Уже так | Без изменений |
| Прибыль на шт с рекламой | `netProfit / soldQty` | Уже так | Без изменений |
| Стоимость заказа | `orderSum/orderCount` | Считалась от raw orders | Переведена на funnel-базу (fallback raw) |
| Стоимость выкупа | `buyoutSum/buyoutCount` (финансовый контур допускается) | Уже так | Без изменений |
| Реклама | Сумма расходов по рекламе | Уже так | Без изменений |
| ДРР | WB формула из инструкции WB Media | Считалась от базы выкупов | Переведена на базу заказов |
| Заказы | `orderCount` | Уже так | Без изменений |
| Выкупы | `buyoutCount` | Уже так | Без изменений |
| Хранение | Сумма `paid_storage` | Уже так | Без изменений |
| % Выкупа | WB buyout rate | Считался как `buyout/orders` | Приоритет WB `orderToBuyoutPercent`, fallback `buyout/(buyout+cancel)` |
| Заказы всего на сумму | `orderSum` | Уже так | Без изменений |
| Переходы | `openCardCount` | Уже так | Без изменений |
| Добавили в корзину | `addToCartCount` | Уже так | Без изменений |
| % Добавления в корзину | WB: `addToCart/openCard * 100` (или готовый `addToCartPercent`) | Уже брали готовый WB-процент | Без изменений |
| % Добавили в заказ | WB: `order/addToCart * 100` (или готовый `cartToOrderPercent`) | Уже брали готовый WB-процент | Без изменений |

## 4) Изменённые файлы реализации

1. `src/server/analytics/engine.ts`
   - добавлено поле `funnelCancelQty` в поток `getGroupDynamics`;
   - обновлены формулы `drr`, `buyoutPercent`, `avgOrderPrice` для group и sku.
2. `src/components/dashboard/DynamicsTable.tsx`
   - синхронизирован `buildSeriesSummary` с серверной формульной логикой (ДРР, % выкупа, стоимость заказа).
