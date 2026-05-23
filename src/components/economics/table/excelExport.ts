/**
 * Excel export + import for the Unit Economics table.
 *
 * Export produces a workbook with three sheets:
 *   1. "Данные"            – all columns, pre-computed values, beautiful formatting.
 *   2. "Данные для ввода"  – scenario/order inputs only; costs are edited in /costs.
 *   3. "Справочник формул" – formula reference so the user can verify calculations.
 *
 * Import reads the "Данные для ввода" sheet and returns a
 * `Record<nmId, Partial<ManualFields>>` that the caller merges into state.
 */

import { clampPercent, formatText, hasManualValue, toNumber } from '../helpers';
import type { ManualFields, PriceScenarioId, RowSummary, UnitTemplateRow } from '../types';
import { COLUMNS, normalizeColumnLabel } from './columns';
import { createEconomicsExportFileName, resolveWbVolumeLiters } from './utils';

// ─── column letter converter ────────────────────────────────────────────────

function colIdxToLetter(n: number): string {
  let result = '';
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}

// ─── column metadata ─────────────────────────────────────────────────────────

const SKIP_COLS = new Set(['separator']);

// User-editable input columns (highlighted yellow in Sheet 1).
// Cost-source columns are intentionally read-only here: edit them in /costs.
const INPUT_COLS = new Set([
  'price', 'seller_discount', 'wb_discount', 'buyout',
  'purchase_qty_total', 'turnover_days', 'tax_percent_1',
  'drr_percent', 'marketing_internal', 'marketing_external', 'content_cost', 'other_costs',
]);

// Excel number-format codes by column
const NUM_FMT: Record<string, string> = {
  cost_price_1: '#,##0.00', delivery_to_ff_1: '#,##0.00',
  packaging_1: '#,##0.00', fulfillment_1: '#,##0.00', delivery_to_mp_1: '#,##0.00',
  full_cost: '#,##0.00', warehouse_logistics: '#,##0.00', warehouse_storage: '#,##0.00',
  price: '#,##0.00', wb_price_before_discount: '#,##0.00', price_after_wb: '#,##0.00',
  marketplace_fee_rub: '#,##0.00', marketplace_logistics_avg: '#,##0.00',
  marketplace_logistics_total: '#,##0.00', marketplace_storage_avg: '#,##0.00',
  marketplace_storage_total_1: '#,##0.00', acquiring_3: '#,##0.00',
  marketplace_plus_storage_total: '#,##0.00', to_settlement_account_1: '#,##0.00',
  tax_rub_1: '#,##0.00', revenue_after_tax_1: '#,##0.00', profit_rub: '#,##0.00',
  cost_price_2: '#,##0.00', delivery_to_ff_2: '#,##0.00', packaging_2: '#,##0.00',
  fulfillment_2: '#,##0.00', delivery_to_mp_2: '#,##0.00',
  marketplace_fee_percent_2: '#,##0.00', marketplace_storage_total_2: '#,##0.00',
  marketplace_logistics_2: '#,##0.00', acquiring: '#,##0.00', tax_rub_2: '#,##0.00',
  sales_sum_per_rc: '#,##0.00', to_settlement_account_2: '#,##0.00',
  revenue_after_tax_2: '#,##0.00', marginal_profit: '#,##0.00',
  marketing_internal: '#,##0.00', marketing_external: '#,##0.00',
  content_cost: '#,##0.00', other_costs: '#,##0.00',
  cpo_plan: '#,##0.00', cps_plan: '#,##0.00',
  gross_profit_per_unit: '#,##0.00', revenue_in_orders: '#,##0.00',
  turnover: '#,##0.00', gross_profit: '#,##0.00', purchase_price: '#,##0.00',
  // Percent (stored as 0-100, formatted as decimal)
  seller_discount: '0.00', wb_discount: '0.00', buyout: '0.00', buyout_auto: '0.00',
  marketplace_fee_percent_1: '0.00', marketplace_logistics_to_spp: '0.00',
  marketplace_percent_total: '0.00', tax_percent_1: '0.00', drr_percent: '0.00', drr_percent_buyouts: '0.00',
  margin: '0.00', profitability: '0.00', invested_rub_profit_percent: '0.00',
  // Ratio
  markup_from_price_to_spp: '0.000',
  // Integer
  purchase_qty_total: '#,##0', turnover_days: '#,##0',
};

// ─── group definitions ─────────────────────────────────────────────────────

type ColGroup = { label: string; color: string; cols: Set<string> };

