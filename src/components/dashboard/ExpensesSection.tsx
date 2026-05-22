'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Image from 'next/image';
import { Check, CircleHelp, ExternalLink, GripVertical, Loader2, RotateCcw, SlidersHorizontal, TrendingDown, TrendingUp, X } from 'lucide-react';
import { OPEN_EXPENSE_BREAKDOWN_EVENT } from './expenseBreakdownEvents';

type MetricValue = {
  value?: number | string;
  delta?: number | string;
};

type ExpensesKpi = Record<string, unknown>;

type ExpensesChartPoint = Record<string, unknown>;

type ProfitReportTotals = {
  выручка?: number;
  комиссия_wb?: number;
  логистика?: number;
  хранение_wb_из_weekly?: number;
  штрафы_wb?: number;
  платное_перечисление_wb?: number;
  удержания_wb?: number;
  эквайринг_wb?: number;
  доплаты_wb?: number;
  оценочные_удержания_после_последнего_weekly?: number;
  себестоимость?: number;
  хранение_paid_storage?: number;
  реклама?: number;
  прибыль_до_налога?: number;
  налог?: number;
  чистая_прибыль?: number;
};

type ProfitReportSkuRow = {
  nmId?: number;
  бренд?: string | null;
  артикул_продавца?: string | null;
  фото_url?: string | null;
  выручка?: number;
  комиссия_wb?: number;
  логистика?: number;
  хранение_wb_из_weekly?: number;
  штрафы_wb?: number;
  платное_перечисление_wb?: number;
  удержания_wb?: number;
  эквайринг_wb?: number;
  доплаты_wb?: number;
  оценочные_удержания_после_последнего_weekly?: number;
  себестоимость?: number;
  хранение_paid_storage?: number;
  реклама?: number;
  налог?: number;
  чистая_прибыль?: number;
};

type ProfitReportDeductionDetailRow = {
  дата?: string | null;
  отчет_wb?: number;
  операция?: string | null;
  тип_документа?: string | null;
  причина?: string | null;
  nmId?: number;
  артикул_продавца?: string | null;
  строк?: number;
  первая_строка_rrd?: string | null;
  сумма?: number;
  сумма_в_расходах?: number;
  тип_удержания?: string | null;
  в_расходах_pnl?: string | null;
};

type ProfitReportResponse = {
  итоги?: ProfitReportTotals;
  удержания_wb_расшифровка?: ProfitReportDeductionDetailRow[];
  sku?: ProfitReportSkuRow[];
};

type ExpenseCategory = {
  key: string;
  label: string;
  value: number;
  color: string;
  bg: string;
  note: string;
};

type ExpenseCardKey = 'total' | 'operations' | 'logistics' | 'ads' | 'storage' | 'profit' | 'roi';

type ExpenseCardData = {
  key: ExpenseCardKey;
  label: string;
  value: string;
  delta: number;
  description: string;
  formula: string;
  color: string;
  goodWhenDown?: boolean;
};

type ExpenseDetailKey =
  | 'commission'
  | 'logistics'
  | 'wbStorage'
  | 'penalty'
  | 'paymentSchedule'
  | 'deduction'
  | 'acquiring'
  | 'additionalPayment'
  | 'provisionalTail'
  | 'cogs'
  | 'ads'
  | 'paidStorage'
  | 'tax';

type ExpenseDetailRow = {
  key: ExpenseDetailKey;
  label: string;
  value: number;
  note: string;
  color: string;
};

type ExpenseSourceRow = {
  label: string;
  value: number;
};

type ExpenseExplanation = {
  source: string;
  meaning: string;
  check: string;
};

type DeductionReasonGroup = {
  reason: string;
  amount: number;
  amountExpense: number;
  amountExcluded: number;
  rowCount: number;
  reportCount: number;
  skuCount: number;
  details?: string[];
  creditRows?: CreditDeductionRow[];
};

type CreditDeductionRow = {
  creditId: string;
  creditDate: string;
  principal: number;
  interest: number;
  total: number;
  rowCount: number;
  reportCount: number;
};

type SkuExpenseRow = {
  nmId: number;
  brand: string;
  vendorCode: string;
  photoUrl: string;
  revenue: number;
  expenses: number;
  ads: number;
  cogs: number;
  paidStorage: number;
  commission: number;
  logistics: number;
  wbStorageFee: number;
  penalty: number;
  paymentSchedule: number;
  deduction: number;
  acquiringFee: number;
  additionalPayment: number;
  provisionalOtherFees: number;
  tax: number;
  profit: number;
};

type DeductionDetailRow = {
  date: string;
  reportId: number;
  operation: string;
  docType: string;
  reason: string;
  nmId: number;
  vendorCode: string;
  rowCount: number;
  firstRrdId: string;
  amount: number;
  amountExpense: number;
  kind: string;
  inPnl: boolean;
};

