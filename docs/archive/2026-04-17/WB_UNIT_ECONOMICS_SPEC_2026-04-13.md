# WB Unit Economics Spec + Audit (2026-04-13)

## 1) Канонический контур расчета (как считать по WB)

### 1.1 Источник истины
- Финальный факт денег: `reportDetailByPeriod` + еженедельный отчет реализации WB.
- Оперативный хвост (не закрытые дни): `supplier/sales` и `supplier/orders` допускаются только как provisional.
- Тарифное планирование: `tariffs/box`, `tariffs/acceptance`, `tariffs/commission`, `paid_storage`.

### 1.2 Базовые формулы (официальный контур)
- `Итого к оплате = сумма после продажи + доплаты - удержания`.
- `Выкуп % = выкупы / (выкупы + отмены + возвраты)` (товары в пути не учитываются).
- Логистика/хранение считаются от объема, базовых ставок и коэффициентов склада.

### 1.3 Рекомендуемая формула чистой прибыли (факт)
- `Чистая прибыль = Итого к оплате WB - COGS - внешние/внутренние операционные расходы - налог`.
- Где:
  - `Итого к оплате WB` берется из финансовой детализации WB (а не из оценочной модели).
  - `COGS = сумма себестоимости по выкупленным единицам с учетом исторической effective_from`.

## 2) Спека колонок шаблона (текущий UI `/economics-template`)

Ниже формулы в терминах текущего кода `UnitEconomicsTemplateTable.tsx`.

### 2.1 Блок "База/Себестоимость"
- `Фото`, `Артикул WB`, `Артикул продавца`, `Категория`, `Литраж`, `Длина`, `Ширина`, `Высота`: из SKU + карточки WB.
- `Себестоимость` (unit): ручной ввод, fallback на `row.costPrice`, далее `row.totalCost / row.soldQuantity`.
- `Доставка до ФФ` (unit): ручной ввод.
- `Упаковка` (unit): ручной ввод.
- `Фулфилмент` (unit): ручной ввод.
- `Доставка до WB` (unit): среднее по выбранным складам (`manualFields.warehouseCosts`).
- `Себес полный с отгрузкой`:
  - `fullCost = costPrice + deliveryToFf + packaging + fulfillment + deliveryToMarketplace`.
- `Склады: логистика`: среднее `wbLogisticsPerUnit` по выбранным складам.
- `Склады: хранение`: среднее `wbStoragePerUnit` по выбранным складам.

### 2.2 Блок "Цена/скидки/выкуп"
- `Цена продавца до скидки`: `sellerPriceBeforeDiscount` (ручной ввод по сценарию).
- `Скидка Продавца %`: ручной ввод.
- `Цена до скидок WB`: `priceBeforeWbDiscount = sellerPriceBeforeDiscount * (1 - sellerDiscount/100)`.
- `Скидка WB %`: ручной ввод.
- `Цена WB`: `priceAfterWb = priceBeforeWbDiscount * (1 - wbDiscount/100)`.
- `Выкуп %`: ручной ввод (не тянется автоматически из воронки/отчетов).

### 2.3 Блок "Маркетплейс (unit)"
- `Комиссия МП %`: `categoryCommissionPercent`, fallback `row.commission / row.grossRevenue`.
- `Комиссия МП руб`: `projectedCommissionTotal = projectedRevenue * commissionPercent/100`.
- `Логистика МП средняя`: `avgWbLogisticsPerUnit`.
- `Хранение за ед среднее`: `avgWbStoragePerUnit`.
- `Итог логистики МП`:
  - `logisticsPerUnit + reverseLogisticsPerUnit * (1 - buyoutRate)`.
- `Оборачиваемость дней`: ручной ввод.
- `Хранение МП`: `storageTotalComputed = storagePerUnit * turnoverDays`.
- `Эквайринг 3%`: `acquiring = acquiringBasePerUnit * 0.03`.
- `ИТОГО МП + хранение`:
  - `projectedCommissionTotal + logisticsTotalComputed + storageTotalComputed`.