const COL_GROUPS: ColGroup[] = [
  { label: 'Идентификация', color: '1e3a5f', cols: new Set(['photo', 'article', 'seller_article', 'category']) },
  { label: 'Габариты', color: '374151', cols: new Set(['volume', 'wb_volume', 'length', 'width', 'height']) },
  {
    label: 'Себестоимость', color: '14532d',
    cols: new Set(['cost_price_1', 'delivery_to_ff_1', 'packaging_1', 'fulfillment_1',
      'delivery_to_mp_1', 'full_cost', 'warehouse_logistics', 'warehouse_storage']),
  },
  {
    label: 'Ценообразование', color: '92400e',
    cols: new Set(['price', 'seller_discount', 'wb_price_before_discount', 'wb_discount', 'price_after_wb', 'buyout', 'buyout_auto']),
  },
  {
    label: 'Маркетплейс (за ед.)', color: '4c1d95',
    cols: new Set([
      'marketplace_fee_percent_1', 'marketplace_logistics_avg', 'marketplace_storage_avg',
      'marketplace_logistics_total', 'turnover_days', 'marketplace_storage_total_1',
      'acquiring_3', 'marketplace_fee_rub', 'marketplace_plus_storage_total',
    ]),
  },
  {
    label: 'P&L на единицу', color: '0f4c75',
    cols: new Set(['to_settlement_account_1', 'tax_percent_1', 'tax_rub_1',
      'revenue_after_tax_1', 'profit_rub', 'markup_from_price_to_spp', 'margin', 'profitability']),
  },
  {
    label: 'Партия (итого)', color: '1e3a5f',
    cols: new Set([
      'purchase_qty_total',
      'cost_price_2', 'delivery_to_ff_2', 'packaging_2', 'fulfillment_2', 'delivery_to_mp_2',
      'marketplace_fee_percent_2', 'marketplace_storage_total_2', 'marketplace_logistics_2',
      'acquiring', 'marketplace_logistics_to_spp', 'marketplace_percent_total',
      'tax_rub_2', 'sales_sum_per_rc', 'to_settlement_account_2', 'revenue_after_tax_2', 'marginal_profit',
    ]),
  },
  {
    label: 'Маркетинг', color: '7f1d1d',
    cols: new Set(['marketing_internal', 'marketing_external', 'content_cost', 'other_costs',
      'drr_percent', 'drr_percent_buyouts', 'cpo_plan', 'cps_plan']),
  },
  {
    label: 'Итоги партии', color: '14532d',
    cols: new Set(['gross_profit_per_unit', 'revenue_in_orders', 'turnover',
      'gross_profit', 'purchase_price', 'invested_rub_profit_percent']),
  },
];

function getColGroup(colId: string): ColGroup | undefined {
  return COL_GROUPS.find((g) => g.cols.has(colId));
}

// ─── Excel formula builder ─────────────────────────────────────────────────

type ColRefFn = (id: string) => string;

function makeColRefFn(colMap: Map<string, number>, rowNum: number): ColRefFn {
  return (id: string) => {
    const idx = colMap.get(id);
    if (!idx) return `#REF(${id})`;
    return `${colIdxToLetter(idx)}${rowNum}`;
  };
}

function buildExcelFormula(colId: string, c: ColRefFn): string | null {
  switch (colId) {
    case 'full_cost':
      return `=${c('cost_price_1')}+${c('delivery_to_ff_1')}+${c('packaging_1')}+${c('fulfillment_1')}+${c('delivery_to_mp_1')}`;
    case 'wb_price_before_discount':
      return `=${c('price')}*(1-${c('seller_discount')}/100)`;
    case 'price_after_wb':
      return `=${c('wb_price_before_discount')}*(1-${c('wb_discount')}/100)`;
    case 'marketplace_fee_rub':
      return `=${c('wb_price_before_discount')}*${c('marketplace_fee_percent_1')}/100`;
    case 'marketplace_storage_total_1':
      return `=${c('marketplace_storage_avg')}*${c('turnover_days')}`;
    case 'acquiring_3':
      return `=${c('price')}*0.03`;
    case 'marketplace_plus_storage_total':
      return `=${c('marketplace_fee_rub')}+${c('marketplace_logistics_total')}+${c('marketplace_storage_total_1')}+${c('acquiring_3')}`;
    case 'to_settlement_account_1':
      return `=${c('wb_price_before_discount')}-${c('marketplace_plus_storage_total')}`;
    case 'tax_rub_1':
      return `=${c('price_after_wb')}*${c('tax_percent_1')}/100`;
    case 'revenue_after_tax_1':
      return `=${c('to_settlement_account_1')}-${c('tax_rub_1')}`;
    case 'profit_rub':
      return `=${c('revenue_after_tax_1')}-${c('full_cost')}`;
    case 'markup_from_price_to_spp':
      return `=IF(${c('full_cost')}>0,${c('wb_price_before_discount')}/${c('full_cost')},0)`;
    case 'margin':
      return `=IF(${c('wb_price_before_discount')}>0,${c('profit_rub')}/${c('wb_price_before_discount')}*100,0)`;
    case 'profitability':
      return `=IF(${c('full_cost')}>0,${c('profit_rub')}/${c('full_cost')}*100,0)`;
    case 'cost_price_2':
      return `=${c('cost_price_1')}*${c('purchase_qty_total')}`;
    case 'delivery_to_ff_2':
      return `=${c('delivery_to_ff_1')}*${c('purchase_qty_total')}`;
    case 'packaging_2':
      return `=${c('packaging_1')}*${c('purchase_qty_total')}`;
    case 'fulfillment_2':
      return `=${c('fulfillment_1')}*${c('purchase_qty_total')}`;
    case 'delivery_to_mp_2':
      return `=${c('delivery_to_mp_1')}*${c('purchase_qty_total')}`;
    case 'marketplace_fee_percent_2':
      return `=${c('marketplace_fee_rub')}*${c('purchase_qty_total')}`;
    case 'marketplace_storage_total_2':
      return `=${c('marketplace_storage_total_1')}*${c('purchase_qty_total')}`;
    case 'marketplace_logistics_2':
      return `=${c('marketplace_logistics_total')}*${c('purchase_qty_total')}`;
    case 'acquiring':
      return `=${c('price')}*${c('purchase_qty_total')}*0.03`;
    case 'marketplace_logistics_to_spp':
      return `=IF(${c('sales_sum_per_rc')}>0,${c('marketplace_logistics_2')}/${c('sales_sum_per_rc')}*100,0)`;
    case 'marketplace_percent_total':
      return `=IF(${c('sales_sum_per_rc')}>0,(${c('marketplace_fee_percent_2')}+${c('marketplace_logistics_2')}+${c('marketplace_storage_total_2')}+${c('acquiring')})/${c('sales_sum_per_rc')}*100,0)`;
    case 'sales_sum_per_rc':
      return `=${c('wb_price_before_discount')}*${c('purchase_qty_total')}`;
    case 'to_settlement_account_2':
      return `=${c('sales_sum_per_rc')}-(${c('marketplace_fee_percent_2')}+${c('marketplace_logistics_2')}+${c('marketplace_storage_total_2')}+${c('acquiring')})`;
    case 'tax_rub_2':
      return `=${c('price_after_wb')}*${c('purchase_qty_total')}*${c('tax_percent_1')}/100`;
    case 'revenue_after_tax_2':
      return `=${c('to_settlement_account_2')}-${c('tax_rub_2')}`;
    case 'marginal_profit':
      return `=${c('revenue_after_tax_2')}-(${c('cost_price_2')}+${c('delivery_to_ff_2')}+${c('packaging_2')}+${c('fulfillment_2')}+${c('delivery_to_mp_2')})`;
    case 'gross_profit':
      return `=${c('marginal_profit')}-(${c('marketing_internal')}+${c('marketing_external')}+${c('content_cost')}+${c('other_costs')})`;
    case 'gross_profit_per_unit':
      return `=IF(${c('purchase_qty_total')}>0,${c('gross_profit')}/${c('purchase_qty_total')},0)`;
    case 'purchase_price':
      return `=${c('full_cost')}*${c('purchase_qty_total')}`;
    case 'invested_rub_profit_percent':
      return `=IF(${c('purchase_price')}>0,${c('gross_profit')}/${c('purchase_price')}*100,0)`;
    default:
      return null;
  }
}