type DragPreviewState = {
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

const EXPENSE_ORDER_STORAGE_KEY = 'enterprise-wb-analytics:overview:expense-order:v1';
const EXPENSE_VISIBILITY_STORAGE_KEY = 'enterprise-wb-analytics:overview:expense-hidden:v1';
const EXPENSE_CARD_KEYS = new Set<ExpenseCardKey>(['total', 'operations', 'logistics', 'ads', 'storage', 'profit', 'roi']);

function isExpenseCardKey(value: unknown): value is ExpenseCardKey {
  return typeof value === 'string' && EXPENSE_CARD_KEYS.has(value as ExpenseCardKey);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function metricValue(metric: unknown) {
  if (!metric || typeof metric !== 'object') {
    return { value: 0, delta: 0 };
  }

  const typedMetric = metric as MetricValue;
  return {
    value: toNumber(typedMetric.value),
    delta: toNumber(typedMetric.delta),
  };
}

function formatRub(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatRubExact(value: number) {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)} %`;
}

function formatDelta(value: number) {
  if (!Number.isFinite(value)) {
    return '0.0%';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatDayLabel(value: unknown) {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function share(value: number, base: number) {
  return base > 0 ? (value / base) * 100 : 0;
}

function calcDelta(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return 0;
  }

  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

function previousFromDelta(current: number, delta: number) {
  if (!Number.isFinite(current) || !Number.isFinite(delta)) {
    return 0;
  }

  const ratio = 1 + delta / 100;
  return Math.abs(ratio) < 0.0001 ? 0 : current / ratio;
}

export function ExpensesSection({
  kpi,
  chart,
  dateFrom,
  dateTo,
  groupId,
}: {
  kpi: ExpensesKpi;
  chart: ExpensesChartPoint[];
  dateFrom: string;
  dateTo: string;
  groupId?: string | null;
}) {
  const [cardOrder, setCardOrder] = useState<ExpenseCardKey[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const savedOrder = window.localStorage.getItem(EXPENSE_ORDER_STORAGE_KEY);
      if (!savedOrder) {
        return [];
      }

      const parsed = JSON.parse(savedOrder);
      return Array.isArray(parsed) ? parsed.filter(isExpenseCardKey) : [];
    } catch {
      return [];
    }
  });
  const [draggedKey, setDraggedKey] = useState<ExpenseCardKey | null>(null);
  const [dragOverKey, setDragOverKey] = useState<ExpenseCardKey | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [hiddenCardKeys, setHiddenCardKeys] = useState<ExpenseCardKey[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const savedHidden = window.localStorage.getItem(EXPENSE_VISIBILITY_STORAGE_KEY);
      if (!savedHidden) {
        return [];
      }

      const parsed = JSON.parse(savedHidden);
      return Array.isArray(parsed) ? parsed.filter(isExpenseCardKey) : [];
    } catch {
      return [];
    }
  });
  const [metricsMenuOpen, setMetricsMenuOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdown, setBreakdown] = useState<ProfitReportResponse | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const metricsMenuRef = useRef<HTMLDivElement>(null);

  const revenue = metricValue(kpi.revenue);
  const realizedRevenue = metricValue(kpi.realizedRevenue);
  const cogs = metricValue(kpi.cogs);
  const profit = metricValue(kpi.profit);
  const ads = metricValue(kpi.ads);
  const acos = metricValue(kpi.acos);
  const logistics = metricValue(kpi.logistics);
  const logisticsShare = metricValue(kpi.logisticsShare);
  const storage = metricValue(kpi.storage);
  const storageShare = metricValue(kpi.storageShare);
  const stocks = metricValue(kpi.stocks);
  const stocksToClient = metricValue(kpi.stocksInWayToClient);
  const stocksFromClient = metricValue(kpi.stocksInWayFromClient);

  // Расходы = реализация после СПП − прибыль (СПП финансирует WB). ROI = прибыль / себестоимость.
  const totalExpenses = Math.max(realizedRevenue.value - profit.value, ads.value + logistics.value + storage.value, 0);
  const operationalExpenses = Math.max(totalExpenses - ads.value - logistics.value - storage.value, 0);
  const expenseBase = Math.max(totalExpenses, 1);
  const revenueBase = Math.max(revenue.value, 1);
  const roi = cogs.value > 0 ? (profit.value / cogs.value) * 100 : 0;
  const previousRevenue = previousFromDelta(revenue.value, revenue.delta);
  const previousProfit = previousFromDelta(profit.value, profit.delta);
  const previousAds = previousFromDelta(ads.value, ads.delta);
  const previousLogistics = previousFromDelta(logistics.value, logistics.delta);
  const previousStorage = previousFromDelta(storage.value, storage.delta);
  const previousTotalExpenses = Math.max(previousRevenue - previousProfit, 0);
  const previousOperationalExpenses = Math.max(previousTotalExpenses - previousAds - previousLogistics - previousStorage, 0);
  const previousRoi = previousTotalExpenses > 0 ? (previousProfit / previousTotalExpenses) * 100 : 0;
  const totalExpensesDelta = calcDelta(totalExpenses, previousTotalExpenses);
  const operationalExpensesDelta = calcDelta(operationalExpenses, previousOperationalExpenses);
  const roiDelta = previousRoi > 0 ? calcDelta(roi, previousRoi) : 0;

  const categories: ExpenseCategory[] = [
    {
      key: 'operations',
      label: 'Прочие WB, себес, налог',
      value: operationalExpenses,
      color: '#f5b700',
      bg: 'bg-amber-500',
      note: 'Остаток расходов: комиссии, себестоимость, налог и WB-удержания без рекламы, логистики и хранения.',
    },
    {
      key: 'logistics',
      label: 'Доставка и перевозка',
      value: logistics.value,
      color: '#22c55e',
      bg: 'bg-green-500',
      note: 'Логистика WB из финального P&L и оперативного хвоста свежих продаж.',
    },
    {
      key: 'ads',
      label: 'Рекламные расходы',
      value: ads.value,
      color: '#3b82f6',
      bg: 'bg-blue-500',
      note: 'Расходы WB Ads из рекламного контура.',
    },
    {
      key: 'storage',
      label: 'Хранение',
      value: storage.value,
      color: '#11365c',
      bg: 'bg-slate-800',
      note: 'Хранение WB из SKU-атрибутированного paid_storage, finance только fallback.',
    },
  ].filter((category) => category.value > 0);

  const dailyRows = (chart ?? []).map((row) => {
    const realizedRevenue = toNumber(row.realized_revenue);
    const netProfit = toNumber(row.net_profit);
    const rowAds = toNumber(row.ads_amount);
    const rowLogistics = toNumber(row.logistics_amount);
    const rowStorage = toNumber(row.storage_amount);
    // Расходы строки = реализация после СПП − прибыль (СПП финансирует WB, в расходы не входит).
    const rowTotal = Math.max(realizedRevenue - netProfit, rowAds + rowLogistics + rowStorage, 0);
    const rowOperations = Math.max(rowTotal - rowAds - rowLogistics - rowStorage, 0);

    return {
      label: formatDayLabel(row.day_date),
      total: rowTotal,
      operations: rowOperations,
      logistics: rowLogistics,
      ads: rowAds,
      storage: rowStorage,
    };
  });
  const maxDailyExpense = Math.max(...dailyRows.map((row) => row.total), 1);

  const stockTotal = Math.max(stocks.value, 0);
  const stockTransit = Math.max(stocksToClient.value + stocksFromClient.value, 0);
  const stockAvailable = Math.max(stockTotal - stockTransit, 0);

  const expenseCards: ExpenseCardData[] = [
    {
      key: 'total',
      label: 'Все расходы',
      value: formatRub(totalExpenses),
      delta: totalExpensesDelta,
      description: `${formatPercent(share(totalExpenses, revenueBase))} от выручки`,
      formula: 'Выручка − чистая прибыль.',
      color: 'bg-slate-500',
      goodWhenDown: true,
    },
    {
      key: 'operations',
      label: 'Прочие WB, себес, налог',
      value: formatRub(operationalExpenses),
      delta: operationalExpensesDelta,
      description: `${formatPercent(share(operationalExpenses, revenueBase))} от выручки`,
      formula: 'Все расходы − реклама − логистика − хранение.',
      color: 'bg-amber-500',
      goodWhenDown: true,
    },
    {
      key: 'logistics',
      label: 'Логистика WB',
      value: formatRub(logistics.value),
      delta: logistics.delta,
      description: `${formatPercent(logisticsShare.value || share(logistics.value, revenueBase))} от выручки`,
      formula: 'Логистика WB из deliveryService, привязанная к дате выкупа/реализации.',
      color: 'bg-green-500',
      goodWhenDown: true,
    },
    {
      key: 'ads',
      label: 'Рекламные расходы',
      value: formatRub(ads.value),
      delta: ads.delta,
      description: `ДРР ${formatPercent(acos.value)}`,
      formula: 'Ad spend / выручка или атрибутированная сумма заказов.',
      color: 'bg-blue-500',
      goodWhenDown: true,
    },
    {
      key: 'storage',
      label: 'Хранение',
      value: formatRub(storage.value),
      delta: storageShare.delta,
      description: `${formatPercent(storageShare.value)} от выручки`,
      formula: 'Сумма хранения WB за период.',
      color: 'bg-slate-800 dark:bg-slate-500',
      goodWhenDown: true,
    },
    {
      key: 'profit',
      label: 'Прибыль',
      value: formatRub(profit.value),
      delta: profit.delta,
      description: `${formatPercent(share(profit.value, revenueBase))} от выручки`,
      formula: 'Итоговая прибыль после расходов и налогового слоя.',
      color: 'bg-blue-500',
    },
    {
      key: 'roi',
      label: 'ROI',
      value: formatPercent(roi),
      delta: roiDelta,
      description: 'прибыль / расходы',
      formula: 'Чистая прибыль / все расходы × 100%.',
      color: 'bg-emerald-600',
    },
  ];
  const expenseCardByKey = new Map(expenseCards.map((card) => [card.key, card]));
  const savedKeys = cardOrder.filter((key) => expenseCardByKey.has(key));
  const missingKeys = expenseCards.map((card) => card.key).filter((key) => !savedKeys.includes(key));
  const orderedExpenseCards = [...savedKeys, ...missingKeys]
    .map((key) => expenseCardByKey.get(key))
    .filter((card): card is ExpenseCardData => Boolean(card));
  const hiddenKeySet = new Set(hiddenCardKeys.filter((key) => expenseCardByKey.has(key)));
  const visibleExpenseCards = orderedExpenseCards.filter((card) => !hiddenKeySet.has(card.key));
  const draggedCard = draggedKey ? expenseCardByKey.get(draggedKey) : null;
  const visibleCount = visibleExpenseCards.length;
  const groupQuery = groupId ? `&groupId=${encodeURIComponent(groupId)}` : '';
  const csvHref = `/api/views/profit-report?from=${dateFrom}&to=${dateTo}&format=csv${groupQuery}`;
  const detailTotals = breakdown?.итоги ?? {};
  const detailRevenue = toNumber(detailTotals.выручка || revenue.value);
  const detailProfit = toNumber(detailTotals.чистая_прибыль || profit.value);
  const detailExpenses = Math.max(detailRevenue - detailProfit, 0);
  const detailCommission = toNumber(detailTotals.комиссия_wb);
  const detailLogistics = toNumber(detailTotals.логистика);
  const detailWbStorage = toNumber(detailTotals.хранение_wb_из_weekly);
  const detailPenalty = toNumber(detailTotals.штрафы_wb);
  const detailPaymentSchedule = toNumber(detailTotals.платное_перечисление_wb);
  const detailDeduction = toNumber(detailTotals.удержания_wb);
  const detailAcquiring = toNumber(detailTotals.эквайринг_wb);
  const detailAdditionalPayment = toNumber(detailTotals.доплаты_wb);
  const detailProvisionalOtherFees = toNumber(detailTotals.оценочные_удержания_после_последнего_weekly);
  const detailCogs = toNumber(detailTotals.себестоимость);
  const detailAds = toNumber(detailTotals.реклама || ads.value);
  const detailTax = toNumber(detailTotals.налог);
  const rawDetailPaidStorage = toNumber(detailTotals.хранение_paid_storage);
  const storageSource = typeof (kpi as { storageSource?: unknown }).storageSource === 'string'
    ? (kpi as { storageSource: string }).storageSource
    : '';
  const storageUsesPaidStorage = storageSource === 'paid_storage'
    || storageSource === 'hybrid_paid_storage'
    || Math.abs(rawDetailPaidStorage) > 0.01;
  const detailPaidStorage = storageUsesPaidStorage
    ? toNumber(rawDetailPaidStorage || storage.value)
    : 0;
  const detailStorageValue = storageUsesPaidStorage
    ? detailPaidStorage
    : toNumber(detailWbStorage || storage.value);
  const detailStorageNote = storageUsesPaidStorage
    ? `raw_api_paid_storage.storage_amount; weekly paidStorage ${formatRubExact(detailWbStorage)} показан как сверка и не плюсуется вторым расходом.`
    : 'finance fallback: weekly paidStorage → raw_api_realization_reports.storage_fee_rub.';
  const detailRows = ([
    {
      key: 'commission',
      label: 'Комиссия WB',
      value: detailCommission,
      note: 'weekly ppvzSalesCommission → raw_api_realization_reports.commission_amount.',
      color: 'bg-amber-500',
    },
    {
      key: 'logistics',
      label: 'Логистика WB',
      value: detailLogistics,
      note: 'mv_daily_pnl_final.logistics: deliveryService привязан к дате выкупа/реализации по Srid; без выкупа остается на дате WB.',
      color: 'bg-amber-500',
    },
    {
      key: 'penalty',
      label: 'Штрафы WB',
      value: detailPenalty,
      note: 'weekly penalty → raw_api_realization_reports.penalty_rub.',
      color: 'bg-rose-500',
    },
    {
      key: 'paymentSchedule',
      label: 'Платное перечисление WB',
      value: detailPaymentSchedule,
      note: 'weekly paymentSchedule → raw_api_realization_reports.payment_schedule_rub.',
      color: 'bg-orange-500',
    },
    {
      key: 'deduction',
      label: 'Удержания WB (без тела кредита и продвижения)',
      value: detailDeduction,
      note: 'weekly deduction за вычетом строк погашения тела кредита и WB Продвижения; реклама учитывается отдельно через рекламный контур.',
      color: 'bg-orange-500',
    },
    {
      key: 'acquiring',
      label: 'Эквайринг WB',
      value: detailAcquiring,
      note: 'weekly acquiringFee → raw_api_realization_reports.acquiring_fee.',
      color: 'bg-violet-500',
    },
    {
      key: 'additionalPayment',
      label: 'Доплаты WB',
      value: -detailAdditionalPayment,
      note: 'weekly additionalPayment → raw_api_realization_reports.additional_payment; уменьшает удержания.',
      color: 'bg-emerald-500',
    },
    {
      key: 'provisionalTail',
      label: 'Оценочные удержания хвоста',
      value: detailProvisionalOtherFees,
      note: 'raw_api_sales после последнего weekly: расчетная разница между ценой продажи и выплатой WB.',
      color: 'bg-yellow-500',
    },
    {
      key: 'cogs',
      label: 'Себестоимость товаров',
      value: detailCogs,
      note: 'Кол-во выкупов × полный себес из экономики.',
      color: 'bg-cyan-500',
    },
    {
      key: 'ads',
      label: 'Реклама WB',
      value: detailAds,
      note: 'Источник: рекламные расходы WB за период.',
      color: 'bg-blue-500',
    },
    {
      key: 'paidStorage',
      label: 'Хранение WB',
      value: detailStorageValue,
      note: detailStorageNote,
      color: 'bg-slate-500',
    },
    {
      key: 'tax',
      label: 'Налог',
      value: detailTax,
      note: 'По текущему налоговому режиму кабинета.',
      color: 'bg-rose-500',
    },
  ] satisfies ExpenseDetailRow[]).filter((row) => Math.abs(row.value) > 0.01);
  const wbReferenceRows = [
    ['commission_amount / ppvzSalesCommission', detailCommission],
    ['delivery_rub / deliveryService', detailLogistics],
    ['storage_fee_rub / paidStorage', detailWbStorage],
    ['penalty_rub / penalty', detailPenalty],
    ['payment_schedule_rub / paymentSchedule', detailPaymentSchedule],
    ['deduction / Удержания (без тела кредита и WB Продвижения)', detailDeduction],
    ['acquiring_fee / acquiringFee', detailAcquiring],
    ['additional_payment / additionalPayment', detailAdditionalPayment],
    ['provisional tail из raw_api_sales', detailProvisionalOtherFees],
    ['raw_api_paid_storage.storage_amount', detailPaidStorage],
  ].filter(([, value]) => Math.abs(Number(value)) > 0.01) as [string, number][];
  const deductionDetailRows = useMemo<DeductionDetailRow[]>(() => {
    return [...(breakdown?.удержания_wb_расшифровка ?? [])]
      .map((row) => ({
        date: row.дата ?? '',
        reportId: toNumber(row.отчет_wb),
        operation: row.операция ?? '',
        docType: row.тип_документа ?? '',
        reason: row.причина ?? 'Без расшифровки в сохраненных данных',
        nmId: toNumber(row.nmId),
        vendorCode: row.артикул_продавца ?? '',
        rowCount: toNumber(row.строк),
        firstRrdId: row.первая_строка_rrd ?? '',
        amount: toNumber(row.сумма),
        amountExpense: toNumber(row.сумма_в_расходах),
        kind: row.тип_удержания ?? 'other',
        inPnl: row.в_расходах_pnl !== 'нет',
      }))
      .filter((row) => Math.abs(row.amount) > 0.01)
      .sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date));
  }, [breakdown]);
  const skuExpenseRows = useMemo<SkuExpenseRow[]>(() => {
    return [...(breakdown?.sku ?? [])]
      .map((row) => {
        const rowRevenue = toNumber(row.выручка);
        const rowProfit = toNumber(row.чистая_прибыль);
        return {
          nmId: toNumber(row.nmId),
          brand: row.бренд ?? '',
          vendorCode: row.артикул_продавца ?? '',
          photoUrl: row.фото_url ?? '',
          revenue: rowRevenue,
          expenses: Math.max(rowRevenue - rowProfit, 0),
          ads: toNumber(row.реклама),
          cogs: toNumber(row.себестоимость),
          paidStorage: toNumber(row.хранение_paid_storage),
          commission: toNumber(row.комиссия_wb),
          logistics: toNumber(row.логистика),
          wbStorageFee: toNumber(row.хранение_wb_из_weekly),
          penalty: toNumber(row.штрафы_wb),
          paymentSchedule: toNumber(row.платное_перечисление_wb),
          deduction: toNumber(row.удержания_wb),
          acquiringFee: toNumber(row.эквайринг_wb),
          additionalPayment: toNumber(row.доплаты_wb),
          provisionalOtherFees: toNumber(row.оценочные_удержания_после_последнего_weekly),
          tax: toNumber(row.налог),
          profit: rowProfit,
        };
      })
      .filter((row) => row.nmId > 0 && row.expenses > 0)
      .sort((a, b) => b.expenses - a.expenses)
      .slice(0, 12);
  }, [breakdown]);

  useEffect(() => {
    if (!metricsMenuOpen) {
      return;
    }

    function onDocClick(event: MouseEvent) {
      if (!metricsMenuRef.current?.contains(event.target as Node)) {
        setMetricsMenuOpen(false);
      }
    }

    function onEsc(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setMetricsMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [metricsMenuOpen]);

  useEffect(() => {
    if (!breakdownOpen) {
      return;
    }

    let cancelled = false;

    fetch(`/api/views/profit-report?from=${dateFrom}&to=${dateTo}${groupQuery}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Не удалось загрузить детализацию затрат');
        }
        return (await response.json()) as ProfitReportResponse;
      })
      .then((payload) => {
        if (!cancelled) {
          setBreakdown(payload);
          setBreakdownLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBreakdownError(error instanceof Error ? error.message : 'Не удалось загрузить детализацию затрат');
          setBreakdownLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [breakdownOpen, dateFrom, dateTo, groupQuery]);

  const persistOrder = (nextOrder: ExpenseCardKey[]) => {
    setCardOrder(nextOrder);
    window.localStorage.setItem(EXPENSE_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
  };

  const resetOrder = () => {
    setCardOrder([]);
    window.localStorage.removeItem(EXPENSE_ORDER_STORAGE_KEY);
  };

  const persistHiddenCards = (nextHiddenKeys: ExpenseCardKey[]) => {
    setHiddenCardKeys(nextHiddenKeys);
    window.localStorage.setItem(EXPENSE_VISIBILITY_STORAGE_KEY, JSON.stringify(nextHiddenKeys));
  };

  const toggleCardVisibility = (key: ExpenseCardKey) => {
    const isHidden = hiddenKeySet.has(key);
    if (!isHidden && visibleCount <= 1) {
      return;
    }

    const nextHiddenKeys = isHidden
      ? hiddenCardKeys.filter((item) => item !== key)
      : [...hiddenCardKeys.filter((item) => expenseCardByKey.has(item)), key];

    persistHiddenCards(nextHiddenKeys);
  };

  const resetVisibility = () => {
    setHiddenCardKeys([]);
    window.localStorage.removeItem(EXPENSE_VISIBILITY_STORAGE_KEY);
  };

  const moveCard = (fromKey: ExpenseCardKey, toKey: ExpenseCardKey) => {
    if (fromKey === toKey) {
      return;
    }

    const nextOrder = orderedExpenseCards.map((card) => card.key);
    const fromIndex = nextOrder.indexOf(fromKey);
    const toIndex = nextOrder.indexOf(toKey);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const moved = nextOrder.splice(fromIndex, 1)[0];
    if (!moved) {
      return;
    }

    nextOrder.splice(toIndex, 0, moved);
    persistOrder(nextOrder);
  };

  const clearDragState = () => {
    setDraggedKey(null);
    setDragOverKey(null);
    setDragPreview(null);
  };

  const updateDragPreviewPosition = (event: DragEvent<HTMLElement>) => {
    if (!draggedKey || (event.clientX === 0 && event.clientY === 0)) {
      return;
    }

    setDragPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetKey: ExpenseCardKey) => {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData('text/plain');
    if (isExpenseCardKey(sourceKey)) {
      moveCard(sourceKey, targetKey);
    }
    clearDragState();
  };

  const startDrag = (event: DragEvent<HTMLElement>, card: ExpenseCardData) => {
    setDraggedKey(card.key);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.key);

    const cardNode = event.currentTarget.closest<HTMLElement>('[data-expense-card]');
    if (cardNode) {
      const rect = cardNode.getBoundingClientRect();
      setDragPreview({
        x: event.clientX,
        y: event.clientY,
        width: rect.width,
        height: rect.height,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      });
    }

    const transparentDragImage = document.createElement('canvas');
    transparentDragImage.width = 1;
    transparentDragImage.height = 1;
    transparentDragImage.style.position = 'fixed';
    transparentDragImage.style.left = '-10000px';
    transparentDragImage.style.top = '-10000px';
    document.body.appendChild(transparentDragImage);
    event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
    window.setTimeout(() => transparentDragImage.remove(), 0);
  };

  function openBreakdown() {
    setBreakdown(null);
    setBreakdownError(null);
    setBreakdownLoading(true);
    setBreakdownOpen(true);
  }

  useEffect(() => {
    window.addEventListener(OPEN_EXPENSE_BREAKDOWN_EVENT, openBreakdown);
    return () => {
      window.removeEventListener(OPEN_EXPENSE_BREAKDOWN_EVENT, openBreakdown);
    };
  });

  return (
    <div className="space-y-4">
      <SectionTitle title="Расходы" note={`Логистика всего: ${formatRub(logistics.value)}`} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(430px,0.95fr)]">
        <div className="dashboard-card min-h-[220px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-muted-foreground">Распределение расходов за период</p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground/75">
                Общая база: {formatRub(totalExpenses)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openBreakdown}
                className="inline-flex h-8 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-black text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-200"
              >
                Провалиться
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <HelpPopover
                title="Как считается распределение"
                text="Сначала считаем все расходы как выручка минус чистая прибыль. Рекламу и хранение берём отдельными строками, удержания WB раскрываем по полям weekly-отчета."
              />
            </div>
          </div>

          <div className="mt-10 h-5 overflow-hidden rounded-full bg-subtle">
            {categories.length ? (
              <div className="flex h-full w-full">
                {categories.map((category) => (
                  <div
                    key={category.key}
                    className="group/segment relative h-full min-w-[3px]"
                    style={{ width: `${share(category.value, expenseBase)}%`, backgroundColor: category.color }}
                  >
                    <div className="pointer-events-none absolute left-1/2 top-8 z-20 w-64 -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground opacity-0 shadow-[var(--shadow-lg)] transition-opacity group-hover/segment:opacity-100">
                      <p className="font-black">{category.label}</p>
                      <p className="mt-1 text-muted-foreground">{formatRub(category.value)} · {formatPercent(share(category.value, expenseBase))}</p>
                      <p className="mt-2 text-muted-foreground">{category.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3">
            {categories.map((category) => (
              <div key={category.key} className="flex min-w-0 items-center gap-2 text-xs font-bold text-muted-foreground">
                <span className={`h-2 w-2 shrink-0 rounded-full ${category.bg}`} />
                <span className="truncate">{category.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-card min-h-[220px] p-5">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-bold text-muted-foreground">История расходов за период</p>
            <HelpPopover
              title="Как читать историю"
              text="Каждый столбик показывает расходы дня. Сегменты повторяют распределение: операционные расходы, реклама и хранение. Наведите на столбик, чтобы увидеть суммы."
            />
          </div>

          <div className="mt-5 flex h-[150px] items-end gap-1.5 overflow-hidden">
            {dailyRows.map((row, index) => {
              const barHeight = Math.max(4, (row.total / maxDailyExpense) * 100);
              const segmentBase = Math.max(row.total, 1);

              return (
                <div key={`${row.label}-${index}`} className="group/bar relative flex h-full flex-1 min-w-[8px] items-end justify-center">
                  <div
                    className="flex w-full max-w-[18px] flex-col-reverse overflow-hidden rounded-t-md bg-subtle"
                    style={{ height: `${barHeight}%` }}
                  >
                    <span className="bg-amber-500" style={{ height: `${share(row.operations, segmentBase)}%` }} />
                    <span className="bg-green-500" style={{ height: `${share(row.logistics, segmentBase)}%` }} />
                    <span className="bg-blue-500" style={{ height: `${share(row.ads, segmentBase)}%` }} />
                    <span className="bg-slate-800 dark:bg-slate-500" style={{ height: `${share(row.storage, segmentBase)}%` }} />
                  </div>
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground opacity-0 shadow-[var(--shadow-lg)] transition-opacity group-hover/bar:opacity-100">
                    <p className="font-black">{row.label || 'День'}</p>
                    <p className="mt-1 text-muted-foreground">Всего: {formatRub(row.total)}</p>
                    <p className="text-muted-foreground">Прочие WB, себес, налог: {formatRub(row.operations)}</p>
                    <p className="text-muted-foreground">Логистика: {formatRub(row.logistics)}</p>
                    <p className="text-muted-foreground">Реклама: {formatRub(row.ads)}</p>
                    <p className="text-muted-foreground">Хранение: {formatRub(row.storage)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {draggedCard && dragPreview ? (
          <ExpenseDragPreview card={draggedCard} preview={dragPreview} />
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {cardOrder.length > 0 ? (
            <button
              type="button"
              onClick={resetOrder}
              className="inline-flex h-8 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-bold text-muted-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Сбросить порядок
            </button>
          ) : null}

          <div ref={metricsMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setMetricsMenuOpen((current) => !current)}
              className="inline-flex h-8 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-bold text-muted-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
              aria-expanded={metricsMenuOpen}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Метрики {visibleCount}/{orderedExpenseCards.length}
            </button>

            {metricsMenuOpen ? (
              <div className="absolute right-0 top-10 z-50 w-[300px] origin-top-right overflow-hidden rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-lg)] animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200 ease-out">
                <div className="flex items-center justify-between gap-3 px-2 py-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">Расходы</p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground/75">Показывать в блоке</p>
                  </div>
                  {hiddenKeySet.size > 0 ? (
                    <button
                      type="button"
                      onClick={resetVisibility}
                      className="rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-black text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      Все
                    </button>
                  ) : null}
                </div>
                <div className="mt-1 max-h-[320px] overflow-y-auto pr-1">
                  {orderedExpenseCards.map((card) => {
                    const isHidden = hiddenKeySet.has(card.key);
                    const isLastVisible = !isHidden && visibleCount <= 1;

                    return (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => toggleCardVisibility(card.key)}
                        disabled={isLastVisible}
                        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                          isLastVisible
                            ? 'cursor-not-allowed opacity-45'
                            : 'hover:bg-accent'
                        }`}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          isHidden
                            ? 'border-border bg-subtle text-transparent'
                            : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300'
                        }`}>
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${card.color}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-foreground">{card.label}</span>
                          <span className="block truncate text-xs font-semibold text-muted-foreground">{card.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {visibleExpenseCards.map((card) => (
            <ExpenseCard
              key={card.key}
              card={card}
              isDragging={draggedKey === card.key}
              isDropTarget={dragOverKey === card.key && draggedKey !== card.key}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOverKey(card.key);
                updateDragPreviewPosition(event);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragOverKey(null);
                }
              }}
              onDrop={(event) => handleDrop(event, card.key)}
              onDragStart={(event) => startDrag(event, card)}
              onDrag={updateDragPreviewPosition}
              onDragEnd={clearDragState}
            />
          ))}
        </div>
      </div>

      <SectionTitle title="Остатки и товары в доставке" note="Последний доступный snapshot WB" />
      <div className="grid gap-3 lg:grid-cols-3">
        <StockCard label="Всего в системе" value={stockTotal} caption="остатки WB + товары в пути" />
        <StockCard label="На складе для продажи" value={stockAvailable} caption={`${formatPercent(share(stockAvailable, Math.max(stockTotal, 1)))} от всех остатков`} />
        <StockCard label="В доставке" value={stockTransit} caption={`${formatPercent(share(stockTransit, Math.max(stockTotal, 1)))} от всех остатков`} />
      </div>

      {breakdownOpen ? (
        <ExpenseBreakdownModal
          dateFrom={dateFrom}
          dateTo={dateTo}
          csvHref={csvHref}
          loading={breakdownLoading}
          error={breakdownError}
          revenue={detailRevenue}
          profit={detailProfit}
          totalExpenses={detailExpenses}
          rows={detailRows}
          wbReferenceRows={wbReferenceRows}
          deductionRows={deductionDetailRows}
          skuRows={skuExpenseRows}
          onClose={() => setBreakdownOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
      {note ? (
        <span className="rounded-full border border-border bg-subtle px-3 py-1 text-xs font-black text-foreground">
          {note}
        </span>
      ) : null}
    </div>
  );
}

function HelpPopover({ title, text }: { title: string; text: string }) {
  return (
    <div className="group/help relative">
      <CircleHelp className="h-4 w-4 text-muted-foreground/70 transition-colors group-hover/help:text-cyan-500" />
      <div className="pointer-events-none absolute right-0 top-6 z-40 w-72 rounded-xl border border-border bg-popover p-3 text-xs leading-5 text-popover-foreground opacity-0 shadow-[var(--shadow-lg)] transition-opacity group-hover/help:opacity-100">
        <p className="font-black text-cyan-500 dark:text-cyan-300">{title}</p>
        <p className="mt-1 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function ExpenseDragPreview({ card, preview }: { card: ExpenseCardData; preview: DragPreviewState }) {
  const isPositiveTrend = card.goodWhenDown ? card.delta <= 0 : card.delta >= 0;
  const trendToneClass = isPositiveTrend
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
    : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300';

  return (
    <div
      className="pointer-events-none fixed z-[1000] rounded-2xl border border-cyan-400/80 bg-card/95 p-4 text-foreground opacity-95 shadow-[0_28px_80px_rgba(6,182,212,0.28)] ring-2 ring-cyan-400/25 backdrop-blur-xl"
      style={{
        left: preview.x,
        top: preview.y,
        width: preview.width,
        minHeight: Math.min(preview.height, 160),
        transform: `translate(-${preview.offsetX}px, -${preview.offsetY}px) rotate(-1.5deg)`,
      }}
    >
      <div className="flex min-w-0 items-center gap-2 pr-20">
        <GripVertical className="h-4 w-4 shrink-0 text-cyan-500" />
        <span className={`h-2 w-2 shrink-0 rounded-full ${card.color}`} aria-hidden />
        <span className="truncate text-sm font-black text-muted-foreground">{card.label}</span>
      </div>
      <div className={`absolute right-4 top-4 inline-flex max-w-[104px] items-center gap-1 truncate rounded-full border px-2 py-1 text-[10px] font-black ${trendToneClass}`}>
        {isPositiveTrend ? <TrendingUp className="h-3 w-3 shrink-0" /> : <TrendingDown className="h-3 w-3 shrink-0" />}
        <span className="truncate">{formatDelta(card.delta)}</span>
      </div>
      <span className="mt-4 block truncate text-xs leading-tight text-muted-foreground/70">{card.description}</span>
      <div className="mt-3 break-words text-3xl font-black leading-tight tracking-tight text-foreground">
        {card.value}
      </div>
    </div>
  );
}

function ExpenseCard({
  card,
  isDragging,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  card: ExpenseCardData;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrag: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const isPositiveTrend = card.goodWhenDown ? card.delta <= 0 : card.delta >= 0;
  const trendToneClass = isPositiveTrend
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
    : 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300';

  return (
    <div
      data-expense-card
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative min-h-[116px] overflow-visible rounded-2xl border bg-card p-4 shadow-[var(--shadow-xs)] transition-all duration-200 ease-out hover:z-30 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)] dark:bg-[#0d0f14] ${
        isDropTarget
          ? 'z-40 scale-[1.015] border-cyan-400/70 bg-cyan-50/40 ring-2 ring-cyan-400/25 shadow-[0_18px_50px_rgba(6,182,212,0.18)] dark:bg-cyan-400/10'
          : 'border-border'
      } ${isDragging ? 'z-50 scale-[0.985] rotate-[-0.35deg] border-cyan-400/60 bg-cyan-50/50 opacity-60 ring-2 ring-cyan-400/35 shadow-[0_20px_60px_rgba(6,182,212,0.20)] dark:bg-cyan-400/10' : ''}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-cyan-400/45 bg-card/60 backdrop-blur-[1px]">
          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-600 dark:text-cyan-200">
            Перетаскивается
          </span>
        </div>
      ) : null}
      {isDropTarget ? (
        <div className="pointer-events-none absolute inset-0 z-30 rounded-2xl border-2 border-dashed border-cyan-400/70 bg-cyan-400/[0.06]">
          <span className="absolute left-4 top-4 rounded-full border border-cyan-400/30 bg-card/90 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-600 shadow-[var(--shadow-xs)] dark:text-cyan-200">
            Отпустить сюда
          </span>
        </div>
      ) : null}

      <div className="relative z-10 pr-24">
        <div className="flex min-w-0 items-start gap-2 pt-1">
          <span
            draggable
            title="Перетащить"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            className={`inline-flex h-4 w-4 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 transition-all hover:bg-subtle hover:text-cyan-500 active:cursor-grabbing ${
              isDragging ? 'animate-pulse bg-cyan-500 text-white shadow-[0_0_0_6px_rgba(6,182,212,0.12)]' : ''
            }`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${card.color}`} aria-hidden />
          <span className="min-w-0 text-sm font-bold leading-4 text-muted-foreground">
            {card.label}
          </span>
          <span className="group/help relative inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center">
            <CircleHelp className="h-3.5 w-3.5 text-muted-foreground/60 transition-colors group-hover/help:text-cyan-500" />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-6 left-1/2 z-50 w-[300px] max-w-[calc(100vw-2rem)] -translate-x-1/2 translate-y-1 rounded-2xl border border-border bg-popover/88 p-3 text-popover-foreground opacity-0 shadow-[var(--shadow-lg)] backdrop-blur-xl transition-all duration-150 delay-0 group-hover/help:translate-y-0 group-hover/help:opacity-100 group-hover/help:delay-700"
            >
              <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-cyan-500 dark:text-cyan-300">
                Как считается
              </span>
              <span className="mt-2 block text-[11px] font-semibold leading-5 text-muted-foreground">
                {card.formula}
              </span>
            </span>
          </span>
        </div>
      </div>

      <div className={`absolute right-4 top-4 z-20 inline-flex max-w-[104px] shrink-0 items-center gap-1 truncate rounded-full border px-2 py-1 text-[10px] font-black ${trendToneClass}`}>
        {isPositiveTrend ? <TrendingUp className="h-3 w-3 shrink-0" /> : <TrendingDown className="h-3 w-3 shrink-0" />}
        <span className="truncate">{formatDelta(card.delta)}</span>
      </div>

      <div className="relative z-10 mt-8 min-w-0">
        <div className="break-words text-2xl font-black leading-tight tracking-tight text-foreground">{card.value}</div>
        <div className="mt-3 text-xs font-semibold text-muted-foreground">{card.description}</div>
      </div>
    </div>
  );
}

function ExpenseBreakdownModal({
  dateFrom,
  dateTo,
  csvHref,
  loading,
  error,
  revenue,
  profit,
  totalExpenses,
  rows,
  wbReferenceRows,
  deductionRows,
  skuRows,
  onClose,
}: {
  dateFrom: string;
  dateTo: string;
  csvHref: string;
  loading: boolean;
  error: string | null;
  revenue: number;
  profit: number;
  totalExpenses: number;
  rows: ExpenseDetailRow[];
  wbReferenceRows: [string, number][];
  deductionRows: DeductionDetailRow[];
  skuRows: SkuExpenseRow[];
  onClose: () => void;
}) {
  const maxRowValue = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const [selectedExpenseKey, setSelectedExpenseKey] = useState<ExpenseDetailKey | null>(rows[0]?.key ?? null);

  const selectedRow = rows.find((row) => row.key === selectedExpenseKey) ?? rows[0] ?? null;
  const selectedRowKey = selectedRow?.key ?? null;
  const selectedExplanation = selectedRow ? getExpenseExplanation(selectedRow.key) : null;
  const selectedSourceRows = selectedRow
    ? getExpenseSourceRows(selectedRow.key, selectedRow.value, wbReferenceRows)
    : [];
  const selectedSkuRows = selectedRowKey
    ? skuRows
      .map((row) => ({ row, value: getSkuExpenseValue(row, selectedRowKey) }))
      .filter(({ value }) => Math.abs(value) > 0.01)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 6)
    : [];
  const deductionReasonGroups = useMemo(
    () => buildDeductionReasonGroups(deductionRows),
    [deductionRows],
  );
  const deductionExpenseReasonGroups = useMemo(
    () => deductionReasonGroups
      .filter((group) => Math.abs(group.amountExpense) > 0.01)
      .sort((a, b) => Math.abs(b.amountExpense) - Math.abs(a.amountExpense)),
    [deductionReasonGroups],
  );
  const deductionExcludedReasonGroups = useMemo(
    () => deductionReasonGroups
      .filter((group) => Math.abs(group.amountExcluded) > 0.01)
      .sort((a, b) => Math.abs(b.amountExcluded) - Math.abs(a.amountExcluded)),
    [deductionReasonGroups],
  );
  const selectedSkuCount = selectedSkuRows.length;
  const deductionReportLevelAmount = deductionRows
    .filter((row) => row.nmId <= 0)
    .reduce((sum, row) => sum + row.amountExpense, 0);
  const deductionSkuLevelAmount = deductionRows
    .filter((row) => row.nmId > 0)
    .reduce((sum, row) => sum + row.amountExpense, 0);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/35 px-3 py-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_30px_100px_rgba(15,23,42,0.32)] dark:bg-[#0d0f14]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-500 dark:text-cyan-300">
              Провал в затраты
            </p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-foreground">
              Куда ушли деньги за период
            </h3>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {dateFrom} — {dateTo}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={csvHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent"
            >
              CSV
              <ExternalLink className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm font-bold text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
              Загружаю детализацию затрат...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
              {error}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <BreakdownStat label="Выручка" value={formatRubExact(revenue)} />
                <BreakdownStat label="Чистая прибыль" value={formatRubExact(profit)} />
                <BreakdownStat label="Все затраты" value={formatRubExact(totalExpenses)} accent />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-foreground">Разбор по статьям</p>
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        WB-удержания, себес, реклама, хранение и налог с источниками данных.
                      </p>
                    </div>
                    <p className="rounded-full border border-border bg-subtle px-3 py-1 text-xs font-black text-foreground">
                      {formatRubExact(totalExpenses)}
                    </p>
                  </div>

                  <div className="mt-4 space-y-3">
                    {rows.map((row) => {
                      const isSelected = selectedRow?.key === row.key;
                      return (
                      <button
                        key={row.key}
                        type="button"
                        onClick={() => setSelectedExpenseKey(row.key)}
                        className={`grid w-full gap-2 rounded-xl border p-3 text-left transition-colors sm:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1.1fr)_130px] sm:items-center ${
                          isSelected
                            ? 'border-cyan-400/70 bg-cyan-500/10 shadow-[0_0_0_3px_rgba(6,182,212,0.10)]'
                            : 'border-border bg-background/70 hover:border-border-strong hover:bg-accent/60 dark:bg-[#080a0f]'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-foreground">{row.label}</p>
                          <p className="mt-1 text-xs font-semibold text-muted-foreground">{row.note}</p>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-subtle">
                          <div
                            className={`h-full rounded-full ${row.color}`}
                            style={{ width: `${Math.max(2, (Math.abs(row.value) / maxRowValue) * 100)}%` }}
                          />
                        </div>
                        <p className="text-right text-sm font-black text-foreground">{formatRubExact(row.value)}</p>
                      </button>
                    );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
                  {selectedRow && selectedExplanation ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-foreground">{selectedRow.label}</p>
                          <p className="mt-1 text-xs font-semibold text-muted-foreground">
                            Детализация выбранной статьи.
                          </p>
                        </div>
                        <p className="shrink-0 rounded-full border border-border bg-subtle px-3 py-1 text-xs font-black text-foreground">
                          {formatRubExact(selectedRow.value)}
                        </p>
                      </div>

                      <div className="space-y-2">
                        {selectedSourceRows.map((row) => (
                          <div key={row.label} className="flex items-start justify-between gap-3 rounded-xl bg-subtle/70 px-3 py-2">
                            <span className="text-xs font-bold text-muted-foreground">{row.label}</span>
                            <span className="text-right text-xs font-black text-foreground">{formatRubExact(row.value)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-3 rounded-xl border border-border bg-background/70 p-3 dark:bg-[#080a0f]">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Откуда берем</p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-foreground">{selectedExplanation.source}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Что означает</p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-foreground">{selectedExplanation.meaning}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Как проверить</p>
                          <p className="mt-1 text-xs font-semibold leading-5 text-foreground">{selectedExplanation.check}</p>
                        </div>
                      </div>

                      {selectedRow.key === 'deduction' ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-border bg-background/70 p-3 dark:bg-[#080a0f]">
                              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">На уровне отчета</p>
                              <p className="mt-1 text-sm font-black text-foreground">{formatRubExact(deductionReportLevelAmount)}</p>
                            </div>
                            <div className="rounded-xl border border-border bg-background/70 p-3 dark:bg-[#080a0f]">
                              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">На SKU</p>
                              <p className="mt-1 text-sm font-black text-foreground">{formatRubExact(deductionSkuLevelAmount)}</p>
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Причины удержаний в PnL</p>
                            <div className="mt-2 space-y-2">
                              {deductionExpenseReasonGroups.length > 0 ? (
                                deductionExpenseReasonGroups.slice(0, 8).map((group) => (
                                  <details key={group.reason} className="group rounded-xl border border-border bg-background/70 px-3 py-2 dark:bg-[#080a0f]">
                                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                                      <span className="min-w-0">
                                        <span className="block text-xs font-black text-foreground">{group.reason}</span>
                                        <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">
                                          строк: {group.rowCount}; отчетов: {group.reportCount || 'н/д'}; SKU: {group.skuCount || 'отчет'}
                                          {Math.abs(group.amountExcluded) > 0.01 ? `; исключено: ${formatRubExact(group.amountExcluded)}` : ''}
                                        </span>
                                      </span>
                                      <span className="shrink-0 text-right text-xs font-black text-foreground">{formatRubExact(group.amountExpense)}</span>
                                    </summary>

                                    {group.creditRows && group.creditRows.length > 0 ? (
                                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                                        {group.creditRows.map((credit) => (
                                          <div key={`${credit.creditId}-${credit.creditDate}`} className="rounded-lg bg-subtle/70 px-3 py-2">
                                            <div className="flex items-start justify-between gap-3">
                                              <p className="text-xs font-black text-foreground">
                                                От {credit.creditDate || 'н/д'} {credit.creditId ? `(№${credit.creditId})` : ''}
                                              </p>
                                              <p className="text-right text-xs font-black text-foreground">{formatRubExact(credit.total)}</p>
                                            </div>
                                            <div className="mt-2 grid gap-2 text-[11px] font-semibold">
                                              <span className="rounded-md bg-background/80 px-2 py-1 text-muted-foreground">
                                                тело: <b className="text-foreground">{formatRubExact(credit.principal)}</b>
                                              </span>
                                              <span className="rounded-md bg-background/80 px-2 py-1 text-muted-foreground">
                                                проценты: <b className="text-foreground">{formatRubExact(credit.interest)}</b>
                                              </span>
                                              <span className="rounded-md bg-background/80 px-2 py-1 text-muted-foreground">
                                                строк: <b className="text-foreground">{credit.rowCount}</b>
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : group.details && group.details.length > 0 ? (
                                      <div className="mt-3 space-y-1 border-t border-border pt-3">
                                        {group.details.slice(0, 6).map((detail) => (
                                          <p key={detail} className="text-[11px] font-semibold text-muted-foreground">{detail}</p>
                                        ))}
                                      </div>
                                    ) : null}
                                  </details>
                                ))
                              ) : (
                                <p className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
                                  В расход PnL по удержаниям ничего не попало.
                                </p>
                              )}
                            </div>
                          </div>

                          {deductionExcludedReasonGroups.length > 0 ? (
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Исключено из PnL</p>
                              <div className="mt-2 space-y-2">
                                {deductionExcludedReasonGroups.slice(0, 6).map((group) => (
                                  <div key={group.reason} className="flex items-start justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 dark:border-orange-500/25 dark:bg-orange-500/10">
                                    <span className="min-w-0 text-xs font-bold text-orange-800 dark:text-orange-200">
                                      {group.reason}
                                      <span className="mt-1 block text-[11px] font-semibold text-orange-700/80 dark:text-orange-200/75">
                                        Не входит в эту статью PnL: промо идет через рекламу, тело кредита не является расходом.
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-right text-xs font-black text-orange-800 dark:text-orange-100">{formatRubExact(group.amountExcluded)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : selectedSkuRows.length > 0 ? (
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                            Топ SKU по статье
                          </p>
                          <div className="mt-2 space-y-2">
                            {selectedSkuRows.map(({ row, value }) => (
                              <div key={`${selectedRow.key}-${row.nmId}`} className="flex items-start justify-between gap-3 rounded-xl bg-subtle/70 px-3 py-2">
                                <ExpenseSkuCell row={row} compact />
                                <p className="shrink-0 text-right text-xs font-black text-foreground">{formatRubExact(value)}</p>
                              </div>
                            ))}
                          </div>
                          <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
                            Показано SKU: {selectedSkuCount}; полный список ниже в таблице.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-muted-foreground">Нет статей затрат для детализации.</p>
                  )}
                </div>
              </div>

              {deductionRows.length > 0 ? (
                <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-foreground">Расшифровка удержаний WB</p>
                      <p className="mt-1 text-xs font-semibold text-muted-foreground">
                        Строки weekly, где `Удержания` не равны нулю. Если SKU = 0, WB списал сумму на уровне отчета.
                      </p>
                    </div>
                    <p className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
                      {formatRubExact(deductionRows.reduce((sum, row) => sum + row.amount, 0))}
                    </p>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-xs">
                      <thead className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2">Дата</th>
                          <th className="px-3 py-2">Отчет WB</th>
                          <th className="px-3 py-2">Операция</th>
                          <th className="px-3 py-2">Причина / куда списано</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2">rrd</th>
                          <th className="px-3 py-2 text-right">Строк</th>
                          <th className="px-3 py-2 text-right">Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deductionRows.map((row) => (
                          <tr key={`${row.reportId}-${row.date}-${row.reason}-${row.firstRrdId}`} className="border-b border-border/70 last:border-0">
                            <td className="px-3 py-2 font-semibold text-muted-foreground">{row.date || 'н/д'}</td>
                            <td className="px-3 py-2 font-mono font-black text-foreground">{row.reportId || 'н/д'}</td>
                            <td className="px-3 py-2 font-bold text-muted-foreground">{row.operation || 'н/д'}</td>
                            <td className="max-w-[420px] px-3 py-2 font-black text-foreground">{row.reason}</td>
                            <td className="px-3 py-2 font-mono font-bold text-muted-foreground">
                              {row.nmId > 0 ? row.nmId : 'отчет'}
                            </td>
                            <td className="px-3 py-2 font-mono font-semibold text-muted-foreground">{row.firstRrdId || 'н/д'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{row.rowCount}</td>
                            <td className="px-3 py-2 text-right font-black text-foreground">{formatRubExact(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-foreground">SKU с самыми большими затратами</p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      Сортировка по сумме расходов: выручка минус чистая прибыль.
                    </p>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[1320px] text-left text-xs">
                    <thead className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2">Товар</th>
                        <th className="px-3 py-2">Артикул</th>
                        <th className="px-3 py-2 text-right">Расходы</th>
                        <th className="px-3 py-2 text-right">Выручка</th>
                        <th className="px-3 py-2 text-right">Реклама</th>
                        <th className="px-3 py-2 text-right">Себестоимость</th>
                        <th className="px-3 py-2 text-right">Комиссия</th>
                        <th className="px-3 py-2 text-right">Логистика</th>
                        <th className="px-3 py-2 text-right">Хранение WB</th>
                        <th className="px-3 py-2 text-right">Штрафы</th>
                        <th className="px-3 py-2 text-right">Перечисл.</th>
                        <th className="px-3 py-2 text-right">Удержания</th>
                        <th className="px-3 py-2 text-right">Эквайринг</th>
                        <th className="px-3 py-2 text-right">Доплаты</th>
                        <th className="px-3 py-2 text-right">Хвост</th>
                        <th className="px-3 py-2 text-right">Налог</th>
                        <th className="px-3 py-2 text-right">Прибыль</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skuRows.map((row) => (
                        <tr key={row.nmId} className="border-b border-border/70 last:border-0">
                          <td className="px-3 py-2">
                            <ExpenseSkuCell row={row} />
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2 font-bold text-muted-foreground">
                            {row.vendorCode || row.brand || 'н/д'}
                          </td>
                          <td className="px-3 py-2 text-right font-black text-foreground">{formatRub(row.expenses)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.revenue)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.ads)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.cogs)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.commission)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.logistics)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.wbStorageFee)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.penalty)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.paymentSchedule)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.deduction)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.acquiringFee)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-700 dark:text-emerald-300">{formatRub(-row.additionalPayment)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.provisionalOtherFees)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-muted-foreground">{formatRub(row.tax)}</td>
                          <td className="px-3 py-2 text-right font-black text-foreground">{formatRub(row.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const EXPENSE_EXPLANATIONS: Record<ExpenseDetailKey, ExpenseExplanation> = {
  commission: {
    source: 'Поле WB `ppvzSalesCommission`, в БД `raw_api_realization_reports.commission_amount`.',
    meaning: 'Комиссия маркетплейса по продажам и возвратам за выбранный период. В чистой прибыли вычитается как расход.',
    check: 'Сверить сумму в weekly-отчете по колонке `Вознаграждение Вайлдберриз / ppvzSalesCommission` за тот же период.',
  },
  logistics: {
    source: 'Поле WB `deliveryService`; для PnL берется из `mv_daily_pnl_final.logistics` после привязки к дате выкупа/реализации по `Srid`.',
    meaning: 'Логистика WB по операциям доставки, возвратов и перемещений. Если по `Srid` есть выкуп/реализация, расход попадает в день этой реализации; если выкупа нет, остается на дате WB.',
    check: 'Сверить колонку `Услуги по доставке товара покупателю / deliveryService`; для PnL сравнивать с `mv_daily_pnl_final.logistics`, потому что raw-сумма по дате WB может отличаться от управленческого PnL.',
  },
  wbStorage: {
    source: 'Поле WB `paidStorage`, в БД `raw_api_realization_reports.storage_fee_rub`.',
    meaning: 'Хранение, которое WB вернул прямо внутри weekly-отчета реализации. В разборе затрат используется как сверка к основной статье хранения, а не как второй расход.',
    check: 'Сверить колонку `Хранение / paidStorage` в weekly и сравнить с отдельным paid_storage API.',
  },
  penalty: {
    source: 'Поле WB `penalty`, в БД `raw_api_realization_reports.penalty_rub`.',
    meaning: 'Штрафы и санкции WB из weekly-отчета. Сумма напрямую уменьшает чистую прибыль.',
    check: 'Сверить строки weekly, где `penalty` не равен нулю, и посмотреть операцию/обоснование рядом.',
  },
  paymentSchedule: {
    source: 'Поле WB `paymentSchedule`, в БД `raw_api_realization_reports.payment_schedule_rub`.',
    meaning: 'Платное перечисление или связанные удержания по графику выплат, если WB отдал их в weekly.',
    check: 'Сверить колонку `paymentSchedule` в weekly по строкам выбранного периода.',
  },
  deduction: {
    source: 'Поле WB `deduction`, в БД `raw_api_realization_reports.deduction`; причина берется из `bonus_type_name`.',
    meaning: 'Это не одна статья. Внутри могут быть WB Продвижение, кредитные списания, подписки, Джем и другие корректировки WB. Тело кредита и WB Продвижение исключаются из расхода PnL; проценты остаются в расходе.',
    check: 'Смотреть блок `Причины удержаний`: если SKU = отчет, WB списал сумму на уровне отчета, а не на конкретный товар.',
  },
  acquiring: {
    source: 'Поле WB `acquiringFee`, в БД `raw_api_realization_reports.acquiring_fee`.',
    meaning: 'Эквайринг по оплатам покупателей. В PnL учитывается как расход периода.',
    check: 'Сверить колонку `Эквайринг / acquiringFee` в weekly-отчете.',
  },
  additionalPayment: {
    source: 'Поле WB `additionalPayment`, в БД `raw_api_realization_reports.additional_payment`.',
    meaning: 'Доплаты WB идут плюсом к выплатам продавцу, поэтому в провале затрат показаны со знаком минус.',
    check: 'Сверить `additionalPayment` в weekly; положительная сумма в отчете должна уменьшать итоговые расходы.',
  },
  provisionalTail: {
    source: 'Расчетный хвост из `raw_api_sales` после последнего закрытого weekly.',
    meaning: 'Оценка удержаний по продажам, которые уже есть в продажах, но еще не закрыты weekly-реализацией.',
    check: 'После появления нового weekly эта оценка должна уйти в фактические поля WB или стать нулевой.',
  },
  cogs: {
    source: 'Справочник экономики товара: полный себес с отгрузкой, умноженный на выкупленные штуки.',
    meaning: 'Себестоимость проданных товаров за период. Это внутренняя экономика, не поле WB.',
    check: 'Сверить карточку товара в экономике: должна использоваться колонка `Себес полный с отгрузкой`.',
  },
  ads: {
    source: 'Рекламные расходы WB за период из рекламного контура синхронизации.',
    meaning: 'Фактический расход на продвижение за выбранный период, распределенный в экономику дашборда.',
    check: 'Сверить с отчетом WB по рекламе за те же даты и кабинет.',
  },
  paidStorage: {
    source: 'Основной источник: `raw_api_paid_storage.storage_amount`; fallback при пустом paid_storage: `raw_api_realization_reports.storage_fee_rub`.',
    meaning: 'Основная статья хранения в дашборде. Второй контур рядом показывается только для сверки и не плюсуется вторым расходом.',
    check: 'Сверить отчет paid storage за период с weekly paidStorage; заметная разница означает неполную загрузку одного из контуров или разную дату начисления.',
  },
  tax: {
    source: 'Расчет по налоговому режиму кабинета из настроек экономики.',
    meaning: 'Налоговая нагрузка, которую дашборд вычитает после прибыли до налога.',
    check: 'Сверить ставку/режим в настройках кабинета и базу расчета за период.',
  },
};

const WB_SOURCE_LABELS: Partial<Record<ExpenseDetailKey, string[]>> = {
  commission: ['commission_amount / ppvzSalesCommission'],
  logistics: ['mv_daily_pnl_final.logistics', 'delivery_rub / deliveryService'],
  wbStorage: ['storage_fee_rub / paidStorage'],
  penalty: ['penalty_rub / penalty'],
  paymentSchedule: ['payment_schedule_rub / paymentSchedule'],
  deduction: ['deduction / Удержания (без тела кредита и WB Продвижения)'],
  acquiring: ['acquiring_fee / acquiringFee'],
  additionalPayment: ['additional_payment / additionalPayment'],
  provisionalTail: ['provisional tail из raw_api_sales'],
  paidStorage: ['raw_api_paid_storage.storage_amount', 'storage_fee_rub / paidStorage'],
};

function getExpenseExplanation(key: ExpenseDetailKey): ExpenseExplanation {
  return EXPENSE_EXPLANATIONS[key];
}

type MutableDeductionReasonGroup = DeductionReasonGroup & {
  reports: Set<number>;
  skus: Set<number>;
  docNumbers: Set<string>;
  detailsSet: Set<string>;
  creditMap?: Map<string, CreditDeductionRow & { reports: Set<number> }>;
};

function buildDeductionReasonGroups(rows: DeductionDetailRow[]): DeductionReasonGroup[] {
  const groups = new Map<string, MutableDeductionReasonGroup>();

  for (const row of rows) {
    const reason = row.reason || 'Без расшифровки в сохраненных данных';
    const credit = parseCreditDeduction(reason);
    const groupKey = credit
      ? 'credit'
      : isPromotionDeduction(reason)
        ? 'promotion'
        : normalizeDeductionReason(reason);
    const groupReason = credit
      ? 'Кредитные списания WB'
      : isPromotionDeduction(reason)
        ? 'WB Продвижение'
        : groupKey;
    const current = groups.get(groupKey) ?? createMutableDeductionGroup(groupReason);

    current.amount += row.amount;
    current.amountExpense += row.amountExpense;
    current.amountExcluded += row.amount - row.amountExpense;
    current.rowCount += row.rowCount;
    if (row.reportId > 0) {
      current.reports.add(row.reportId);
    }
    if (row.nmId > 0) {
      current.skus.add(row.nmId);
    }

    const docNumber = extractDocumentNumber(reason);
    if (docNumber) {
      current.docNumbers.add(docNumber);
    }

    if (credit) {
      const creditKey = `${credit.creditId}-${credit.creditDate}`;
      const creditRows = current.creditMap ?? new Map<string, CreditDeductionRow & { reports: Set<number> }>();
      const creditRow = creditRows.get(creditKey) ?? {
        creditId: credit.creditId,
        creditDate: credit.creditDate,
        principal: 0,
        interest: 0,
        total: 0,
        rowCount: 0,
        reportCount: 0,
        reports: new Set<number>(),
      };
      if (credit.kind === 'interest') {
        creditRow.interest += row.amount;
      } else {
        creditRow.principal += row.amount;
      }
      creditRow.total += row.amount;
      creditRow.rowCount += row.rowCount;
      if (row.reportId > 0) {
        creditRow.reports.add(row.reportId);
      }
      creditRows.set(creditKey, creditRow);
      current.creditMap = creditRows;
    } else if (!isPromotionDeduction(reason) && reason !== groupReason) {
      current.detailsSet.add(reason);
    }

    groups.set(groupKey, current);
  }

  return [...groups.values()]
    .map((group) => {
      const details = [...group.detailsSet];
      if (group.docNumbers.size > 0) {
        details.unshift(`Документов WB: ${group.docNumbers.size}`);
      }
      const creditRows = group.creditMap
        ? [...group.creditMap.values()]
            .map((credit) => ({
              creditId: credit.creditId,
              creditDate: credit.creditDate,
              principal: credit.principal,
              interest: credit.interest,
              total: credit.total,
              rowCount: credit.rowCount,
              reportCount: credit.reports.size,
            }))
            .sort((a, b) => b.total - a.total || a.creditDate.localeCompare(b.creditDate))
        : undefined;

      return {
        reason: group.reason,
        amount: group.amount,
        amountExpense: group.amountExpense,
        amountExcluded: group.amountExcluded,
        rowCount: group.rowCount,
        reportCount: group.reports.size,
        skuCount: group.skus.size,
        details,
        creditRows,
      };
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function createMutableDeductionGroup(reason: string): MutableDeductionReasonGroup {
  return {
    reason,
    amount: 0,
    amountExpense: 0,
    amountExcluded: 0,
    rowCount: 0,
    reportCount: 0,
    skuCount: 0,
    reports: new Set<number>(),
    skus: new Set<number>(),
    docNumbers: new Set<string>(),
    detailsSet: new Set<string>(),
  };
}

function isPromotionDeduction(reason: string): boolean {
  return /WB\s*Продвижение|ВБ\s*Продвижение/i.test(reason);
}

function normalizeDeductionReason(reason: string): string {
  return reason
    .replace(/,\s*документ\s*№\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Без расшифровки в сохраненных данных';
}

function extractDocumentNumber(reason: string): string | null {
  const match = reason.match(/документ\s*№\s*(\d+)/i);
  return match?.[1] ?? null;
}

function parseCreditDeduction(reason: string): { creditId: string; creditDate: string; kind: 'principal' | 'interest' } | null {
  const match = reason.match(/кредит[ау]?\s+(\d+)\s+от\s+(\d{4}-\d{2}-\d{2})/i);
  if (!match) {
    return null;
  }
  return {
    creditId: match[1] ?? '',
    creditDate: match[2] ?? '',
    kind: /процент/i.test(reason) ? 'interest' : 'principal',
  };
}

function getExpenseSourceRows(
  key: ExpenseDetailKey,
  selectedValue: number,
  wbReferenceRows: [string, number][],
): ExpenseSourceRow[] {
  const labels = WB_SOURCE_LABELS[key] ?? [];
  const wbRows = labels
    .map((label) => {
      const found = wbReferenceRows.find(([source]) => source === label);
      return found ? { label: found[0], value: found[1] } : null;
    })
    .filter((row): row is ExpenseSourceRow => Boolean(row));

  if (wbRows.length > 0) {
    return wbRows;
  }

  const fallbackLabel: Partial<Record<ExpenseDetailKey, string>> = {
    cogs: 'economics.full_cost_with_shipment × выкупы',
    ads: 'WB ads spend за период',
    paidStorage: 'raw_api_paid_storage.storage_amount',
    tax: 'tax settings × база налога',
  };

  return [{ label: fallbackLabel[key] ?? 'Внутренний расчет дашборда', value: selectedValue }];
}

function getSkuExpenseValue(row: SkuExpenseRow, key: ExpenseDetailKey): number {
  switch (key) {
    case 'commission':
      return row.commission;
    case 'logistics':
      return row.logistics;
    case 'wbStorage':
      return row.wbStorageFee;
    case 'penalty':
      return row.penalty;
    case 'paymentSchedule':
      return row.paymentSchedule;
    case 'deduction':
      return row.deduction;
    case 'acquiring':
      return row.acquiringFee;
    case 'additionalPayment':
      return -row.additionalPayment;
    case 'provisionalTail':
      return row.provisionalOtherFees;
    case 'cogs':
      return row.cogs;
    case 'ads':
      return row.ads;
    case 'paidStorage':
      return row.paidStorage;
    case 'tax':
      return row.tax;
  }
}

function ExpenseSkuCell({ row, compact = false }: { row: SkuExpenseRow; compact?: boolean }) {
  const sizeClass = compact ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl';
  const subtitle = compact ? (row.vendorCode || row.brand) : row.brand;

  return (
    <div className="flex min-w-[170px] items-center gap-2">
      <div className={`shrink-0 overflow-hidden border border-border bg-muted ${sizeClass}`}>
        {row.photoUrl ? (
          <Image
            src={row.photoUrl}
            alt=""
            width={compact ? 32 : 40}
            height={compact ? 32 : 40}
            unoptimized
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-muted-foreground">
            SKU
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-xs font-black text-foreground">{row.nmId}</div>
        {subtitle ? (
          <div className="truncate text-[10px] font-semibold text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

function BreakdownStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-[var(--shadow-xs)] ${
      accent
        ? 'border-cyan-400/50 bg-cyan-500/10'
        : 'border-border bg-card'
    }`}>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-black tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function StockCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <div className="dashboard-card min-h-[118px] p-4">
      <p className="text-sm font-bold text-muted-foreground">{label}</p>
      <div className="mt-7 text-2xl font-black tracking-tight text-foreground">
        {Math.round(value).toLocaleString('ru-RU')} шт.
      </div>
      <p className="mt-3 text-xs font-semibold text-muted-foreground">{caption}</p>
    </div>
  );
}
