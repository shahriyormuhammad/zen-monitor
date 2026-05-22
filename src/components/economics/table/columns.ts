export type TemplateColumn = {
  id: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  minWidthClass?: string;
};

export const COLUMNS: TemplateColumn[] = [
  { id: 'photo', label: 'Фото', align: 'center', minWidthClass: 'min-w-[112px]' },
  { id: 'article', label: 'Артикул WB', minWidthClass: 'min-w-[104px]' },
  { id: 'seller_article', label: 'Артикул продавца', minWidthClass: 'min-w-[140px]' },
  { id: 'category', label: 'Категория', minWidthClass: 'min-w-[110px]' },
  { id: 'volume', label: 'Литраж\n(карточка)', align: 'right', minWidthClass: 'min-w-[96px]' },
  { id: 'wb_volume', label: 'Литраж\nфакт. WB', align: 'right', minWidthClass: 'min-w-[96px]' },
  { id: 'length', label: 'Длина', align: 'right', minWidthClass: 'min-w-[64px]' },
  { id: 'width', label: 'Ширина', align: 'right', minWidthClass: 'min-w-[68px]' },
  { id: 'height', label: 'Высота', align: 'right', minWidthClass: 'min-w-[68px]' },
  { id: 'cost_price_1', label: 'Товар закупка', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'delivery_to_ff_1', label: 'Доставка до ФФ', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'packaging_1', label: 'Упаковка', align: 'right', minWidthClass: 'min-w-[96px]' },
  { id: 'fulfillment_1', label: 'Фулфилмент', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'delivery_to_mp_1', label: 'Доставка до\nВБ', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'full_cost', label: 'Себес полный\nс отгрузкой', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'warehouse_logistics', label: 'Склады:\nлогистика', align: 'right', minWidthClass: 'min-w-[104px]' },
  { id: 'warehouse_storage', label: 'Склады:\nхранение', align: 'right', minWidthClass: 'min-w-[104px]' },
  { id: 'separator', label: '', minWidthClass: 'min-w-[12px]' },
  { id: 'price', label: 'Цена продавца\nдо скидки', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'seller_discount', label: 'Скидка Продавца', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'wb_price_before_discount', label: 'Цена до\nскидок WB', align: 'right', minWidthClass: 'min-w-[110px]' },
  { id: 'wb_discount', label: 'Скидка WB', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'price_after_wb', label: 'Цена WB', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'buyout', label: 'Выкуп\nручной', align: 'right', minWidthClass: 'min-w-[92px]' },
  { id: 'buyout_auto', label: 'Выкуп\nавто', align: 'right', minWidthClass: 'min-w-[92px]' },
  { id: 'marketplace_fee_percent_1', label: 'Комиссия МП %', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'marketplace_logistics_avg', label: 'Логистика до\nклиента с ИЛ', align: 'right', minWidthClass: 'min-w-[132px]' },
  { id: 'marketplace_storage_avg', label: 'Хранение за ед\nсреднее / день', align: 'right', minWidthClass: 'min-w-[144px]' },
  { id: 'marketplace_logistics_total', label: 'Итог логистики\nс % выкупа и ИРП', align: 'right', minWidthClass: 'min-w-[148px]' },
  { id: 'turnover_days', label: 'Оборачиваемость дней', align: 'right', minWidthClass: 'min-w-[156px]' },
  { id: 'marketplace_storage_total_1', label: 'Хранение МП', align: 'right', minWidthClass: 'min-w-[108px]' },
  { id: 'acquiring_3', label: 'Эквайринг 3%', align: 'right', minWidthClass: 'min-w-[110px]' },
  { id: 'marketplace_fee_rub', label: 'Комиссия МП руб', align: 'right', minWidthClass: 'min-w-[132px]' },
  { id: 'marketplace_plus_storage_total', label: 'ИТОГО МП + хранение\n+ эквайринг', align: 'right', minWidthClass: 'min-w-[152px]' },
  { id: 'to_settlement_account_1', label: 'ИТОГО к оплате\nна р/с', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'tax_percent_1', label: 'Налог', align: 'right', minWidthClass: 'min-w-[88px]' },
  { id: 'tax_rub_1', label: 'Налог в рублях', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'revenue_after_tax_1', label: 'Выручка после\nналога', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'profit_rub', label: 'Прибыль в рублях', align: 'right', minWidthClass: 'min-w-[136px]' },
  { id: 'markup_from_price_to_spp', label: 'Наценка', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'margin', label: 'Маржинальность', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'profitability', label: 'Рентабельность', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'purchase_qty_total', label: 'Кол-во к закупу\nИТОГО', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'cost_price_2', label: 'Товар закупка\n(партия)', align: 'right', minWidthClass: 'min-w-[128px]' },
  { id: 'delivery_to_ff_2', label: 'Доставка до ФФ', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'packaging_2', label: 'Упаковка', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'fulfillment_2', label: 'Фулфилмент', align: 'right', minWidthClass: 'min-w-[104px]' },
  { id: 'delivery_to_mp_2', label: 'Доставка до\nВБ', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'marketplace_fee_percent_2', label: 'Комиссия МП\nруб (партия)', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'marketplace_storage_total_2', label: 'Хранение МП', align: 'right', minWidthClass: 'min-w-[108px]' },
  { id: 'marketplace_logistics_2', label: 'Логистика МП', align: 'right', minWidthClass: 'min-w-[116px]' },
  { id: 'acquiring', label: 'Эквайринг', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'marketplace_logistics_to_spp', label: 'Логистика МП\nдо СПП %', align: 'right', minWidthClass: 'min-w-[116px]' },
  { id: 'marketplace_percent_total', label: 'Процент МП\nобщий', align: 'right', minWidthClass: 'min-w-[108px]' },
  { id: 'tax_rub_2', label: 'Налог в рублях\n(партия)', align: 'right', minWidthClass: 'min-w-[128px]' },
  { id: 'sales_sum_per_rc', label: 'Сумма продаж / РЦ', align: 'right', minWidthClass: 'min-w-[140px]' },
  { id: 'to_settlement_account_2', label: 'ИТОГО к оплате\nна р/с', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'revenue_after_tax_2', label: 'Выручка после\nналога', align: 'right', minWidthClass: 'min-w-[120px]' },
  { id: 'marginal_profit', label: 'Маржинальная прибыль', align: 'right', minWidthClass: 'min-w-[164px]' },
  { id: 'drr_percent', label: 'ДРР\nв заказах', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'drr_percent_buyouts', label: 'ДРР\nв выкупах', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'marketing_internal', label: 'Маркетинг (внутренняя)', align: 'right', minWidthClass: 'min-w-[176px]' },
  { id: 'marketing_external', label: 'Маркетинг (внешний)', align: 'right', minWidthClass: 'min-w-[156px]' },
  { id: 'content_cost', label: 'Контент', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'other_costs', label: 'Другие затраты', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'cpo_plan', label: 'CPO\nстоимость 1 заказа', align: 'right', minWidthClass: 'min-w-[148px]' },
  { id: 'cps_plan', label: 'CPS\nстоимость 1 продажи', align: 'right', minWidthClass: 'min-w-[152px]' },
  { id: 'gross_profit_per_unit', label: 'Валовая прибыль\nна 1 ед', align: 'right', minWidthClass: 'min-w-[124px]' },
  { id: 'revenue_in_orders', label: 'Выручка в заказах', align: 'right', minWidthClass: 'min-w-[140px]' },
  { id: 'turnover', label: 'Оборот', align: 'right', minWidthClass: 'min-w-[100px]' },
  { id: 'gross_profit', label: 'Валовая прибыль', align: 'right', minWidthClass: 'min-w-[128px]' },
  { id: 'purchase_price', label: 'Полная стоимость партии', align: 'right', minWidthClass: 'min-w-[176px]' },
  { id: 'invested_rub_profit_percent', label: 'Прибыль с\nвложенного рубля %', align: 'right', minWidthClass: 'min-w-[148px]' },
];