// Russian formula hints for the formula reference sheet
const RU_FORMULA_HINTS: Record<string, string> = {
  full_cost: 'Товар закупка + Доставка до ФФ + Упаковка + Фулфилмент + Доставка до ВБ',
  wb_price_before_discount: 'Цена продавца до скидки × (1 − Скидка продавца / 100)',
  price_after_wb: 'Цена до скидок WB × (1 − Скидка WB / 100)',
  marketplace_fee_rub: 'Цена до скидок WB × Комиссия МП % / 100',
  marketplace_logistics_total: '(Логистика до клиента с ИЛ и ИРП + Обратная логистика × (1 − Выкуп/100)) / (Выкуп/100)',
  marketplace_storage_total_1: 'Хранение за ед среднее / день × Оборачиваемость в днях',
  acquiring_3: 'Цена продавца до скидки × 3%',
  marketplace_plus_storage_total: 'Комиссия МП + Итоговая логистика с % выкупа + Хранение МП + Эквайринг',
  to_settlement_account_1: 'Цена до скидок WB − (Комиссия + Логистика + Хранение + Эквайринг)',
  tax_rub_1: 'Цена WB (после скидки WB) × Налог %',
  revenue_after_tax_1: 'К оплате на р/с − Налог в рублях',
  profit_rub: 'Выручка после налога − Себестоимость полная с отгрузкой',
  markup_from_price_to_spp: 'Цена до скидок WB ÷ Себестоимость полная',
  margin: 'Прибыль / Цена до скидок WB × 100%',
  profitability: 'Прибыль / Себестоимость полная × 100%',
  cost_price_2: 'Товар закупка × Кол-во к закупу',
  delivery_to_ff_2: 'Доставка до ФФ × Кол-во к закупу',
  packaging_2: 'Упаковка × Кол-во к закупу',
  fulfillment_2: 'Фулфилмент × Кол-во к закупу',
  delivery_to_mp_2: 'Доставка до ВБ × Кол-во к закупу',
  marketplace_fee_percent_2: 'Комиссия МП в руб. × Кол-во к закупу',
  marketplace_storage_total_2: 'Хранение МП × Кол-во к закупу',
  marketplace_logistics_2: 'Логистика МП итог × Кол-во к закупу',
  acquiring: 'Цена продавца × Кол-во к закупу × 3%',
  marketplace_logistics_to_spp: 'Логистика МП (партия) / Сумма продаж по РЦ × 100%',
  marketplace_percent_total: '(Комиссия+Логистика+Хранение+Эквайринг партия) / Сумма продаж по РЦ × 100%',
  sales_sum_per_rc: 'Цена до скидок WB × Кол-во к закупу',
  to_settlement_account_2: 'Сумма продаж / РЦ − (Комиссия+Логистика+Хранение+Эквайринг партия)',
  tax_rub_2: 'Цена WB × Кол-во к закупу × Налог %',
  revenue_after_tax_2: 'К оплате на р/с (партия) − Налог (партия)',
  marginal_profit: 'Выручка после налога (партия) − (Товар закупка+Дост.ФФ+Упак.+Фулф.+Дост.ВБ) × Кол-во',
  gross_profit: 'Маржинальная прибыль − (Маркетинг внутр.+Маркетинг внешн.+Контент+Другие затраты)',
  gross_profit_per_unit: 'Валовая прибыль / Кол-во к закупу',
  purchase_price: 'Себестоимость полная × Кол-во к закупу',
  invested_rub_profit_percent: 'Валовая прибыль / Полная стоимость партии × 100%',
  revenue_in_orders: 'Цена до скидок WB × Плановые заказы (= Кол-во к закупу ÷ (Выкуп / 100))',
  turnover: 'Цена до скидок WB × Кол-во к закупу (= Сумма продаж по РЦ)',
  drr_percent: 'Ручной ДРР в заказах или Маркетинг внутр. / Выручка в заказах × 100%',
  drr_percent_buyouts: 'Маркетинг внутр. / Выручка партии (от факт. выкупа) × 100%',
  cpo_plan: 'Маркетинг внутр. / Плановые заказы',
  cps_plan: 'Маркетинг внутр. / Кол-во к закупу',
  marketplace_logistics_avg: 'Логистика до клиента с ИЛ и ИРП: forward по выбранным складам с коэф. склада и общим кабинетным ИЛ + цена до скидки WB × общий кабинетный ИРП%. ИРП применяется только при ИЛ > 1; при ИЛ ≤ 1 действует только ИЛ без ИРП.',
  marketplace_storage_avg: 'Хранение за ед среднее / день: средняя дневная ставка хранения WB по выбранным складам',
  warehouse_logistics: 'Логистика WB по выбранным складам (из тарифов)',
  warehouse_storage: 'Хранение WB по выбранным складам (из тарифов)',
  delivery_to_mp_1: 'Средняя стоимость доставки до ВБ (вводится по каждому складу вручную)',
  marketplace_fee_percent_1: 'Комиссия WB по категории товара (FBW = kgvpMarketplace, FBS = paidStorageKgvp)',
  photo: 'URL фотографии товара',
  article: 'Артикул WB (nmId)',
  seller_article: 'Артикул продавца (vendorCode)',
  category: 'Категория WB',
  volume: 'Литраж по данным карточки товара (Д × Ш × В)',
  wb_volume: 'Фактический литраж по данным WB',
  length: 'Длина упаковки (из карточки)',
  width: 'Ширина упаковки',
  height: 'Высота упаковки',
  price: 'Вручную: Цена продавца до скидки (активный сценарий)',
  seller_discount: 'Вручную: Скидка продавца в % (активный сценарий)',
  wb_discount: 'Вручную: Скидка WB в % (активный сценарий)',
  buyout: 'Вручную: % выкупа. Используется только если авто-выкуп недоступен',
  buyout_auto: 'Авто: % выкупа из WB-воронки. Включается при истории SKU >=30 дней, закрытых заказах >=100 и доле незакрытых <=40%',
  cost_price_1: 'Из раздела «Себестоимость»: товар закупка за единицу',
  delivery_to_ff_1: 'Из раздела «Себестоимость»: доставка до фулфилмент-центра за единицу',
  packaging_1: 'Из раздела «Себестоимость»: стоимость упаковки за единицу',
  fulfillment_1: 'Из раздела «Себестоимость»: стоимость фулфилмента за единицу',
  purchase_qty_total: 'Вручную: Кол-во товара к закупу (партия)',
  turnover_days: 'Вручную: Оборачиваемость в днях',
  tax_percent_1: 'Вручную: Ставка налога в %',
  marketing_internal: 'Внутренняя реклама WB, ₽. Если заполнен ДРР — считается автоматически.',
  marketing_external: 'Вручную: Внешняя реклама',
  content_cost: 'Вручную: Контент (фото, видео)',
  other_costs: 'Вручную: Прочие расходы',
};

