'use client';

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  TrendingUp, TrendingDown, RussianRuble, ClipboardList,
  Percent, ShieldAlert, Target, Eye, ShoppingBag, Boxes, Warehouse, Megaphone, TicketPercent, CircleHelp, WalletCards, GripVertical, RotateCcw, SlidersHorizontal, Check, ExternalLink, type LucideIcon
} from 'lucide-react';
import { dispatchOpenExpenseBreakdown, dispatchOpenKpiDrilldown, type KpiDrilldownMetric } from './expenseBreakdownEvents';

export type DashboardMetricKey =
  | 'revenue'
  | 'profit'
  | 'orderSum'
  | 'orders'
  | 'buyouts'
  | 'grossMargin'
  | 'margin'
  | 'storage'
  | 'conversion'
  | 'impressions'
  | 'ads'
  | 'localization'
  | 'stocks'
  | 'spp';

type KpiMetric = {
  value: number;
  delta: number;
};

type KpiSet = {
  revenue: KpiMetric;
  realizedRevenue?: KpiMetric;
  cogs?: KpiMetric;
  revenueSource?: 'finance' | 'hybrid_daily_sales' | 'hybrid_funnel';
  revenueProvisionalDays?: number;
  profit: KpiMetric;
  profitSource?: 'finance' | 'hybrid_daily_sales' | 'hybrid_funnel_estimated';
  profitProvisionalDays?: number;
  orderSum?: KpiMetric;
  orderSumAvailable?: boolean;
  orderSumSource?: 'exact_funnel' | 'raw_orders' | 'none';
  orders: KpiMetric;
  buyouts?: KpiMetric;
  buyoutSum?: KpiMetric;
  buyoutSumAvailable?: boolean;
  buyoutSumSource?: 'exact_funnel' | 'finance' | 'hybrid_daily_sales' | 'hybrid_funnel' | 'none';
  buyoutsSource?: 'exact_funnel' | 'finance' | 'hybrid_daily_sales' | 'hybrid_funnel';
  buyoutsProvisionalDays?: number;
  buyoutRate?: KpiMetric;
  buyoutRateAvailable?: boolean;
  ordersAvailable?: boolean;
  ordersSource?: 'exact_funnel' | 'raw_orders' | 'none';
  grossMargin?: KpiMetric;
  margin: KpiMetric;
  storage?: KpiMetric;
  storageSource?: 'finance' | 'paid_storage' | 'hybrid_paid_storage';
  storageProvisionalDays?: number;
  storageShare?: KpiMetric;
  storageOperational?: KpiMetric;
  storageOperationalShare?: KpiMetric;
  logistics?: KpiMetric;
  logisticsShare?: KpiMetric;
  ads?: KpiMetric;
  adsDrrSource?: 'wb_attributed' | 'revenue_proxy' | 'clusters_proxy';
  adsCpo?: KpiMetric;
  adsCpoAvailable?: boolean;
  acos?: KpiMetric;
  profitPerBuyout?: KpiMetric;
  profitPerBuyoutAvailable?: boolean;
  stocks?: KpiMetric;
  stocksInWayToClient?: KpiMetric;
  stocksInWayFromClient?: KpiMetric;
  stocksAvailable?: boolean;
  stockDays?: KpiMetric;
  stockTurnoverDays?: KpiMetric;
  stockAnalyticsAvailable?: boolean;
  lostOrders?: KpiMetric;
  lostOrdersSum?: KpiMetric;
  localization?: KpiMetric;
  localizationAvailable?: boolean;
  spp?: KpiMetric;
  sppAvailable?: boolean;
  sppSource?: 'finance' | 'prices_snapshot' | 'none';
  sppMode?: 'day' | 'avg';
  avgCheck?: KpiMetric;
  avgCheckAvailable?: boolean;
  avgCheckSource?: 'exact_funnel' | 'raw_orders' | 'none';
  conversion?: KpiMetric;
  conversionAvailable?: boolean;
  impressions?: KpiMetric;
  impressionsAvailable?: boolean;
  ctr?: KpiMetric;
  ctrAvailable?: boolean;
  toplineSource?: 'exact_funnel' | 'finance_only';
};

type KpiCard = {
  key: DashboardMetricKey | 'expenses' | 'roi' | 'risk' | 'impressions';
  title: string;
  subtitle?: string;
  quality?: {
    label: string;
    title: string;
    tone: 'exact' | 'provisional' | 'proxy' | 'snapshot' | 'missing';
  };
  primaryLabel?: string;
  value: string;
  secondaryLabel?: string;
  secondaryValue?: string;
  tertiaryLabel?: string;
  tertiaryValue?: string;
  badge?: string;
  icon: LucideIcon;
  trend: string;
  tone: 'positive' | 'negative' | 'neutral';
  color: string;
  shadow: string;
};

type KpiInput = Partial<KpiSet> & Record<string, unknown>;
export type KpiCardsLayout = 'priority' | 'compact' | 'matrix' | 'dense';
type KpiCardKey = KpiCard['key'];
type DragPreviewState = {
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};
const KPI_ORDER_STORAGE_KEY = 'enterprise-wb-analytics:overview:kpi-order:v1';
const KPI_VISIBILITY_STORAGE_KEY = 'enterprise-wb-analytics:overview:kpi-hidden:v1';

const SELECTABLE_METRIC_KEYS = new Set<KpiCardKey>([
  'revenue',
  'profit',
  'orderSum',
  'orders',
  'buyouts',
  'grossMargin',
  'margin',
  'storage',
  'conversion',
  'impressions',
  'ads',
  'localization',
  'stocks',
  'spp',
]);