- `ИТОГО к оплате на р/с`:
  - `toSettlementAccount = projectedRevenue - (marketplacePlusStorageTotal + acquiring)`.

### 2.4 Блок "Налог и прибыль (unit)"
- `Налог %`: ручной ввод.
- `Налог в рублях`: `taxRub = taxBasePerUnit * taxPercent/100`.
- `Выручка после налога`: `revenueAfterTax = toSettlementAccount - taxRub`.
- `Прибыль в рублях`:
  - `profit_rub = revenueAfterTax - fullCost`.
- `Наценка от цены до СПП %`:
  - `((markupBasePrice - fullCost) / fullCost) * 100`.
- `Маржинальность %`:
  - `profit / revenueAfterTax * 100`.
- `Рентабельность %`:
  - `profit / fullCost * 100`.

### 2.5 Блок "Партия"
- `Кол-во к закупу ИТОГО`: ручной ввод, fallback `soldQuantity`.
- `Себестоимость`: `costPrice * qty`.
- `Доставка до ФФ`: `deliveryToFf * qty`.
- `Упаковка`: `packaging * qty`.
- `Фулфилмент`: `fulfillment * qty`.
- `Логистика до маркетплейса`: `deliveryToMarketplace * qty`.
- `Комиссия МП %`: как в unit.
- `Хранение МП`: `storageTotalComputed * qty`.
- `Логистика МП`: `logisticsTotalComputed * qty`.
- `Логистика МП до СПП`: то же (дублирует сумму логистики партии).
- `Эквайринг`: `acquiringBasePerUnit * qty * 0.03`.
- `Процент МП общий %`:
  - `((batchMarketplacePlusStorageTotal + batchAcquiringTotal) / batchRevenue) * 100`.
- `Налог %`: как в unit.
- `Сумма продаж / РЦ`: `batchRevenue = projectedRevenue * qty`.
- `ИТОГО к оплате на р/с`: `batchToSettlementAccount`.
- `Выручка после налога`: `batchRevenueAfterTax`.
- `Маржинальная прибыль`: `batchMarginalProfit = batchRevenueAfterTax - batchOperatingExpenses`.
- `Проверка должно быть 0`: `batchCheckZero`.
- `Маркетинг (внутренняя/внешний)`, `Контент`, `Другие затраты`, `CPO план`, `CPS план`: ручной ввод (в партии идут как абсолют, не умножаются на qty).
- `Валовая прибыль на 1 ед`: `batchMarginalProfit / qty`.
- `Выручка в заказах`: `batchRevenue`.
- `Оборот`: `batchRevenue` (дублирует колонку).
- `Валовая прибыль`: `batchMarginalProfit`.
- `Цена закупки`: `fullCost` (unit).
- `Прибыль с вложенного рубля %`: `batchMarginalProfit / batchOperatingExpenses * 100`.

## 3) Статус реализации после hardening (2026-04-13)

### ✅ В FACT_WB теперь зафиксировано
- Dashboard KPI/PNL:
  - без provisional-хвоста (`raw_api_sales`) в фактовом режиме;
  - источник денег: только `raw_api_realization_reports` + налоги + реклама.
- Dashboard storage contours:
  - `Хранение (фин.)` в KPI теперь считается из того же weekly-finance контура, что и прибыль (`raw_api_realization_reports.storage_fee_rub`);
  - добавлен отдельный KPI `Хранение (опер.)` из `raw_api_paid_storage.storage_amount`;
  - аудит доверия включает автоматическую проверку расхождения между двумя контурами (`storage_contour_alignment`, severity `ok/warning/critical`).
- COGS в realization-контуре:
  - себестоимость применяется только к товарным строкам (`retail_amount != 0 OR ppvz_for_pay != 0`);
  - сервисные строки WB (логистика/удержания), где денежная продажная часть равна нулю, не участвуют в расчёте `quantity * cost_price`.