// ─── import column definitions ─────────────────────────────────────────────

type ImportColDef = {
  id: string;
  label: string;
  scenarioId?: PriceScenarioId;
  scenarioField?: keyof ManualFields['priceScenarios']['excellent'];
};

const IMPORT_COL_DEFS: ImportColDef[] = [
  { id: 'article', label: 'Артикул WB' },
  { id: 'seller_article', label: 'Артикул продавца' },
  { id: 'trade_scheme', label: 'Схема (fbw / fbs)' },
  { id: 'irp_percent', label: 'ИРП %' },
  { id: 'purchase_qty_total', label: 'Кол-во к закупу, шт' },
  { id: 'turnover_days', label: 'Оборачиваемость, дней' },
  { id: 'tax_percent', label: 'Налог %' },
  { id: 'drr_percent', label: 'ДРР в заказах, %' },
  { id: 'marketing_internal', label: 'Маркетинг внутр., ₽' },
  { id: 'marketing_external', label: 'Маркетинг внешн., ₽' },
  { id: 'content_cost', label: 'Контент, ₽' },
  { id: 'other_costs', label: 'Другие затраты, ₽' },
  { id: 'price_excellent', label: 'Цена «Отличная», ₽', scenarioId: 'excellent', scenarioField: 'sellerPriceBeforeDiscount' },
  { id: 'discount_excellent', label: 'Скидка прод. «Отл.», %', scenarioId: 'excellent', scenarioField: 'sellerDiscount' },
  { id: 'wb_discount_excellent', label: 'Скидка WB «Отл.», %', scenarioId: 'excellent', scenarioField: 'wbDiscount' },
  { id: 'buyout_excellent', label: 'Выкуп «Отл.», %', scenarioId: 'excellent', scenarioField: 'buyoutPercent' },
  { id: 'price_good', label: 'Цена «Хорошая», ₽', scenarioId: 'good', scenarioField: 'sellerPriceBeforeDiscount' },
  { id: 'discount_good', label: 'Скидка прод. «Хор.», %', scenarioId: 'good', scenarioField: 'sellerDiscount' },
  { id: 'wb_discount_good', label: 'Скидка WB «Хор.», %', scenarioId: 'good', scenarioField: 'wbDiscount' },
  { id: 'buyout_good', label: 'Выкуп «Хор.», %', scenarioId: 'good', scenarioField: 'buyoutPercent' },
  { id: 'price_average', label: 'Цена «Средняя», ₽', scenarioId: 'average', scenarioField: 'sellerPriceBeforeDiscount' },
  { id: 'discount_average', label: 'Скидка прод. «Ср.», %', scenarioId: 'average', scenarioField: 'sellerDiscount' },
  { id: 'wb_discount_average', label: 'Скидка WB «Ср.», %', scenarioId: 'average', scenarioField: 'wbDiscount' },
  { id: 'buyout_average', label: 'Выкуп «Ср.», %', scenarioId: 'average', scenarioField: 'buyoutPercent' },
  { id: 'price_poor', label: 'Цена «Плохая», ₽', scenarioId: 'poor', scenarioField: 'sellerPriceBeforeDiscount' },
  { id: 'discount_poor', label: 'Скидка прод. «Пл.», %', scenarioId: 'poor', scenarioField: 'sellerDiscount' },
  { id: 'wb_discount_poor', label: 'Скидка WB «Пл.», %', scenarioId: 'poor', scenarioField: 'wbDiscount' },
  { id: 'buyout_poor', label: 'Выкуп «Пл.», %', scenarioId: 'poor', scenarioField: 'buyoutPercent' },
];