const KPI_CALCULATIONS: Record<KpiCardKey, {
  formula: string;
  source: string;
  cadence: string;
  note: string;
}> = {
  revenue: {
    formula: 'Выручка — деньги за выкупленные товары. Чистая прибыль — сколько осталось после WB, себестоимости, рекламы и налога.',
    source: 'Берём из финальных отчётов WB. Если последние дни ещё не готовы, добавляем предварительные продажи.',
    cadence: 'Обновляется после синхронизации WB. Свежесть данных показана в строке статуса сверху.',
    note: 'Заказ ещё не равен деньгам. Деньги появляются после выкупа.',
  },
  profit: {
    formula: 'Чистая прибыль = сумма к выплате от WB − себестоимость − реклама − налог.',
    source: 'Сумму к выплате берём из отчёта WB. Если WB её не отдал, считаем от цены продавца после скидки продавца.',
    cadence: 'Пересчитывается после синхронизации WB и при смене периода.',
    note: 'Это главная цифра: показывает, сколько реально заработали.',
  },
  expenses: {
    formula: 'Расходы и удержания = выручка − чистая прибыль. ROI по чистой прибыли = чистая прибыль / расходы × 100%.',
    source: 'Внутри расходов: комиссии и логистика WB, себестоимость, реклама, хранение, налог и удержания.',
    cadence: 'Пересчитывается после синхронизации WB и при смене периода.',
    note: 'ROI показывает, сколько чистой прибыли принёс каждый рубль расходов.',
  },
  roi: {
    formula: 'ROI = чистая прибыль / все расходы × 100%. Например, 12,9% — это 12,90 ₽ прибыли на 100 ₽ расходов.',
    source: 'Считаем из двух уже проверенных цифр: чистая прибыль и все расходы.',
    cadence: 'Пересчитывается после синхронизации WB и при смене периода.',
    note: 'Чем выше ROI, тем эффективнее потрачены деньги.',
  },
  orderSum: {
    formula: 'Сумма заказов — на сколько рублей покупатели оформили заказы за период.',
    source: 'Берём из воронки WB. Если её нет, берём из сырых заказов WB.',
    cadence: 'Обновляется после синхронизации заказов и воронки WB.',
    note: 'Это ещё не выручка: заказ могут отменить или не выкупить.',
  },
  orders: {
    formula: 'Заказано — сколько штук оформили покупатели. Сумма заказов — на сколько рублей оформили. Средний чек = сумма заказов / заказы.',
    source: 'Берём из воронки WB. Если её нет, берём из сырых заказов WB.',
    cadence: 'Обновляется после синхронизации WB.',
    note: 'Заказы нужны для спроса, но прибыль они не показывают: важно смотреть выкупы.',
  },
  buyouts: {
    formula: 'Выкуплено — сколько товаров покупатели реально забрали. Сумма выкупов — на сколько рублей забрали. Прибыль на 1 выкуп = чистая прибыль / выкупы.',
    source: 'Штуки, сумму выкупов, отмены и процент берём из точной воронки WB, когда она доступна.',
    cadence: 'Обновляется после синхронизации WB. Последние дни могут быть предварительными.',
    note: 'Свежие дни могут меняться: часть заказов ещё не закрыта выкупом или отказом.',
  },
  grossMargin: {
    formula: 'Маржинальность = прибыль после комиссий WB, логистики, себестоимости и рекламы, но до налога / выручка × 100. Чистая рентабельность = чистая прибыль после налога / выручка × 100.',
    source: 'Финансовый контур WB, себестоимость, реклама и налог.',
    cadence: 'Пересчитывается на выбранный период.',
    note: 'Обе строки считаются от выручки. ROI отдельно считает прибыль относительно всех расходов.',
  },
  margin: {
    formula: 'Чистая прибыль после рекламы и налога / выручка × 100.',
    source: 'Финансовый контур, расходы, себестоимость.',
    cadence: 'Пересчитывается на выбранный период.',
    note: 'Главная доля эффективности: оборот без этой метрики легко вводит в заблуждение.',
  },
  storage: {
    formula: 'Расходы хранения WB и их доля в выручке.',
    source: 'Отчёт WB paid_storage с датой, складом и nmId; finance используется только как fallback.',
    cadence: 'Обновляется после sync финансов и storage.',
    note: 'Рост доли хранения обычно связан с мёртвым стоком или слабой оборачиваемостью.',
  },
  conversion: {
    formula: 'Просмотр → заказ = сколько заказов получилось из просмотров карточек: заказы / просмотры × 100%. Локализация = какая доля остатков лежит ближе к регионам спроса.',
    source: 'Просмотры и заказы берём из WB Analytics funnel. Локализацию считаем сами по остаткам, складам и спросу.',
    cadence: 'Воронка обновляется после sync WB. Локализация обновляется после пересчёта распределения остатков.',
    note: 'Это не процент выкупа. Здесь мы смотрим, насколько карточки превращают просмотры в заказы.',
  },
  impressions: {
    formula: 'Показы — сколько раз карточки показались в поиске и каталоге WB. CTR = переходы в карточку / показы × 100%.',
    source: 'Внутренняя дневная воронка ЛК WB (sales-funnel) на уровне кабинета.',
    cadence: 'Обновляется после синхронизации воронки ЛК WB.',
    note: 'Показы и CTR считаются на весь кабинет, без разбивки по группе товаров.',
  },
  ads: {
    formula: 'Расход рекламы — сколько списала реклама WB. ДРР = расход / рекламная сумма заказов × 100%. CPO = расход / рекламные заказы.',
    source: 'WB Ads fullstats + связка с продажами.',
    cadence: 'Реклама синхронизируется отдельными лимитированными окнами.',
    note: 'Proxy означает, что точной атрибуции WB не хватило и использован безопасный fallback.',
  },
  localization: {
    formula: 'Показывает, какая доля остатков лежит ближе к тем регионам, где товар чаще покупают. Это последний пересчёт до конца выбранного периода.',
    source: 'Наш route-scan: остатки WB, склады, размеры и спрос по регионам.',
    cadence: 'Обновляется после пересчета распределения остатков.',
    note: 'Это оценка размещения товара, а не ежедневный показатель из отчета WB.',
  },
  stocks: {
    formula: 'На складе — остаток WB в последнем snapshot. Потерянные заказы — сколько заказов WB оценил как упущенные из-за остатков. Запас в днях — на сколько дней хватит товара.',
    source: 'WB stock snapshot + WB stock analytics report.',
    cadence: 'Показывает последний доступный snapshot, не сумму за период.',
    note: 'Это оперативная картина остатков: выбранный период влияет на другие KPI, а остатки показывают последний срез.',
  },
  spp: {
    formula: 'Средневзвешенно за выбранный период: сумма SPP ₽ ÷ сумма цен продавца после скидки продавца × 100.',
    source: 'Финальный отчет WB по продажам: SPP ₽ и цена до скидки WB.',
    cadence: 'Обновляется после финансового sync.',
    note: 'Это не текущий SPP товара. Вчера могло быть 43%, сегодня 35%; карточка усредняет выбранный период.',
  },
  risk: {
    formula: 'Сумма потенциально потерянной прибыли по активным критическим сигналам.',
    source: 'Risk signals engine.',
    cadence: 'Пересчитывается сервером при обновлении сигналов.',
    note: 'Используется как приоритет для owner queue.',
  },
};