- Склейка (`/api/views/dynamics`):
  - endpoint принудительно работает в `FACT_WB`;
  - `opProfit` больше не подменяется `netProfit`;
  - производные финансовые метрики (`ДРР`, `прибыль/шт`, `средняя цена выкупа`) считаются от финансовой базы (`financeRevenue`, `financeSoldQty`), а RAW-поля остаются отдельно.
- Profit report:
  - endpoint принудительно работает в `FACT_WB`;
  - текст формулы синхронизирован с реальным серверным выражением (хранение в составе `прочих удержаний`).

### ✅ Режимы расчета разделены
- `FACT_WB`: без provisional-подмешивания в dashboard/dynamics/profit-report.
- `PLAN_TEMPLATE`: допускает provisional-хвост только в сценарных расчетах (`economics-template`).

### ✅ Поля выплат и удержаний в БД/sync присутствуют
- `ppvz_for_pay`, `deduction`, `additional_payment`, `acquiring_fee`, `return_amount` хранятся в `raw_api_realization_reports`.
- В production-sync добавлены alias fallback WB API (чтобы не терять деньги в нули при смене полей WB):
  - `commission_amount` <- `commission_amount | ppvz_sales_commission`
  - `delivery_rub` <- `delivery_rub + rebill_logistic_cost`
  - `storage_fee_rub` <- `storage_fee_rub | storage_fee`
  - `penalty_rub` <- `penalty_rub | penalty`
  - `payment_schedule_rub` <- `payment_schedule_rub | payment_schedule`
- Заполняются синком реализации (`sync-wb` и `sync-finances`).

### ✅ Дополнение по складам и тарифам WB (актуализация коэффициентов)
- Базовые склады в шаблоне уточнены до целевых точек WB:
  - `Екатеринбург (Перспективная 14)`;
  - `Санкт-Петербург (Шушары)`.
- Поиск тарифа склада теперь идет через alias-контур (город, площадка, сокращения, `geoName` и `warehouseName`), а не через «первое подходящее» fuzzy-совпадение.
- Для `tariffs/box` используется индекс по двум ключам (`warehouseName` + `geoName`), чтобы точнее попадать в реальную площадку WB.
- Если WB по складу не отдает обратную логистику (`boxDeliveryMarketplace*` пусто/0), применяется fallback по базовой формуле WB:
  - `база = 46 ₽ + 14 ₽ × доп. литры` (для объёма до 1 л: 46 ₽);
  - далее применяем коэффициент обратной логистики склада (`boxDeliveryMarketplaceCoefExpr`), а если он пуст — используем множитель `1`;
  - в UI явно показывается пометка `fallback=WB <база> × <коэф>`.
- Кэш тарифов в API шаблона сокращен до `60s` для большей актуальности коэффициентов в течение дня:
  - `WB_ACCEPTANCE_TARIFFS_CACHE_TTL_MS = 60 * 1000`;
  - `WB_BOX_TARIFFS_CACHE_TTL_MS = 60 * 1000`.

## 4) Остаточные ограничения (что еще важно учитывать)

1. KPI `% выкупа` в карточке дашборда — это конверсионная метрика `buyouts/orders` из funnel-слоя, а не экономическая формула `buyouts/(buyouts+cancels+returns)`.
2. Рекламный слой использует приоритет `ad_costs` и fallback на `ad_clusters` при отсутствии `ad_costs`; это снижает расхождения, но требует контроля полноты загрузки `ad_costs`.
3. `economics-template` остается управленческой моделью (what-if), а не бухгалтерским 1:1 отчетом WB.

## 5) Операционный вывод

- Для финансовых решений и контроля прибыли используем:
  - dashboard KPI (в FACT_WB),
  - profit-report (в FACT_WB),
  - dynamics (в FACT_WB, с финансовыми производными).
- Для планирования сценариев и цен:
  - economics-template (PLAN_TEMPLATE).