function getImportCellValue(
  def: ImportColDef,
  row: UnitTemplateRow,
  manualFields: ManualFields,
): string | number {
  if (def.scenarioId && def.scenarioField) {
    const val = manualFields.priceScenarios[def.scenarioId]?.[def.scenarioField] ?? '';
    const num = toNumber(val);
    return num > 0 ? num : '';
  }
  switch (def.id) {
    case 'article': return toNumber(row.nmId) || '';
    case 'seller_article': {
      const v = formatText(row.vendorCode);
      return v === '—' ? '' : (row.vendorCode ?? '');
    }
    case 'trade_scheme':       return manualFields.tradeScheme;
    case 'irp_percent':        return toNumber(manualFields.irpPercent) || '';
    case 'purchase_qty_total': return toNumber(manualFields.purchaseQtyTotal) || '';
    case 'turnover_days':      return toNumber(manualFields.turnoverDays) || '';
    case 'tax_percent':        return toNumber(manualFields.taxPercent) || '';
    case 'drr_percent':        return toNumber(manualFields.drrPercent) || '';
    case 'marketing_internal': return toNumber(manualFields.marketingInternal) || '';
    case 'marketing_external': return toNumber(manualFields.marketingExternal) || '';
    case 'content_cost':       return toNumber(manualFields.contentCost) || '';
    case 'other_costs':        return toNumber(manualFields.otherCosts) || '';
    default: return '';
  }
}

// ─── main data export cell value ────────────────────────────────────────────