export function KPICards({
  kpi,
  profitAtRisk = 0,
  selectedMetric,
  onSelectMetric,
  layout = 'priority',
}: {
  kpi: KpiInput;
  profitAtRisk?: number;
  selectedMetric?: DashboardMetricKey;
  onSelectMetric?: (metric: DashboardMetricKey) => void;
  layout?: KpiCardsLayout;
}) {
  const [cardOrder, setCardOrder] = useState<KpiCardKey[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const savedOrder = window.localStorage.getItem(KPI_ORDER_STORAGE_KEY);
      if (!savedOrder) {
        return [];
      }

      const parsed = JSON.parse(savedOrder);
      return Array.isArray(parsed)
        ? parsed.filter((key): key is KpiCardKey => typeof key === 'string')
        : [];
    } catch {
      return [];
    }
  });
  const [draggedKey, setDraggedKey] = useState<KpiCardKey | null>(null);
  const [dragOverKey, setDragOverKey] = useState<KpiCardKey | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [hiddenCardKeys, setHiddenCardKeys] = useState<KpiCardKey[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const savedHidden = window.localStorage.getItem(KPI_VISIBILITY_STORAGE_KEY);
      if (!savedHidden) {
        return [];
      }

      const parsed = JSON.parse(savedHidden);
      return Array.isArray(parsed)
        ? parsed.filter((key): key is KpiCardKey => typeof key === 'string')
        : [];
    } catch {
      return [];
    }
  });
  const [metricsMenuOpen, setMetricsMenuOpen] = useState(false);
  const metricsMenuRef = useRef<HTMLDivElement>(null);

  const formatCurrency = (val: number) => `${Math.round(val).toLocaleString('ru-RU')} ₽`;
  const formatDelta = (val: number) => {
    if (isNaN(val)) return '0%';
    return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
  };
  const formatPointDelta = (val: number) => {
    if (isNaN(val)) return '0.0 п.п.';
    return `${val > 0 ? '+' : ''}${val.toFixed(1)} п.п.`;
  };
  const calcDelta = (curr: number, prev: number) => {
    if (!Number.isFinite(curr) || !Number.isFinite(prev)) return 0;
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  const previousFromDelta = (current: number, delta: number) => {
    if (!Number.isFinite(current) || !Number.isFinite(delta)) return 0;
    const ratio = 1 + delta / 100;
    return Math.abs(ratio) < 0.0001 ? 0 : current / ratio;
  };

  const getMetric = (metric?: KpiMetric): KpiMetric => metric ?? { value: 0, delta: 0 };
  const revenue = getMetric(kpi.revenue);
  const revenueProvisionalDaysRaw = Number((kpi as { revenueProvisionalDays?: unknown }).revenueProvisionalDays ?? 0);
  const revenueProvisionalDays = Number.isFinite(revenueProvisionalDaysRaw) && revenueProvisionalDaysRaw > 0
    ? Math.floor(revenueProvisionalDaysRaw)
    : 0;
  const revenueSource = (kpi as { revenueSource?: KpiSet['revenueSource'] }).revenueSource ?? 'finance';
  const profit = getMetric(kpi.profit);
  const realizedRevenue = getMetric(kpi.realizedRevenue);
  const cogs = getMetric(kpi.cogs);
  const profitProvisionalDaysRaw = Number((kpi as { profitProvisionalDays?: unknown }).profitProvisionalDays ?? 0);
  const profitProvisionalDays = Number.isFinite(profitProvisionalDaysRaw) && profitProvisionalDaysRaw > 0
    ? Math.floor(profitProvisionalDaysRaw)
    : 0;
  const profitSource = (kpi as { profitSource?: KpiSet['profitSource'] }).profitSource ?? 'finance';
  const orderSum = getMetric(kpi.orderSum);
  const orderSumAvailable = typeof (kpi as { orderSumAvailable?: unknown }).orderSumAvailable === 'boolean'
    ? Boolean((kpi as { orderSumAvailable?: boolean }).orderSumAvailable)
    : false;
  const orderSumSource = (kpi as { orderSumSource?: KpiSet['orderSumSource'] }).orderSumSource ?? 'none';
  const avgCheck = getMetric(kpi.avgCheck);
  const avgCheckAvailable = typeof (kpi as { avgCheckAvailable?: unknown }).avgCheckAvailable === 'boolean'
    ? Boolean((kpi as { avgCheckAvailable?: boolean }).avgCheckAvailable)
    : false;
  const orders = getMetric(kpi.orders);
  const buyouts = getMetric(kpi.buyouts);
  const buyoutSum = getMetric(kpi.buyoutSum);
  const buyoutSumAvailable = typeof (kpi as { buyoutSumAvailable?: unknown }).buyoutSumAvailable === 'boolean'
    ? Boolean((kpi as { buyoutSumAvailable?: boolean }).buyoutSumAvailable)
    : false;
  const buyoutsProvisionalDaysRaw = Number((kpi as { buyoutsProvisionalDays?: unknown }).buyoutsProvisionalDays ?? 0);
  const buyoutsProvisionalDays = Number.isFinite(buyoutsProvisionalDaysRaw) && buyoutsProvisionalDaysRaw > 0
    ? Math.floor(buyoutsProvisionalDaysRaw)
    : 0;
  const buyoutsSource = (kpi as { buyoutsSource?: KpiSet['buyoutsSource'] }).buyoutsSource ?? 'finance';
  const buyoutRate = getMetric(kpi.buyoutRate);
  const buyoutRateAvailable = typeof (kpi as { buyoutRateAvailable?: unknown }).buyoutRateAvailable === 'boolean'
    ? Boolean((kpi as { buyoutRateAvailable?: boolean }).buyoutRateAvailable)
    : false;
  const ordersAvailable = typeof (kpi as { ordersAvailable?: unknown }).ordersAvailable === 'boolean'
    ? Boolean((kpi as { ordersAvailable?: boolean }).ordersAvailable)
    : true;
  const ordersSource = (kpi as { ordersSource?: KpiSet['ordersSource'] }).ordersSource ?? 'none';
  const grossMargin = getMetric(kpi.grossMargin);
  const margin = getMetric(kpi.margin);
  const profitPerBuyout = getMetric(kpi.profitPerBuyout);
  const profitPerBuyoutAvailable = typeof (kpi as { profitPerBuyoutAvailable?: unknown }).profitPerBuyoutAvailable === 'boolean'
    ? Boolean((kpi as { profitPerBuyoutAvailable?: boolean }).profitPerBuyoutAvailable)
    : false;
  const storage = getMetric(kpi.storage);
  const storageProvisionalDaysRaw = Number((kpi as { storageProvisionalDays?: unknown }).storageProvisionalDays ?? 0);
  const storageProvisionalDays = Number.isFinite(storageProvisionalDaysRaw) && storageProvisionalDaysRaw > 0
    ? Math.floor(storageProvisionalDaysRaw)
    : 0;
  const storageSource = (kpi as { storageSource?: KpiSet['storageSource'] }).storageSource ?? 'finance';
  const storageShare = getMetric(kpi.storageShare);
  const logistics = getMetric(kpi.logistics);
  const ads = getMetric(kpi.ads);
  const adsDrrSource = (kpi as { adsDrrSource?: KpiSet['adsDrrSource'] }).adsDrrSource ?? 'revenue_proxy';
  const adsCpo = getMetric(kpi.adsCpo);
  const adsCpoAvailable = typeof (kpi as { adsCpoAvailable?: unknown }).adsCpoAvailable === 'boolean'
    ? Boolean((kpi as { adsCpoAvailable?: boolean }).adsCpoAvailable)
    : false;
  const acos = getMetric(kpi.acos);
  const stocks = getMetric(kpi.stocks);
  const stocksAvailable = typeof (kpi as { stocksAvailable?: unknown }).stocksAvailable === 'boolean'
    ? Boolean((kpi as { stocksAvailable?: boolean }).stocksAvailable)
    : false;
  const stockDays = getMetric(kpi.stockDays);
  const stockTurnoverDays = getMetric(kpi.stockTurnoverDays);
  const stockAnalyticsAvailable = typeof (kpi as { stockAnalyticsAvailable?: unknown }).stockAnalyticsAvailable === 'boolean'
    ? Boolean((kpi as { stockAnalyticsAvailable?: boolean }).stockAnalyticsAvailable)
    : false;
  const lostOrders = getMetric(kpi.lostOrders);
  const lostOrdersSum = getMetric(kpi.lostOrdersSum);
  const localization = getMetric(kpi.localization);
  const localizationAvailable = typeof (kpi as { localizationAvailable?: unknown }).localizationAvailable === 'boolean'
    ? Boolean((kpi as { localizationAvailable?: boolean }).localizationAvailable)
    : false;
  const spp = getMetric(kpi.spp);
  const sppAvailable = typeof (kpi as { sppAvailable?: unknown }).sppAvailable === 'boolean'
    ? Boolean((kpi as { sppAvailable?: boolean }).sppAvailable)
    : false;
  const sppSource = (kpi as { sppSource?: KpiSet['sppSource'] }).sppSource ?? 'none';
  const sppMode = (kpi as { sppMode?: KpiSet['sppMode'] }).sppMode ?? 'avg';
  const conversion = getMetric(kpi.conversion);
  const conversionAvailable = typeof (kpi as { conversionAvailable?: unknown }).conversionAvailable === 'boolean'
    ? Boolean((kpi as { conversionAvailable?: boolean }).conversionAvailable)
    : true;
  const impressions = getMetric(kpi.impressions);
  const impressionsAvailable = typeof (kpi as { impressionsAvailable?: unknown }).impressionsAvailable === 'boolean'
    ? Boolean((kpi as { impressionsAvailable?: boolean }).impressionsAvailable)
    : false;
  const ctr = getMetric(kpi.ctr);
  const ctrAvailable = typeof (kpi as { ctrAvailable?: unknown }).ctrAvailable === 'boolean'
    ? Boolean((kpi as { ctrAvailable?: boolean }).ctrAvailable)
    : false;
  const lostOrdersLabel = stockAnalyticsAvailable
    ? `${Math.round(lostOrders.value).toLocaleString('ru-RU')} шт / ${formatCurrency(lostOrdersSum.value)}`
    : 'н/д';
  const stockDaysLabel = stockAnalyticsAvailable
    ? `${stockDays.value.toFixed(1)} дн. / ${stockTurnoverDays.value.toFixed(1)} дн.`
    : 'н/д';
  const marginProvisionalDays = Math.max(revenueProvisionalDays, profitProvisionalDays);
  // Расходы = реализация после СПП − прибыль (СПП финансирует WB). ROI = прибыль / себестоимость.
  const totalExpenses = Math.max(realizedRevenue.value - profit.value, ads.value + storage.value + logistics.value, 0);
  const previousRealizedRevenue = previousFromDelta(realizedRevenue.value, realizedRevenue.delta);
  const previousProfit = previousFromDelta(profit.value, profit.delta);
  const previousExpenses = Math.max(previousRealizedRevenue - previousProfit, 0);
  const totalExpensesDelta = calcDelta(totalExpenses, previousExpenses);
  const roi = cogs.value > 0 ? (profit.value / cogs.value) * 100 : 0;
  const financeProvisionalDays = Math.max(revenueProvisionalDays, profitProvisionalDays);
  const quality = (
    label: string,
    tone: NonNullable<KpiCard['quality']>['tone'],
    title: string,
  ): NonNullable<KpiCard['quality']> => ({ label, tone, title });
  const financeQuality = financeProvisionalDays > 0 || revenueSource !== 'finance' || profitSource !== 'finance'
    ? quality('предв.', 'provisional', 'Есть предварительные дни: WB ещё может пересчитать финальные отчёты.')
    : quality('финал WB', 'exact', 'Финальные финансовые отчёты WB без предварительного хвоста.');
  const ordersQuality = ordersSource === 'exact_funnel'
    ? quality('точно WB', 'exact', 'Точная воронка WB за выбранный период.')
    : ordersSource === 'raw_orders' || orderSumSource === 'raw_orders'
      ? quality('raw WB', 'provisional', 'Нет точного snapshot воронки, используем сырые заказы WB.')
      : quality('нет данных', 'missing', 'Нет данных WB для этой метрики в выбранном периоде.');
  const buyoutsQuality = buyoutsSource === 'exact_funnel'
    ? quality('точно WB', 'exact', 'Точная воронка WB: выкупы, сумма и процент выкупа.')
    : buyoutsProvisionalDays > 0 || buyoutsSource.startsWith('hybrid')
      ? quality('предв.', 'provisional', 'Часть выкупов собрана предварительно до финального отчёта WB.')
      : quality('финал WB', 'exact', 'Выкупы взяты из финансового контура WB.');
  const adsQuality = adsDrrSource === 'wb_attributed'
    ? quality('точно WB', 'exact', 'ДРР считается от атрибутированной суммы заказов WB Ads.')
    : quality('proxy', 'proxy', 'WB не дал точную атрибуцию для ДРР, поэтому используется расчёт через выручку или кластеры.');
  const storageQuality = storageSource === 'hybrid_paid_storage'
    ? quality('предв.', 'provisional', 'Финальное хранение WB дополнено оперативным paid-storage контуром.')
    : storageSource === 'paid_storage'
      ? quality('paid storage', 'exact', 'Хранение взято из SKU-атрибутированного отчёта WB paid_storage.')
      : quality('финал WB', 'exact', 'Хранение взято из финансовых отчётов WB как fallback.');
  const stocksQuality = stocksAvailable
    ? quality('срез WB', 'snapshot', 'Остатки показывают последний snapshot WB, а не сумму за период.')
    : quality('нет данных', 'missing', 'Нет свежего snapshot остатков WB.');
  const conversionQuality = conversionAvailable
    ? quality('точно WB', 'exact', 'Конверсия рассчитана по точному snapshot воронки WB.')
    : quality('нет данных', 'missing', 'Для выбранного периода нет точной воронки WB.');
  const impressionsQuality = impressionsAvailable
    ? quality('ЛК WB', 'exact', 'Показы и CTR из дневной воронки ЛК WB (на уровне кабинета).')
    : quality('нет данных', 'missing', 'Нет показов: воронка ЛК WB не подключена или выбран фильтр по группе товаров.');
  const sppQuality = sppSource === 'finance'
    ? quality('финал WB', 'exact', 'SPP рассчитан по финальным финансовым строкам WB за период.')
    : sppSource === 'prices_snapshot'
      ? quality('срез WB', 'snapshot', 'SPP рассчитан по текущему snapshot цен WB.')
      : quality('нет данных', 'missing', 'Нет данных WB для SPP в выбранном периоде.');

  const cards: KpiCard[] = [
    {
      key: 'revenue',
      title: 'Финансы',
      subtitle: financeProvisionalDays > 0 ? `Предв.: ${financeProvisionalDays} дн.` : undefined,
      quality: financeQuality,
      primaryLabel: 'Выручка',
      value: formatCurrency(revenue.value),
      secondaryLabel: 'Чистая прибыль',
      secondaryValue: formatCurrency(profit.value),
      icon: RussianRuble,
      trend: formatDelta(revenue.delta),
      tone: revenue.delta >= 0 ? 'positive' : 'negative',
      color: 'bg-emerald-500',
      shadow: 'hover:shadow-emerald-200'
    },
    {
      key: 'expenses',
      title: 'Расходы и удержания',
      subtitle: 'выручка − чистая прибыль',
      quality: financeQuality,
      primaryLabel: 'Расходы и удержания',
      value: formatCurrency(totalExpenses),
      secondaryLabel: 'ROI по чистой прибыли',
      secondaryValue: `${roi.toFixed(1)}%`,
      icon: WalletCards,
      trend: formatDelta(totalExpensesDelta),
      tone: totalExpensesDelta <= 0 ? 'positive' : 'negative',
      color: 'bg-slate-500',
      shadow: 'hover:shadow-slate-200'
    },
    {
      key: 'grossMargin',
      title: 'Маржа',
      subtitle: 'до налога / после налога',
      quality: financeQuality,
      primaryLabel: 'Маржинальность',
      value: `${grossMargin.value.toFixed(1)}%`,
      secondaryLabel: 'Чистая рентабельность',
      secondaryValue: `${margin.value.toFixed(1)}%`,
      badge: marginProvisionalDays > 0 ? `Предв.: ${marginProvisionalDays} дн.` : undefined,
      icon: Percent,
      trend: formatPointDelta(grossMargin.delta),
      tone: grossMargin.delta >= 0 ? 'positive' : 'negative',
      color: 'bg-amber-500',
      shadow: 'hover:shadow-amber-200'
    },
    {
      key: 'orders',
      title: 'Заказы',
      quality: ordersQuality,
      primaryLabel: 'Заказано',
      value: ordersAvailable ? `${orders.value.toLocaleString('ru-RU')} шт` : 'н/д',
      secondaryLabel: 'Сумма заказов',
      secondaryValue: orderSumAvailable ? formatCurrency(orderSum.value) : 'н/д',
      tertiaryLabel: 'Средний чек',
      tertiaryValue: avgCheckAvailable ? formatCurrency(avgCheck.value) : 'н/д',
      icon: ClipboardList,
      trend: ordersAvailable ? formatDelta(orders.delta) : 'нет данных',
      tone: ordersAvailable ? (orders.delta >= 0 ? 'positive' : 'negative') : 'neutral',
      color: 'bg-violet-500',
      shadow: 'hover:shadow-violet-200'
    },
    {
      key: 'buyouts',
      title: 'Выкупы',
      subtitle: buyoutRateAvailable ? `Выкуп: ${buyoutRate.value.toFixed(1)}%` : 'Выкуп: н/д',
      quality: buyoutsQuality,
      primaryLabel: 'Выкуплено',
      value: `${buyouts.value.toLocaleString('ru-RU')} шт`,
      secondaryLabel: 'Сумма выкупов',
      secondaryValue: buyoutSumAvailable ? formatCurrency(buyoutSum.value) : 'н/д',
      tertiaryLabel: 'Прибыль на 1 выкуп',
      tertiaryValue: profitPerBuyoutAvailable ? formatCurrency(profitPerBuyout.value) : 'н/д',
      badge: buyoutsProvisionalDays > 0 ? `Предв.: ${buyoutsProvisionalDays} дн.` : undefined,
      icon: ShoppingBag,
      trend: buyoutRateAvailable ? formatPointDelta(buyoutRate.delta) : 'нет данных',
      tone: buyoutRateAvailable ? (buyoutRate.delta >= 0 ? 'positive' : 'negative') : 'neutral',
      color: 'bg-cyan-500',
      shadow: 'hover:shadow-cyan-200'
    },
    {
      key: 'ads',
      title: 'Реклама',
      subtitle: adsDrrSource === 'wb_attributed' ? 'ДРР' : 'proxy',
      quality: adsQuality,
      primaryLabel: 'Расход рекламы',
      value: formatCurrency(ads.value),
      secondaryLabel: adsDrrSource === 'wb_attributed' ? 'ДРР' : 'Доля выручки',
      secondaryValue: `${acos.value.toFixed(1)}%`,
      tertiaryLabel: 'CPO',
      tertiaryValue: adsCpoAvailable ? formatCurrency(adsCpo.value) : 'н/д',
      icon: Megaphone,
      trend: formatDelta(acos.delta),
      tone: acos.delta <= 0 ? 'positive' : 'negative',
      color: 'bg-indigo-500',
      shadow: 'hover:shadow-indigo-200'
    },
    {
      key: 'storage',
      title: 'Хранение',
      subtitle: storageProvisionalDays > 0 ? `Предв.: ${storageProvisionalDays} дн.` : undefined,
      quality: storageQuality,
      primaryLabel: 'Расход хранения',
      value: formatCurrency(storage.value),
      secondaryLabel: 'Доля выручки',
      secondaryValue: `${storageShare.value.toFixed(1)}%`,
      icon: Warehouse,
      trend: formatPointDelta(storageShare.delta),
      tone: storageShare.delta <= 0 ? 'positive' : 'negative',
      color: 'bg-teal-500',
      shadow: 'hover:shadow-teal-200'
    },
    {
      key: 'stocks',
      title: 'Остатки WB',
      quality: stocksQuality,
      primaryLabel: 'На складе',
      value: stocksAvailable ? Math.round(stocks.value).toLocaleString('ru-RU') : 'н/д',
      secondaryLabel: 'Потерянные заказы',
      secondaryValue: lostOrdersLabel,
      tertiaryLabel: 'Запас / оборот',
      tertiaryValue: stockDaysLabel,
      icon: Boxes,
      trend: stocksAvailable ? 'snapshot' : 'нет данных',
      tone: 'neutral',
      color: 'bg-sky-500',
      shadow: 'hover:shadow-sky-200'
    },
    {
      key: 'conversion',
      title: 'Воронка',
      quality: conversionQuality,
      primaryLabel: 'Просмотр → заказ',
      value: conversionAvailable ? `${conversion.value.toFixed(1)}%` : 'н/д',
      secondaryLabel: 'Локализация, наша оценка',
      secondaryValue: localizationAvailable ? `${localization.value.toFixed(1)}%` : 'н/д',
      icon: Target,
      trend: conversionAvailable ? formatPointDelta(conversion.delta) : 'нет данных',
      tone: conversionAvailable ? (conversion.delta >= 0 ? 'positive' : 'negative') : 'neutral',
      color: 'bg-rose-500',
      shadow: 'hover:shadow-rose-200'
    },
    {
      key: 'impressions',
      title: 'Показы / CTR',
      subtitle: 'воронка ЛК WB, весь кабинет',
      quality: impressionsQuality,
      primaryLabel: 'Показы',
      value: impressionsAvailable ? Math.round(impressions.value).toLocaleString('ru-RU') : 'н/д',
      secondaryLabel: 'CTR (показ → переход)',
      secondaryValue: ctrAvailable ? `${ctr.value.toFixed(2)}%` : 'н/д',
      icon: Eye,
      trend: impressionsAvailable ? formatDelta(impressions.delta) : 'нет данных',
      tone: impressionsAvailable ? (impressions.delta >= 0 ? 'positive' : 'negative') : 'neutral',
      color: 'bg-indigo-500',
      shadow: 'hover:shadow-indigo-200'
    },
    {
      key: 'spp',
      title: sppSource === 'prices_snapshot'
        ? 'SPP WB (сейчас)'
        : (sppMode === 'day' ? 'SPP WB (за день)' : 'SPP WB (сред. за период)'),
      subtitle: 'средневзвешенная скидка WB',
      quality: sppQuality,
      value: sppAvailable ? `${spp.value.toFixed(1)}%` : 'н/д',
      icon: TicketPercent,
      trend: sppAvailable
        ? (sppSource === 'prices_snapshot' ? 'snapshot' : formatPointDelta(spp.delta))
        : 'нет реализаций',
      tone: sppAvailable ? (spp.delta <= 0 ? 'positive' : 'negative') : 'neutral',
      color: 'bg-purple-500',
      shadow: 'hover:shadow-purple-200'
    }
  ];

  if (profitAtRisk > 0) {
    cards.push({
      key: 'risk',
      title: 'Риск / Упущенная выгода',
      value: formatCurrency(profitAtRisk),
      icon: ShieldAlert,
      trend: 'Критично',
      tone: 'negative',
      color: 'bg-rose-600',
      shadow: 'hover:shadow-rose-300'
    });
  }

  const cardByKey = new Map(cards.map((card) => [card.key, card]));
  const savedKeys = cardOrder.filter((key) => cardByKey.has(key));
  const missingKeys = cards.map((card) => card.key).filter((key) => !savedKeys.includes(key));
  const orderedCards = [...savedKeys, ...missingKeys]
    .map((key) => cardByKey.get(key))
    .filter((card): card is KpiCard => Boolean(card));
  const hiddenKeySet = new Set(hiddenCardKeys.filter((key) => cardByKey.has(key)));
  const visibleCards = orderedCards.filter((card) => !hiddenKeySet.has(card.key));
  const draggedCard = draggedKey ? cardByKey.get(draggedKey) : null;
  const visibleCount = visibleCards.length;

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

  const persistOrder = (nextOrder: KpiCardKey[]) => {
    setCardOrder(nextOrder);
    window.localStorage.setItem(KPI_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
  };

  const resetOrder = () => {
    setCardOrder([]);
    window.localStorage.removeItem(KPI_ORDER_STORAGE_KEY);
  };

  const persistHiddenCards = (nextHiddenKeys: KpiCardKey[]) => {
    setHiddenCardKeys(nextHiddenKeys);
    window.localStorage.setItem(KPI_VISIBILITY_STORAGE_KEY, JSON.stringify(nextHiddenKeys));
  };

  const toggleCardVisibility = (key: KpiCardKey) => {
    const isHidden = hiddenKeySet.has(key);
    if (!isHidden && visibleCount <= 1) {
      return;
    }

    const nextHiddenKeys = isHidden
      ? hiddenCardKeys.filter((item) => item !== key)
      : [...hiddenCardKeys.filter((item) => cardByKey.has(item)), key];

    persistHiddenCards(nextHiddenKeys);
  };

  const resetVisibility = () => {
    setHiddenCardKeys([]);
    window.localStorage.removeItem(KPI_VISIBILITY_STORAGE_KEY);
  };

  const moveCard = (fromKey: KpiCardKey, toKey: KpiCardKey) => {
    if (fromKey === toKey) {
      return;
    }

    const nextOrder = orderedCards.map((card) => card.key);
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

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetKey: KpiCardKey) => {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData('text/plain') as KpiCardKey;
    if (sourceKey) {
      moveCard(sourceKey, targetKey);
    }
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

  const trendToneClass = {
    positive: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    negative: 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300',
    neutral: 'border-border bg-subtle text-muted-foreground',
  } as const;
  const qualityToneClass = {
    exact: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    provisional: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    proxy: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
    snapshot: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    missing: 'border-border bg-subtle text-muted-foreground',
  } as const;

  const gridClass = {
    compact: 'grid grid-cols-1 gap-3 sm:grid-cols-2',
    dense: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
    matrix: 'grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3',
    priority: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12',
  }[layout];

  return (
    <div className="space-y-2">
      {draggedCard && dragPreview ? (
        <div
          className="pointer-events-none fixed z-[1000] rounded-2xl border border-cyan-400/80 bg-card/95 p-4 text-foreground opacity-95 shadow-[0_28px_80px_rgba(6,182,212,0.28)] ring-2 ring-cyan-400/25 backdrop-blur-xl"
          style={{
            left: dragPreview.x,
            top: dragPreview.y,
            width: dragPreview.width,
            minHeight: Math.min(dragPreview.height, 160),
            transform: `translate(-${dragPreview.offsetX}px, -${dragPreview.offsetY}px) rotate(-1.5deg)`,
          }}
        >
          <div className="flex min-w-0 items-center gap-2 pr-20">
            <GripVertical className="h-4 w-4 shrink-0 text-cyan-500" />
            <span className={`h-2 w-2 shrink-0 rounded-full ${draggedCard.color}`} aria-hidden />
            <span className="truncate text-sm font-black text-muted-foreground">{draggedCard.title}</span>
          </div>
          <div className={`absolute right-4 top-4 inline-flex max-w-[104px] items-center gap-1 truncate rounded-full border px-2 py-1 text-[10px] font-black ${trendToneClass[draggedCard.tone]}`}>
            {draggedCard.tone === 'positive' ? <TrendingUp className="h-3 w-3 shrink-0" /> : null}
            {draggedCard.tone === 'negative' ? <TrendingDown className="h-3 w-3 shrink-0" /> : null}
            <span className="truncate">{draggedCard.trend}</span>
          </div>
          {draggedCard.subtitle ? (
            <span className="mt-4 block truncate text-xs leading-tight text-muted-foreground/70">{draggedCard.subtitle}</span>
          ) : null}
          <div className="mt-3 break-words text-3xl font-black leading-tight tracking-tight text-foreground">
            {draggedCard.value}
          </div>
          {draggedCard.secondaryValue ? (
            <div className="mt-2 min-w-0 border-t border-border/60 pt-2">
              {draggedCard.secondaryLabel ? (
                <div className="truncate text-[11px] font-bold text-muted-foreground/75">
                  {draggedCard.secondaryLabel}
                </div>
              ) : null}
              <div className="mt-1 truncate text-xl font-black leading-tight text-foreground">
                {draggedCard.secondaryValue}
              </div>
            </div>
          ) : null}
        </div>
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
            Метрики {visibleCount}/{orderedCards.length}
          </button>

          {metricsMenuOpen ? (
            <div className="absolute right-0 top-10 z-50 w-[320px] origin-top-right overflow-hidden rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-lg)] animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200 ease-out">
              <div className="flex items-center justify-between gap-3 px-2 py-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">KPI карточки</p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground/75">Показывать на дашборде</p>
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
              <div className="mt-1 max-h-[360px] overflow-y-auto pr-1">
                {orderedCards.map((card) => {
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
                        <span className="block truncate text-sm font-bold text-foreground">{card.title}</span>
                        {card.subtitle ? (
                          <span className="block truncate text-xs font-semibold text-muted-foreground">{card.subtitle}</span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={gridClass}>
      {visibleCards.map((card) => {
        const isSelectable = SELECTABLE_METRIC_KEYS.has(card.key);
        const metricKey: DashboardMetricKey | null = isSelectable ? card.key as DashboardMetricKey : null;
        const isSelected = Boolean(metricKey) && selectedMetric === metricKey;
        const isDragging = draggedKey === card.key;
        const isDropTarget = dragOverKey === card.key && draggedKey !== card.key;
        const isPrimary = card.key === 'revenue' || card.key === 'expenses' || card.key === 'profit';
        const hasSecondaryValue = Boolean(card.secondaryValue);
        const hasTertiaryValue = Boolean(card.tertiaryValue);
        const trendContextLabel = card.trend === 'snapshot'
          ? 'срез'
          : card.trend === 'нет данных'
            ? 'статус'
            : 'к пред.';
        const inlineSubtitle = card.primaryLabel && card.subtitle && card.subtitle.length <= 14 ? card.subtitle : null;
        const isCompactWide = layout === 'compact' && (card.key === 'revenue' || card.key === 'profit');
	        const drilldownMetric: KpiDrilldownMetric | 'expenses' | null = card.key === 'expenses'
	          ? 'expenses'
	          : card.key === 'revenue'
	            ? 'finance'
	            : card.key === 'grossMargin' || card.key === 'margin'
	              ? 'finance'
	              : card.key === 'orders'
	                ? 'orders'
	                : card.key === 'buyouts'
	                  ? 'buyouts'
	                  : card.key === 'ads'
	                    ? 'ads'
	                    : card.key === 'storage'
	                      ? 'storage'
	                      : card.key === 'stocks'
	                        ? 'stocks'
	                        : card.key === 'spp'
	                          ? 'spp'
	                          : card.key === 'conversion'
	                            ? 'conversion'
	                            : null;
        const sizeClass = (() => {
          if (layout === 'priority') {
            return isPrimary
              ? 'min-h-[146px] p-5 xl:col-span-4'
              : hasTertiaryValue
                ? 'min-h-[178px] p-4 xl:col-span-3'
                : hasSecondaryValue
                  ? 'min-h-[150px] p-4 xl:col-span-3'
                  : 'min-h-[118px] p-4 xl:col-span-3';
          }

          if (layout === 'compact') {
            return isCompactWide ? 'min-h-[140px] p-5 sm:col-span-2' : hasTertiaryValue ? 'min-h-[178px] p-4' : hasSecondaryValue ? 'min-h-[150px] p-4' : 'min-h-[116px] p-4';
          }

          if (layout === 'matrix') {
            return isPrimary ? 'min-h-[136px] p-5' : hasTertiaryValue ? 'min-h-[178px] p-4' : hasSecondaryValue ? 'min-h-[150px] p-4' : 'min-h-[116px] p-4';
          }

          return hasTertiaryValue ? 'min-h-[170px] p-4' : hasSecondaryValue ? 'min-h-[142px] p-4' : 'min-h-[108px] p-4';
        })();
        const valueClass = layout === 'dense'
          ? (isPrimary ? 'text-2xl' : 'text-xl')
          : (layout === 'priority' && isPrimary) || isCompactWide || (layout === 'matrix' && isPrimary)
            ? 'text-3xl'
            : 'text-2xl';
        const interactiveProps = isSelectable
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: () => {
                if (metricKey) {
                  onSelectMetric?.(metricKey);
                }
              },
              onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (metricKey) {
                    onSelectMetric?.(metricKey);
                  }
                }
              },
            }
          : {};

	        const drilldownButton = drilldownMetric ? (
	          <button
	            type="button"
	            onClick={(event) => {
	              event.stopPropagation();
	              if (drilldownMetric === 'expenses') {
	                dispatchOpenExpenseBreakdown();
	              } else {
	                dispatchOpenKpiDrilldown(drilldownMetric);
	              }
	            }}
	            className="relative z-20 mt-3 inline-flex h-8 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-black text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-600 dark:hover:text-cyan-200"
	          >
	            Провалиться
	            <ExternalLink className="h-3.5 w-3.5" />
	          </button>
	        ) : null;

	        return (
          <div
            key={card.key}
            data-kpi-card
            {...interactiveProps}
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
            className={`group relative overflow-visible rounded-2xl border bg-card shadow-[var(--shadow-xs)] transition-all duration-200 ease-out hover:z-30 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)] dark:bg-[#0d0f14] ${sizeClass} ${
              isSelectable ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60' : ''
            } ${
              isSelected
                ? 'border-cyan-400/45 ring-2 ring-cyan-400/35'
                : isDropTarget
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
                  onDragStart={(event) => {
                    setDraggedKey(card.key);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', card.key);
                    const cardNode = event.currentTarget.closest<HTMLElement>('[data-kpi-card]');
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
                  }}
                  onDrag={updateDragPreviewPosition}
                  onDragEnd={() => {
                    setDraggedKey(null);
                    setDragOverKey(null);
                    setDragPreview(null);
                  }}
                  className={`inline-flex h-4 w-4 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/50 transition-all hover:bg-subtle hover:text-cyan-500 active:cursor-grabbing ${
                    isDragging ? 'animate-pulse bg-cyan-500 text-white shadow-[0_0_0_6px_rgba(6,182,212,0.12)]' : ''
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${card.color}`} aria-hidden />
                <span className="min-w-0 text-sm font-bold leading-4 text-muted-foreground">
                  {card.title}
                </span>
                <span className="group/help relative inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center">
                  <CircleHelp className="h-3.5 w-3.5 text-muted-foreground/60 transition-colors group-hover/help:text-cyan-500" />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-6 left-1/2 z-50 w-[320px] max-w-[calc(100vw-2rem)] -translate-x-1/2 translate-y-1 rounded-2xl border border-border bg-popover/88 p-3 text-popover-foreground opacity-0 shadow-[var(--shadow-lg)] backdrop-blur-xl transition-all duration-150 delay-0 group-hover/help:translate-y-0 group-hover/help:opacity-100 group-hover/help:delay-700"
                  >
                    <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-cyan-500 dark:text-cyan-300">
                      Как считается
                    </span>
                    <span className="mt-2 block space-y-1.5 text-[11px] leading-5">
                      <span className="block"><span className="font-black">Как считаем:</span> {KPI_CALCULATIONS[card.key].formula}</span>
                      <span className="block"><span className="font-black">Откуда берём:</span> {KPI_CALCULATIONS[card.key].source}</span>
                      <span className="block"><span className="font-black">Когда обновляется:</span> {KPI_CALCULATIONS[card.key].cadence}</span>
                      <span className="block text-muted-foreground">{KPI_CALCULATIONS[card.key].note}</span>
                    </span>
                  </span>
                </span>
                {card.quality ? (
                  <span
                    title={card.quality.title}
                    className={`mt-[-1px] inline-flex max-w-[92px] shrink-0 truncate rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase leading-none ${qualityToneClass[card.quality.tone]}`}
                  >
                    {card.quality.label}
                  </span>
                ) : null}
              </div>
            </div>

            <div
              title={trendContextLabel === 'к пред.' ? 'Изменение к предыдущему периоду' : undefined}
              className={`absolute right-4 top-4 z-20 inline-flex max-w-[136px] shrink-0 items-center gap-1 truncate rounded-full border px-2 py-1 text-[10px] font-black ${trendToneClass[card.tone]}`}
            >
              {card.tone === 'positive' ? <TrendingUp className="h-3 w-3 shrink-0" /> : null}
              {card.tone === 'negative' ? <TrendingDown className="h-3 w-3 shrink-0" /> : null}
              <span className="shrink-0 text-[9px] font-bold uppercase opacity-70">{trendContextLabel}</span>
              <span className="truncate">{card.trend}</span>
            </div>

            {hasSecondaryValue ? (
              <>
                <div className={`relative z-10 mt-5 grid divide-y divide-border/70 ${hasTertiaryValue ? 'min-h-[126px] grid-rows-3' : 'min-h-[92px] grid-rows-2'}`}>
                  <div className="flex min-w-0 flex-col justify-center pb-2">
                    {(card.primaryLabel ?? card.subtitle) ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[11px] font-bold uppercase text-muted-foreground/70">
                          {card.primaryLabel ?? card.subtitle}
                        </span>
                        {inlineSubtitle ? (
                          <span className="shrink-0 truncate rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold leading-none text-amber-700 dark:text-amber-300">
                            {inlineSubtitle}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="truncate text-2xl font-black leading-tight tracking-tight text-foreground">
                      {card.value}
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col justify-center pt-2">
                    {card.secondaryLabel ? (
                      <div className="truncate text-[11px] font-bold uppercase text-muted-foreground/70">
                        {card.secondaryLabel}
                      </div>
                    ) : null}
                    <div className="truncate text-xl font-black leading-tight text-foreground">
                      {card.secondaryValue}
                    </div>
                  </div>
                  {hasTertiaryValue ? (
                    <div className="flex min-w-0 flex-col justify-center pt-2">
                      {card.tertiaryLabel ? (
                        <div className="truncate text-[11px] font-bold uppercase text-muted-foreground/70">
                          {card.tertiaryLabel}
                        </div>
                      ) : null}
                      <div className="truncate text-xl font-black leading-tight text-foreground">
                        {card.tertiaryValue}
                      </div>
                    </div>
                  ) : null}
                </div>
	                {drilldownButton}
              </>
            ) : (
              <div className="relative z-10 mt-4 min-w-0">
                {card.subtitle ? (
                  <span className="mt-1 block truncate text-xs leading-tight text-muted-foreground/70">{card.subtitle}</span>
                ) : null}
                {card.badge ? (
                  <span
                    title={card.badge}
                    className="mt-2 inline-flex max-w-full rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold leading-tight text-amber-700 dark:text-amber-300"
                  >
                    {card.badge}
                  </span>
                ) : null}
	                <div className={`mt-2 break-words font-black leading-tight tracking-tight text-foreground ${valueClass}`}>
	                  {card.value}
	                </div>
	                {drilldownButton}
	              </div>
	            )}

          </div>
        );
      })}
      </div>
    </div>
  );
}