export const STICKY_IDENTITY_COLUMN_CLASSES: Record<string, string> = {
  photo: 'sticky left-0',
};

export function resolveStickyIdentityColumnClass(columnId: string): string {
  return STICKY_IDENTITY_COLUMN_CLASSES[columnId] ?? '';
}

export const STRONG_GROUP_SEPARATOR_COLUMNS = new Set([
  'full_cost',
  'warehouse_storage',
  'buyout_auto',
  'marketplace_plus_storage_total',
  'profitability',
]);

/**
 * Plain-language help for each column: «что это» and «откуда берётся / как заполнять».
 * Shown as a tooltip on the header (cursor-help cursor + native title attribute)
 * along with the formula from COLUMN_FORMULA_HINTS, if any. Editable cells get an
 * explicit hint about what to type; computed cells describe the calculation.
 */
export const COLUMN_HELP_HINTS: Record<string, string> = {
  // Identity / geometry
  photo: 'Главное фото из карточки WB. Кликни по строке артикула — раскроется детальная панель.',
  article: 'Артикул WB (nmId). Клик — раскрыть/свернуть строку с деталями склада и финансов.',
  seller_article: 'Артикул продавца (vendorCode) из карточки WB.',
  category: 'Предмет (subjectName) из карточки WB. Используется для подбора комиссии.',
  volume: 'Литраж по карточке: парсится из поля «объём» / Д×Ш×В. Информационная колонка, в расчёте логистики НЕ используется.',
  wb_volume: 'Литраж факт. WB — из /api/v1/warehouse_remains. Это значение использует WB для расчёта логистики и хранения. Если у строки нет факта — логистика 0.',
  length: 'Длина в см из карточки.',
  width: 'Ширина в см из карточки.',
  height: 'Высота в см из карточки.',

  // Cost structure (per-unit)
  cost_price_1: 'Товар закупка за единицу (₽). Берётся из раздела «Себестоимость» и применяется ко всем расчётам прибыли.',
  delivery_to_ff_1: 'Доставка единицы до фулфилмента (₽). Берётся из раздела «Себестоимость».',
  packaging_1: 'Стоимость упаковки на единицу (₽). Берётся из раздела «Себестоимость».',
  fulfillment_1: 'Стоимость фулфилмента на единицу (₽) — упаковка/маркировка/обработка. Берётся из раздела «Себестоимость».',
  delivery_to_mp_1: 'Доставка до ВБ на единицу (₽). Считается как средняя по выбранным складам блока «Склады ВБ» в разделе «Себестоимость».',
  full_cost: 'Полная себестоимость с отгрузкой = товар закупка + доставка до ФФ + упаковка + фулфилмент + доставка до ВБ.',
  warehouse_logistics: 'Средняя логистика WB по выбранным складам. Считается по формуле WB на текущий литраж факт. WB.',
  warehouse_storage: 'Среднее хранение WB по выбранным складам (₽/день).',

  // Price scenario (manual)
  price: 'Цена продавца до скидки (₽). Введи вручную — это цена, которую видит WB до твоей скидки.',
  seller_discount: 'Скидка продавца (%) — от цены до скидки.',
  wb_price_before_discount: 'Цена до скидок WB = цена продавца × (1 − скидка продавца %). Расчётная.',
  wb_discount: 'Скидка WB (%). Если поле пусто — берётся глобальная «Скидка WB» из шапки.',
  price_after_wb: 'Цена WB = цена до скидок WB × (1 − скидка WB %). По ней WB продаёт товар.',
  buyout: 'Ручной выкуп (%) — fallback для новых SKU и товаров без 30 дней истории продаж.',
  buyout_auto: 'Авто-выкуп (%) из официальной WB-воронки. Используется только при истории SKU ≥ 30 дней, закрытых заказах ≥ 10 и доле незакрытых заказов ≤ 40%.',

  // Marketplace fees & logistics
  marketplace_fee_percent_1: 'Комиссия МП (%). Auto: из категории WB (paidStorageKgvp / kgvpMarketplace). FBS: kgvpMarketplace.',
  marketplace_fee_percent_2: 'Комиссия МП × кол-во к закупу (партия).',
  marketplace_logistics_avg: 'Логистика до клиента с ИЛ = средняя forward-доставка по выбранным складам с учётом коэф склада и ИЛ.',
  marketplace_storage_avg: 'Хранение за ед среднее / день = средняя дневная ставка хранения WB по выбранным складам.',
  marketplace_logistics_total: 'Итог логистики с % выкупа и ИРП: forward × ИЛ + (1−выкуп) × reverse + цена × ИРП. Reverse считается только от литража, без коэф склада, ИЛ и ИРП.',
  turnover_days: 'Оборачиваемость в днях. Введи вручную — для расчёта стоимости хранения.',
  marketplace_storage_total_1: 'Хранение МП = среднее хранение × оборачиваемость дней.',
  acquiring_3: 'Эквайринг 3% от цены до скидки WB.',
  marketplace_fee_rub: 'Комиссия МП в ₽ = цена до скидки WB × комиссия %.',
  marketplace_plus_storage_total: 'ИТОГО МП + хранение + эквайринг = комиссия + логистика МП + хранение МП + эквайринг.',
  to_settlement_account_1: 'ИТОГО к оплате на р/с = цена до скидки WB − ИТОГО МП.',

  // Tax & profit (per-unit)
  tax_percent_1: 'Налог (%). Auto: из настроек тенанта (если задан). Manual: переопределить в поле.',
  tax_rub_1: 'Налог в ₽ = цена WB × налог %.',
  revenue_after_tax_1: 'Выручка после налога = ИТОГО к оплате на р/с − налог.',
  profit_rub: 'Прибыль на единицу = выручка после налога − полная себес.',
  markup_from_price_to_spp: 'Наценка к полной себестоимости = цена до скидки WB / полная себес. Показывается как «×N.NN» (во сколько раз цена выше себестоимости).',
  margin: 'Маржинальность = (прибыль / цена до скидки WB) × 100%.',
  profitability: 'Рентабельность = (прибыль / полная себес) × 100%.',

  // Batch (purchase qty * per-unit)
  purchase_qty_total: 'Кол-во к закупу ИТОГО. Введи вручную — сколько единиц планируешь закупить. Если пусто — берётся факт. продаж за период.',
  cost_price_2: 'Товар закупка × кол-во к закупу.',
  delivery_to_ff_2: 'Доставка до ФФ × кол-во.',
  packaging_2: 'Упаковка × кол-во.',
  fulfillment_2: 'Фулфилмент × кол-во.',
  delivery_to_mp_2: 'Доставка до ВБ × кол-во.',
  marketplace_storage_total_2: 'Хранение МП × кол-во.',
  marketplace_logistics_2: 'Логистика МП × кол-во.',
  acquiring: 'Эквайринг × кол-во.',
  marketplace_logistics_to_spp: 'Логистика МП до СПП = (логистика МП × кол-во) / сумма продаж × 100%.',
  marketplace_percent_total: 'Процент МП общий = (комиссия + логистика + хранение + эквайринг) / сумма продаж × 100%.',
  tax_rub_2: 'Налог × кол-во.',
  sales_sum_per_rc: 'Сумма продаж = цена до скидки WB × кол-во к закупу.',
  to_settlement_account_2: 'ИТОГО к оплате на р/с (партия).',
  revenue_after_tax_2: 'Выручка после налога (партия).',
  marginal_profit: 'Маржинальная прибыль = выручка после налога − все операционные расходы партии (без маркетинга).',

  // Marketing
  marketing_internal: 'Маркетинг внутренний — реклама внутри WB. Если ДРР в заказах заполнен, считается автоматически как ДРР × выручка в заказах.',
  marketing_external: 'Маркетинг внешний — реклама вне WB (соцсети, блогеры). Сумма на партию.',
  content_cost: 'Затраты на контент — съёмки, инфографика, видео. Сумма на партию.',
  other_costs: 'Прочие затраты (штрафы, возвраты, прочее). Сумма на партию.',
  drr_percent: 'ДРР в заказах — ручной целевой процент рекламы WB от выручки в заказах. Если пусто, считается от внутреннего маркетинга.',
  drr_percent_buyouts: 'ДРР в выкупах = маркетинг внутренний / выручка партии (от факт. выкупа) × 100%. Считается автоматически.',
  cpo_plan: 'CPO план — стоимость 1 заказа = маркетинг внутренний / запланированных заказов.',
  cps_plan: 'CPS план — стоимость 1 продажи = маркетинг внутренний / кол-во к закупу.',
  gross_profit_per_unit: 'Валовая прибыль на 1 ед = валовая прибыль партии / кол-во к закупу.',
  revenue_in_orders: 'Выручка в заказах = цена × запланированных заказов (с учётом выкупа).',
  turnover: 'Оборот = выручка партии (продажи).',
  gross_profit: 'Валовая прибыль = маржинальная прибыль − (маркетинг + контент + прочие).',
  purchase_price: 'Полная стоимость партии = полная себес × кол-во к закупу.',
  invested_rub_profit_percent: 'Прибыль с вложенного рубля = (валовая прибыль / полная стоимость партии) × 100%.',
};