export function getExportCellValue(
  columnId: string,
  row: UnitTemplateRow,
  summary: RowSummary,
  manualFields: ManualFields,
): string | number {
  const explicitVolume = formatText(row.volume);
  switch (columnId) {
    case 'photo':         return row.photoUrl ?? '';
    case 'article':       return toNumber(row.nmId) || '';
    case 'seller_article': {
      const v = formatText(row.vendorCode);
      return v === '—' ? '' : v;
    }
    case 'category': {
      const v = formatText(row.category);
      return v === '—' ? '' : v;
    }
    case 'volume':
      return explicitVolume !== '—'
        ? explicitVolume
        : (summary.volumeLiters > 0 ? `${summary.volumeLiters.toFixed(2)} л` : '');
    case 'wb_volume': {
      const wb = resolveWbVolumeLiters(row);
      return wb > 0 ? `${wb.toFixed(2)} л` : '';
    }
    case 'length': { const v = formatText(row.length); return v === '—' ? '' : v; }
    case 'width':  { const v = formatText(row.width);  return v === '—' ? '' : v; }
    case 'height': { const v = formatText(row.height); return v === '—' ? '' : v; }

	    case 'cost_price_1':
	      return toNumber(manualFields.costPrice) > 0
	        ? toNumber(manualFields.costPrice)
	        : toNumber(row.purchasePrice ?? row.costPrice);
    case 'cost_price_2':           return summary.batchCostPriceTotal;
    case 'delivery_to_ff_1':       return toNumber(manualFields.deliveryToFf);
    case 'delivery_to_ff_2':       return summary.batchDeliveryToFfTotal;
    case 'packaging_1':            return toNumber(manualFields.packagingMaterial);
    case 'packaging_2':            return summary.batchPackagingTotal;
    case 'fulfillment_1':          return toNumber(manualFields.fulfillment);
    case 'fulfillment_2':          return summary.batchFulfillmentTotal;
    case 'delivery_to_mp_1':       return summary.deliveryToMarketplaceComputed;
    case 'delivery_to_mp_2':       return summary.batchDeliveryToMarketplaceTotal;
    case 'full_cost':              return summary.fullCost;
    case 'purchase_price':         return summary.batchCostTotal;
    case 'warehouse_logistics':    return summary.avgWbLogisticsPerUnit;
    case 'warehouse_storage':      return summary.avgWbStoragePerUnit;
    case 'separator':              return '';

    case 'price':                        return summary.sellerPriceBeforeDiscount;
    case 'wb_price_before_discount':     return summary.priceBeforeWbDiscount;
    case 'price_after_wb':               return summary.priceAfterWb;
    case 'seller_discount':              return summary.sellerDiscountPercent;
    case 'wb_discount':                  return summary.wbDiscountPercent;
    case 'buyout': {
      const activeScenario = manualFields.priceScenarios[manualFields.activePriceScenarioId];
      return hasManualValue(activeScenario?.buyoutPercent)
        ? clampPercent(toNumber(activeScenario?.buyoutPercent))
        : '';
    }
    case 'buyout_auto':                  return summary.buyoutSource === 'auto' && summary.buyoutAutoPercent > 0 ? summary.buyoutAutoPercent : '';

    case 'marketplace_fee_percent_1':    return summary.commissionPercent;
    case 'marketplace_fee_percent_2':    return summary.batchCommissionTotal;
    case 'marketplace_percent_total':    return summary.batchMarketplacePercentTotal;
    case 'marketplace_fee_rub':          return summary.commission;
    case 'marketplace_logistics_avg':    return summary.logisticsToClientWithIrp;
    case 'marketplace_logistics_to_spp': return summary.batchLogisticsToSppPercent;
    case 'marketplace_logistics_2':      return summary.batchLogisticsTotal;
    case 'marketplace_logistics_total':  return summary.logisticsTotalComputed;
    case 'marketplace_storage_avg':      return summary.storagePerUnit;
    case 'marketplace_storage_total_1':  return summary.storageTotalComputed;
    case 'marketplace_storage_total_2':  return summary.batchStorageTotal;
    case 'acquiring_3':                  return summary.acquiring;
    case 'acquiring':                    return summary.batchAcquiringTotal;
    case 'marketplace_plus_storage_total': return summary.marketplacePlusStorageTotal;

    case 'to_settlement_account_1':      return summary.toSettlementAccount;
    case 'sales_sum_per_rc':             return summary.batchRevenue;
    case 'revenue_in_orders':            return summary.batchRevenueInOrders;
    case 'turnover':                     return summary.batchRevenue;
    case 'to_settlement_account_2':      return summary.batchToSettlementAccount;
    case 'tax_percent_1':
    case 'tax_percent_2':                return summary.taxPercent;
    case 'tax_rub_1':                    return summary.taxRub;
    case 'tax_rub_2':                    return summary.batchTaxRub;
    case 'revenue_after_tax_1':          return summary.revenueAfterTax;
    case 'revenue_after_tax_2':          return summary.batchRevenueAfterTax;
    case 'profit_rub':                   return summary.netProfit;
    case 'marginal_profit':              return summary.batchMarginalProfit;
    case 'gross_profit':                 return summary.batchGrossProfit;

    case 'marketing_internal':           return summary.marketingInternal;
    case 'marketing_external':           return summary.marketingExternal;
    case 'content_cost':                 return summary.contentCost;
    case 'other_costs':                  return summary.otherCosts;
    case 'drr_percent':                  return summary.drrPercent;
    case 'drr_percent_buyouts':          return summary.drrPercentBuyouts;
    case 'cpo_plan':                     return summary.cpoPlan;
    case 'cps_plan':                     return summary.cpsPlan;

    case 'markup_from_price_to_spp':     return summary.markupFromPriceToSppRatio;
    case 'margin':                       return summary.marginPercent;
    case 'profitability':                return summary.profitabilityPercent;
    case 'invested_rub_profit_percent':  return summary.batchProfitabilityPercent;
    case 'purchase_qty_total':           return summary.purchaseQtyTotal;
    case 'gross_profit_per_unit':        return summary.batchGrossProfitPerUnit;
    case 'turnover_days':                return summary.turnoverDays;

    default: return '';
  }
}

// ─── export input type ─────────────────────────────────────────────────────

type ExportRowInput = {
  row: UnitTemplateRow;
  summary: RowSummary;
  manualFields: ManualFields;
};

// ─── main export function ──────────────────────────────────────────────────

export async function exportEconomicsExcel(rows: ExportRowInput[]): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MetricPulse';
  workbook.created = new Date();

  const exportCols = COLUMNS.filter((col) => !SKIP_COLS.has(col.id));

  // Column index map (1-based) for formula builder
  const colIdxMap = new Map<string, number>();
  exportCols.forEach((col, i) => colIdxMap.set(col.id, i + 1));

  // ── Sheet 1: Данные ──────────────────────────────────────────────────────

  const dataSheet = workbook.addWorksheet('Данные', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1 },
  });

  // Column widths from COLUMNS definitions
  exportCols.forEach((col, i) => {
    const minPx = parseInt(col.minWidthClass?.match(/\d+/)?.[0] ?? '80', 10);
    dataSheet.getColumn(i + 1).width = Math.max(8, Math.min(32, Math.round(minPx / 6)));
  });

  // Header row (row 1)
  const hdr = dataSheet.getRow(1);
  hdr.height = 42;
  exportCols.forEach((col, i) => {
    const cell = hdr.getCell(i + 1);
    const grp = getColGroup(col.id);
    const bgHex = grp?.color ?? '14532d';
    cell.value = normalizeColumnLabel(col.label);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: col.align === 'right' ? 'right' : 'center',
      wrapText: true,
    };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF888888' } },
      right: { style: 'thin', color: { argb: 'FF555555' } },
    };
  });

  // Data rows
  rows.forEach((item, ri) => {
    const dataRow = dataSheet.getRow(ri + 2);
    dataRow.height = 18;
    const isAlt = ri % 2 === 1;

    exportCols.forEach((col, ci) => {
      const cell = dataRow.getCell(ci + 1);
      const raw = getExportCellValue(col.id, item.row, item.summary, item.manualFields);
      cell.value = (raw === '' || raw === 0 && col.id !== 'article') ? null : raw;

      const isInput = INPUT_COLS.has(col.id);
      let bgArgb: string;
      if (isInput) {
        bgArgb = 'FFFFF9C4'; // yellow
      } else if (col.id === 'article' || col.id === 'seller_article') {
        bgArgb = isAlt ? 'FFE8F4E8' : 'FFF0FAF0';
      } else {
        bgArgb = isAlt ? 'FFF8FAFC' : 'FFFFFFFF';
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };

      const fmt = NUM_FMT[col.id];
      if (fmt && typeof raw === 'number') cell.numFmt = fmt;

      cell.alignment = {
        vertical: 'middle',
        horizontal: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'left',
      };

      if (col.id === 'article' && typeof raw === 'number' && raw > 0) {
        cell.font = { bold: true, color: { argb: 'FF14532d' }, size: 9 };
      }

      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  if (rows.length > 0) {
    dataSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: exportCols.length },
    };
  }

  // ── Sheet 2: Данные для ввода ────────────────────────────────────────────

  const inputSheet = workbook.addWorksheet('Данные для ввода', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  // Row 1: machine-readable column IDs (small gray — for import parser)
  const idRow = inputSheet.getRow(1);
  idRow.height = 13;
  IMPORT_COL_DEFS.forEach((def, i) => {
    const cell = idRow.getCell(i + 1);
    cell.value = def.id;
    cell.font = { size: 7, color: { argb: 'FFAAAAAA' }, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.alignment = { horizontal: 'center' };
  });

  // Row 2: Russian labels (bold, colored)
  const lblRow = inputSheet.getRow(2);
  lblRow.height = 38;
  IMPORT_COL_DEFS.forEach((def, i) => {
    const cell = lblRow.getCell(i + 1);
    cell.value = def.label;
    const isId = def.id === 'article' || def.id === 'seller_article';
    const bgHex = isId ? '1e3a5f' : (def.scenarioId ? '1e40af' : '0f4c75');
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgHex}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF888888' } },
      right: { style: 'thin', color: { argb: 'FF555555' } },
    };
  });

  // Column widths for input sheet
  IMPORT_COL_DEFS.forEach((def, i) => {
    const isId = def.id === 'article' || def.id === 'seller_article';
    inputSheet.getColumn(i + 1).width = isId ? 18 : 20;
  });

  // Data rows starting at row 3
  rows.forEach((item, ri) => {
    const row = inputSheet.getRow(ri + 3);
    row.height = 18;
    const isAlt = ri % 2 === 1;

    IMPORT_COL_DEFS.forEach((def, i) => {
      const cell = row.getCell(i + 1);
      const val = getImportCellValue(def, item.row, item.manualFields);
      cell.value = val === '' ? null : val;

      const isId = def.id === 'article' || def.id === 'seller_article';
      const isScenario = !!def.scenarioId;
      let bgArgb: string;
      if (isId) {
        bgArgb = isAlt ? 'FFE8F4E8' : 'FFF0FAF0';
      } else if (isScenario) {
        bgArgb = isAlt ? 'FFDBEAFE' : 'FFEFF6FF';
      } else {
        bgArgb = isAlt ? 'FFFEF9C4' : 'FFFFFDE7';
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };

      if (isId && typeof val === 'number') {
        cell.font = { bold: true, size: 9 };
      }

      cell.alignment = {
        vertical: 'middle',
        horizontal: isId ? 'center' : 'right',
      };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  // ── Sheet 3: Справочник формул ───────────────────────────────────────────

  const fmSheet = workbook.addWorksheet('Справочник формул', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  fmSheet.getColumn(1).width = 28;
  fmSheet.getColumn(2).width = 20;
  fmSheet.getColumn(3).width = 14;
  fmSheet.getColumn(4).width = 65;
  fmSheet.getColumn(5).width = 48;

  // Header
  const fmHdrRow = fmSheet.getRow(1);
  fmHdrRow.height = 26;
  const fmHeaders = [
    'Название колонки',
    'Группа',
    'Тип',
    'Формула / Правило (по-русски)',
    'Excel-формула (строка 2 листа «Данные»)',
  ];
  fmHeaders.forEach((h, i) => {
    const cell = fmHdrRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532d' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium' }, right: { style: 'thin', color: { argb: 'FF888888' } } };
  });

  const excelRef = makeColRefFn(colIdxMap, 2);

  exportCols.forEach((col, idx) => {
    const fmRow = fmSheet.getRow(idx + 2);
    fmRow.height = 18;

    const grp = getColGroup(col.id);
    const isInput = INPUT_COLS.has(col.id);
    const excelFmla = buildExcelFormula(col.id, excelRef);

    const bgArgb = isInput ? 'FFFFF9C4' : (idx % 2 === 1 ? 'FFF8FAFC' : 'FFFFFFFF');

    const vals: (string | null)[] = [
      normalizeColumnLabel(col.label),
      grp?.label ?? '',
      isInput ? 'Ручной ввод' : 'Вычисляется',
      RU_FORMULA_HINTS[col.id] ?? '',
      excelFmla,
    ];

    vals.forEach((v, i) => {
      const cell = fmRow.getCell(i + 1);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: i >= 3 };

      if (i === 2) {
        cell.font = {
          bold: true,
          color: { argb: isInput ? 'FF92400e' : 'FF14532d' },
          size: 9,
        };
      } else {
        cell.font = { size: 9, name: 'Calibri' };
      }

      if (i === 4 && excelFmla) {
        cell.font = { size: 9, name: 'Courier New', color: { argb: 'FF1e3a5f' } };
      }

      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  // ── Write & download ─────────────────────────────────────────────────────

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = createEconomicsExportFileName('юнит-экономика');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ─── import function ───────────────────────────────────────────────────────

/**
 * Parse an .xlsx file previously exported from this module and return a map
 * of nmId → Partial<ManualFields> with the values from the "Данные для ввода" sheet.
 *
 * The caller is responsible for merging the returned patch with the existing
 * manualFieldsCache and persisting it.
 */
export async function parseEconomicsExcel(
  file: File,
): Promise<Record<number, Partial<ManualFields>>> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet =
    workbook.getWorksheet('Данные для ввода') ??
    workbook.getWorksheet('✏️ Данные для ввода');

  if (!sheet) {
    throw new Error(
      'Лист "Данные для ввода" не найден. Загрузите файл, экспортированный из юнит-экономики.',
    );
  }

  // Row 1 = column IDs (machine-readable)
  const idRow = sheet.getRow(1);
  const colIdxToId = new Map<number, string>();
  idRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    const v = String(cell.value ?? '').trim();
    if (v) colIdxToId.set(colNum, v);
  });

  const articleColIdx = [...colIdxToId.entries()].find(([, id]) => id === 'article')?.[0];
  if (!articleColIdx) {
    throw new Error('Столбец "article" (Артикул WB) не найден. Проверьте, что файл был создан из юнит-экономики.');
  }

  const result: Record<number, Partial<ManualFields>> = {};

  // Data starts at row 3 (row 2 = Russian labels)
  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 2) return;

    const nmIdRaw = row.getCell(articleColIdx).value;
    const nmId = toNumber(nmIdRaw);
    if (!nmId || nmId <= 0) return;

    const patch: Partial<ManualFields> = {};
    const scenarioPatch: Partial<ManualFields['priceScenarios']> = {};

    for (const [colIdx, colId] of colIdxToId.entries()) {
      if (colId === 'article' || colId === 'seller_article') continue;
      const raw = row.getCell(colIdx).value;
      if (raw == null || raw === '') continue;
      const str = String(raw).trim();
      if (!str) continue;

      // Scenario columns: pattern price_excellent, discount_good, wb_discount_average, buyout_poor
      const scenMatch = colId.match(/^(price|discount|wb_discount|buyout)_(excellent|good|average|poor)$/);
      if (scenMatch) {
        const [, field, scenId] = scenMatch as [string, string, PriceScenarioId];
        if (!scenarioPatch[scenId]) {
          scenarioPatch[scenId] = {
            sellerPriceBeforeDiscount: '',
            sellerDiscount: '',
            wbDiscount: '',
            buyoutPercent: '',
          };
        }
        const scen = scenarioPatch[scenId]!;
        if (field === 'price') scen.sellerPriceBeforeDiscount = str;
        else if (field === 'discount') scen.sellerDiscount = str;
        else if (field === 'wb_discount') scen.wbDiscount = str;
        else if (field === 'buyout') scen.buyoutPercent = str;
        continue;
      }

      switch (colId) {
        case 'trade_scheme':
          if (str === 'fbs' || str === 'fbw') patch.tradeScheme = str;
          break;
        case 'irp_percent':        patch.irpPercent = str; break;
        case 'purchase_qty_total': patch.purchaseQtyTotal = str; break;
        case 'turnover_days':      patch.turnoverDays = str; break;
        case 'tax_percent':        patch.taxPercent = str; break;
        case 'drr_percent':        patch.drrPercent = str; break;
        case 'marketing_internal': patch.marketingInternal = str; break;
        case 'marketing_external': patch.marketingExternal = str; break;
        case 'content_cost':       patch.contentCost = str; break;
        case 'other_costs':        patch.otherCosts = str; break;
      }
    }

    if (Object.keys(scenarioPatch).length > 0) {
      const empty = { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' };
      patch.priceScenarios = {
        excellent: scenarioPatch.excellent ?? empty,
        good: scenarioPatch.good ?? empty,
        average: scenarioPatch.average ?? empty,
        poor: scenarioPatch.poor ?? empty,
      };
    }

    result[nmId] = patch;
  });

  return result;
}