export const COLUMN_FORMULA_HINTS: Record<string, string> = {
  full_cost: 'cost_price_1 + delivery_to_ff_1 + packaging_1 + fulfillment_1 + delivery_to_mp_1',
  price: 'sellerPriceBeforeDiscount (ручной ввод по активному сценарию)',
  marketplace_fee_percent_1: 'FBW/FBS: категория WB (paidStorageKgvp / kgvpMarketplace)',
  marketplace_fee_percent_2: 'marketplace_fee_rub * purchase_qty_total',
  wb_price_before_discount: 'price * (1 - seller_discount/100)',
  price_after_wb: 'wb_price_before_discount * (1 - wb_discount/100)',
  buyout: 'ручной fallback, если авто-выкуп недоступен',
  buyout_auto: 'WB funnel buyoutPercent; авто только при history≥30д, closed≥10, open<=40%',
  marketplace_fee_rub: 'wb_price_before_discount * (marketplace_fee_percent_1/100)',
  marketplace_logistics_total: 'FBW: логистика до клиента с ИЛ + (логистика от клиента × (1 - выкуп)) + цена до скидки WB × ИРП; FBS: без ИРП',
  marketplace_storage_total_1: 'marketplace_storage_avg * turnover_days',
  acquiring_3: 'wb_price_before_discount * 0.03',
  marketplace_plus_storage_total: 'marketplace_fee_rub + marketplace_logistics_total + marketplace_storage_total_1 + acquiring_3',
  to_settlement_account_1: 'wb_price_before_discount - marketplace_plus_storage_total',
  tax_rub_1: 'price_after_wb * tax_percent_1/100',
  revenue_after_tax_1: 'to_settlement_account_1 - tax_rub_1',
  profit_rub: 'revenue_after_tax_1 - full_cost',
  markup_from_price_to_spp: 'wb_price_before_discount / full_cost',
  margin: '(profit_rub / wb_price_before_discount) * 100',
  profitability: '(profit_rub / full_cost) * 100',
  marketplace_logistics_to_spp: '(marketplace_logistics_2 / sales_sum_per_rc) * 100',
  sales_sum_per_rc: 'wb_price_before_discount * purchase_qty_total',
  to_settlement_account_2: 'sales_sum_per_rc - marketplace_plus_storage_batch',
  tax_rub_2: '(price_after_wb * purchase_qty_total) * tax_percent_2/100',
  revenue_after_tax_2: 'to_settlement_account_2 - tax_batch',
  marginal_profit: 'revenue_after_tax_2 - batch_expenses_before_marketing',
  gross_profit: 'marginal_profit - (marketing_internal + marketing_external + content_cost + other_costs)',
  gross_profit_per_unit: 'gross_profit / purchase_qty_total',
  revenue_in_orders: 'wb_price_before_discount * planned_orders, где planned_orders = purchase_qty_total / (buyout / 100)',
  drr_percent: 'manual_drr_percent OR marketing_internal / revenue_in_orders * 100',
  drr_percent_buyouts: 'marketing_internal / batch_revenue * 100',
  cpo_plan: 'marketing_internal / planned_orders',
  cps_plan: 'marketing_internal / purchase_qty_total',
  invested_rub_profit_percent: '(gross_profit / purchase_price) * 100',
};

export function resolveStrictWidthClasses(minWidthClass?: string): string {
  if (!minWidthClass) return '';
  if (minWidthClass.includes('min-w-[')) {
    return `${minWidthClass} ${minWidthClass.replaceAll('min-w-[', 'w-[')}`;
  }
  return minWidthClass;
}

export function normalizeColumnLabel(label: string): string {
  return label.replace(/\n/g, ' ').trim();
}
