'use client';

import { Fragment, useEffect, useMemo, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleDot,
  ClipboardList,
  ExternalLink,
  Flag,
  FolderPlus,
  GripVertical,
  ImageIcon,
  Loader2,
  Megaphone,
  PackageCheck,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  ShoppingCart,
  RotateCcw,
  SlidersHorizontal,
  TrendingDown,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import {
  addMembersToGroup,
  createGroup,
  deleteGroup,
  getGroups,
  removeMemberFromGroup,
  renameGroup,
} from '@/app/(dashboard)/product-groups/actions';
import {
  createDynamicsGroupEvent,
  listDynamicsGroupEvents,
  type CreateDynamicsGroupEventInput,
  type DynamicsGroupEventType,
  type DynamicsGroupEventView,
} from '@/app/(dashboard)/dynamics/actions';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { toLocalDateParam } from '@/lib/date-range';
import { getWbPhotoUrl, getWbThumbnailUrl } from '@/lib/wb-api/wb-photos';
import { useStore } from '@/store/useStore';

type ProductGroup = {
  id: string;
  name: string;
};

type MetricKey =
  | 'netProfitBeforeAds'
  | 'netProfit'
  | 'adSpend'
  | 'adOrderSum'
  | 'adViews'
  | 'adClicks'
  | 'adCtr'
  | 'drr'
  | 'orderQty'
  | 'funnelOrderQty'
  | 'funnelOrderRevenue'
  | 'funnelCancelQty'
  | 'soldQty'
  | 'financeSoldQty'
  | 'funnelBuyoutQty'
  | 'funnelBuyoutRevenue'
  | 'funnelOrderToBuyoutPercent'
  | 'buyoutPercent'
  | 'orderRevenue'
  | 'revenue'
  | 'financeRevenue'
  | 'opProfit'
  | 'costTotal'
  | 'orderProjectedQty'
  | 'orderProjectedRevenue'
  | 'orderTurnoverBeforeSpp'
  | 'orderRevenueAfterSpp'
  | 'orderProjectedOpProfit'
  | 'orderProjectedCostTotal'
  | 'orderProjectedLogistics'
  | 'orderProjectedLogisticsRate'
  | 'orderWarehouseLogistics'
  | 'orderWarehouseLogisticsCoveragePercent'
  | 'orderProjectedNetProfit'
  | 'commission'
  | 'logistics'
  | 'wbStorageFee'
  | 'wbAcquiringFee'
  | 'wbAdditionalPayment'
  | 'provisionalOtherFees'
  | 'avgOrderPrice'
  | 'avgBuyoutPrice'
  | 'storageCost'
  | 'currentSpp'
  | 'currentPrice'
  | 'sellerPriceAfterDiscount'
  | 'priceAfterSpp'
  | 'buyoutPercentWb'
  | 'manualBuyoutPercent'
  | 'effectiveBuyoutPercent'
  | 'stockCount'
  | 'toClientCount'
  | 'fromClientCount'
  | 'lostOrdersCount'
  | 'avgStockTurnoverDays'
  | 'saleRateDays'
  | 'profitPerUnit'
  | 'funnelViewQty'
  | 'funnelAddToCartQty'
  | 'funnelAvgPrice'
  | 'funnelAddToCartPercent'
  | 'funnelCartToOrderPercent'
  | 'funnelImpressionsQty'
  | 'funnelImpressionsOpenCard';

type MetricValue = number | string | null | undefined;
type MetricRow = Partial<Record<MetricKey, MetricValue>>;
type DynamicsSeries = Record<string, MetricRow>;

type DynamicsFinanceMeta = {
  mode: 'operational_actual';
  calculationMode: 'FACT_WB' | 'PLAN_TEMPLATE';
  label: string;
  realizationCutoffDate: string | null;
  includesOperationalTail: boolean;
  operationalTailFrom: string | null;
  operationalTailTo: string | null;
};

type DynamicsResponse = {
  days: string[];
  group: DynamicsSeries;
  skus: Record<number, DynamicsSeries>;
  meta?: {
    finance?: DynamicsFinanceMeta;
  };
};

type ProductOption = {
  nmId: number;
  vendorCode: string;
  photoUrl: string | null;
  title?: string | null;
  currentPrice?: number | null;
  currentDiscount?: number | null;
  currentSpp?: number | null;
  currentStock?: number | null;
  costPrice?: number | null;
  activeWarehouses?: number | null;
  currentInWayToClient?: number | null;
  currentInWayFromClient?: number | null;
};

type ProductsResponse = {
  data: ProductOption[];
};

type Summary = Partial<Record<MetricKey, number | null>> & {
  drrBase: number | null;
  drrBaseLabel: string;
  buyoutBaseLabel: string;
};

type MetricKind = 'currency' | 'qty' | 'percent';
type WindowMode = '10' | '20' | 'all';
type DetailPanel = 'sku' | 'formulas';
type PerformanceDirection = 'higher' | 'lower' | 'neutral';

type OperationMetric = {
  label: string;
  source: string;
  help: string;
  kind: MetricKind;
  tone: 'profit' | 'ads' | 'orders' | 'neutral' | 'risk';
  getValue: (row: MetricRow) => number | null;
  getTotal: (summary: Summary) => number | null | undefined;
};

type SkuRowView = {
  nmId: number;
  product?: ProductOption;
  summary: Summary;
  stock: number | null;
  turnoverDays: number | null;
  role: string;
};

type SkuExpandedMetric = {
  id: string;
  label: string;
  source: string;
  help: string;
  kind: MetricKind;
  tone: OperationMetric['tone'];
  getTotal: (row: SkuRowView) => number | null | undefined;
  getDaily?: (dayRow: MetricRow) => number | null | undefined;
};

const EVENT_TYPE_META: Record<DynamicsGroupEventType, { label: string; icon: LucideIcon; className: string }> = {
  note: { label: 'Заметка', icon: CircleDot, className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  photo: { label: 'Фото', icon: ImageIcon, className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200' },
  ads: { label: 'Реклама', icon: Megaphone, className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200' },
  price: { label: 'Цена', icon: Receipt, className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  content: { label: 'Контент', icon: ClipboardList, className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200' },
  stock: { label: 'Остатки', icon: PackageCheck, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' },
  task: { label: 'Задача', icon: Flag, className: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200' },
};

const RESEARCH_SOURCES = [
  {
    title: 'WB: склейка карточек',
    label: 'seller.wildberries.ru',
    href: 'https://seller.wildberries.ru/instructions/ru/by/material/cards-merging',
    note: 'WB-склейка нужна для вариантов одной карточки. В нашей вкладке это не заменяет аналитическую группу SKU.',
  },
  {
    title: 'WB: воронка продаж',
    label: 'dev.wildberries.ru/analytics',
    href: 'https://dev.wildberries.ru/ru/openapi/analytics',
    note: 'Спрос и конверсии берем из воронки: переходы, корзина, заказы, выкупы, отмены.',
  },
  {
    title: 'WB: продвижение',
    label: 'dev.wildberries.ru/promotion',
    href: 'https://dev.wildberries.ru/ru/openapi/promotion',
    note: 'Рекламный слой отдельный: расход, показы, клики и заказы рекламы не смешиваем с финансовым фактом.',
  },
  {
    title: 'WB: финансы',
    label: 'dev.wildberries.ru/finance',
    href: 'https://dev.wildberries.ru/docs/openapi/financial-reports-and-accounting',
    note: 'Финансовый факт отвечает за выплаты, удержания, себестоимость и чистую прибыль.',
  },
  {
    title: 'GitHub: Wildberries API',
    label: 'github.com/topics/wildberries-api',
    href: 'https://github.com/topics/wildberries-api',
    note: 'Открытые проекты обычно разделяют аналитику, рекламу, финансы и отчеты. Этот подход перенесен в формулы.',
  },
  {
    title: 'GitHub: MCP/домены',
    label: 'wildberries-api-mcp-server',
    href: 'https://github.com/dmitriipolushin/wildberries-api-mcp-server',
    note: 'Практика подтверждает доменную модель: реклама, воронка продаж, поисковые запросы и складские отчеты отдельно.',
  },
];

const PRACTICE_RULES = [
  'WB-склейка карточек и наша аналитическая склейка SKU — разные сущности.',
  'Финансы, воронку, рекламу и остатки держим отдельными слоями.',
  'ДРР считаем от рекламных заказов, если они есть; иначе от funnel/raw заказов.',
  'CTR считаем по рекламе как клики / показы, а не среднее дневных CTR.',
  'Задачи и изменения пишем в день события, затем смотрим +1/+2 дня по таблице.',
];

const OPERATION_METRICS: OperationMetric[] = [
  {
    label: 'Прогноз ЧП без рекламы',
    source: 'заказы → прогноз',
    help: 'Показывает прогноз чистой прибыли по заказам без рекламного расхода. Берем прогноз ЧП по заказам и возвращаем в него рекламу.',
    kind: 'currency',
    tone: 'profit',
    getValue: (row) => projectedNetProfitBeforeAds(row),
    getTotal: (summary) => projectedNetProfitBeforeAds(summary),
  },
  {
    label: 'ЧП склейка с рекламой',
    source: 'заказы → прогноз',
    help: 'Главная оперативная чистая прибыль склейки: считаем по текущим заказам через исторические ставки WB, себестоимость, рекламу и налог.',
    kind: 'currency',
    tone: 'profit',
    getValue: (row) => numberOrNull(row.orderProjectedNetProfit),
    getTotal: (summary) => summary.orderProjectedNetProfit,
  },
  {
    label: 'ЧП факт WB / выкупы',
    source: 'финансовый факт',
    help: 'Фактическая чистая прибыль по WB realization и оперативному хвосту продаж. Нужна для сверки с прогнозом по заказам.',
    kind: 'currency',
    tone: 'profit',
    getValue: (row) => numberOrNull(row.netProfit),
    getTotal: (summary) => summary.netProfit,
  },
  {
    label: 'Бюджет рекламы общий',
    source: 'рекламные расходы',
    help: 'Сумма рекламных расходов по всем артикулам внутри склейки за выбранный день. Если реклама крутилась на один артикул, расход все равно смотрим в общем результате склейки.',
    kind: 'currency',
    tone: 'ads',
    getValue: (row) => numberOrNull(row.adSpend),
    getTotal: (summary) => summary.adSpend,
  },
  {
    label: 'ДРР общий',
    source: 'реклама / сумма заказов',
    help: 'Показывает, какую долю от суммы заказов съела реклама. Считаем так: рекламный расход всей склейки делим на сумму заказов всей склейки.',
    kind: 'percent',
    tone: 'risk',
    getValue: (row) => drrByOrderRevenue(row),
    getTotal: (summary) => drrByOrderRevenue(summary),
  },
  {
    label: 'CTR рекламы',
    source: 'клики / показы',
    help: 'Показывает, как часто люди нажимали на рекламу после показа. Считаем так: клики делим на показы и переводим в процент.',
    kind: 'percent',
    tone: 'neutral',
    getValue: (row) => ctrPercent(row),
    getTotal: (summary) => ctrPercent(summary),
  },
  {
    label: 'Заказы',
    source: 'воронка заказов',
    help: 'Количество заказов по всей склейке за день. Основной источник — воронка продаж, если ее нет, берем резервные данные заказов.',
    kind: 'qty',
    tone: 'orders',
    getValue: (row) => firstNumber(row.funnelOrderQty, row.orderQty),
    getTotal: (summary) => firstNumber(summary.funnelOrderQty, summary.orderQty),
  },
  {
    label: 'Цена заказа склейки',
    source: 'реклама / заказы',
    help: 'Сколько рекламных денег в среднем ушло на один заказ склейки. Считаем рекламный расход всей склейки и делим на все заказы склейки, даже если реклама была только на одном артикуле.',
    kind: 'currency',
    tone: 'ads',
    getValue: (row) => costPerOrder(row),
    getTotal: (summary) => costPerOrder(summary),
  },
  {
    label: 'Выкупы',
    source: 'воронка выкупов',
    help: 'Сколько заказанных товаров дошло до выкупа. Основной источник — воронка продаж, если ее нет, используем резервные данные продаж.',
    kind: 'qty',
    tone: 'orders',
    getValue: (row) => firstNumber(row.funnelBuyoutQty, row.soldQty),
    getTotal: (summary) => firstNumber(summary.funnelBuyoutQty, summary.soldQty),
  },
  {
    label: '% выкупа WB',
    source: 'WB: выкупы / завершенные заказы',
    help: 'Фактический процент выкупа по данным WB за выбранное окно. Считаем выкупы относительно выкупов и отмен, если отмены уже пришли.',
    kind: 'percent',
    tone: 'risk',
    getValue: (row) => buyoutPercent(row),
    getTotal: (summary) => buyoutPercent(summary),
  },
  {
    label: 'Предварительный % выкупа',
    source: 'WB 13 недель / юнит-экономика',
    help: 'Операционный процент выкупа для новых и слабонакопленных SKU: берем надежный WB-процент за 13 недель, а если данных мало — ручной процент из активного сценария юнит-экономики.',
    kind: 'percent',
    tone: 'risk',
    getValue: (row) => projectedBuyoutPercent(row),
    getTotal: (summary) => projectedBuyoutPercent(summary),
  },
  {
    label: 'Показы',
    source: 'показы карточек (воронка ЛК)',
    help: 'Сколько раз карточки склейки показались в поиске и каталоге WB. Это самый верх воронки — до перехода в карточку. Источник — воронка личного кабинета WB (по товарам).',
    kind: 'qty',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.funnelImpressionsQty),
    getTotal: (summary) => summary.funnelImpressionsQty,
  },
  {
    label: 'CTR воронки',
    source: 'переходы / показы',
    help: 'Какая доля показов превратилась в переходы в карточку: переходы делим на показы. Это не рекламный CTR (клики/показы рекламы), а CTR всей выдачи карточки в поиске и каталоге.',
    kind: 'percent',
    tone: 'neutral',
    getValue: (row) => funnelCtrPercent(row),
    getTotal: (summary) => funnelCtrPercent(summary),
  },
  {
    label: 'Переходы',
    source: 'переходы в карточку',
    help: 'Сколько раз покупатели переходили в карточки товаров склейки. Это верх воронки до корзины и заказа.',
    kind: 'qty',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.funnelViewQty),
    getTotal: (summary) => summary.funnelViewQty,
  },
  {
    label: '% в корзину',
    source: 'корзина / переходы',
    help: 'Какая часть посетителей карточек склейки добавила товар в корзину. Если переходы есть, а корзина слабая, проверяем фото, цену, отзывы и оффер.',
    kind: 'percent',
    tone: 'neutral',
    getValue: (row) => addToCartPercent(row),
    getTotal: (summary) => addToCartPercent(summary),
  },
  {
    label: 'Средний чек заказа',
    source: 'сумма заказов / заказы',
    help: 'Средняя сумма одного заказа по всей склейке. Считаем оборот заказов до СПП и делим на количество заказов.',
    kind: 'currency',
    tone: 'orders',
    getValue: (row) => avgOrderPrice(row),
    getTotal: (summary) => avgOrderPrice(summary),
  },
  {
    label: 'Оборот заказов до СПП',
    source: 'заказы × цена до СПП',
    help: 'Оборот по заказам до скидки площадки: количество заказов умножаем на цену продавца после скидки продавца, но до СПП. Если снимка цены нет, используем сумму заказов WB.',
    kind: 'currency',
    tone: 'orders',
    getValue: (row) => firstNumber(row.orderTurnoverBeforeSpp, row.funnelOrderRevenue, row.orderRevenue),
    getTotal: (summary) => firstNumber(summary.orderTurnoverBeforeSpp, summary.funnelOrderRevenue, summary.orderRevenue),
  },
  {
    label: 'Выручка после СПП',
    source: 'заказы × цена после СПП',
    help: 'Операционная выручка по заказам после СПП: количество заказов умножаем на цену после скидки площадки из снимка цен. Нужна, чтобы видеть разницу между оборотом до СПП и суммой, которую видит покупатель.',
    kind: 'currency',
    tone: 'orders',
    getValue: (row) => firstNumber(row.orderRevenueAfterSpp, row.funnelOrderRevenue, row.orderRevenue),
    getTotal: (summary) => firstNumber(summary.orderRevenueAfterSpp, summary.funnelOrderRevenue, summary.orderRevenue),
  },
  {
    label: 'СПП',
    source: 'история цен',
    help: 'Средняя скидка площадки по последнему известному ценовому снимку на дату. Если за день снимка нет, переносим последнее известное значение.',
    kind: 'percent',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.currentSpp),
    getTotal: (summary) => summary.currentSpp,
  },
  {
    label: 'Цена после СПП',
    source: 'история цен',
    help: 'Цена, которую видит покупатель после скидки продавца и скидки площадки. Для склейки показываем агрегированное значение по ценовым снимкам.',
    kind: 'currency',
    tone: 'orders',
    getValue: (row) => numberOrNull(row.priceAfterSpp),
    getTotal: (summary) => summary.priceAfterSpp,
  },
  {
    label: 'Логистика заказов',
    source: 'заказы × % выкупа × логистика WB',
    help: 'Операционный прогноз логистики: заказы умножаем на ожидаемый % выкупа и актуальную среднюю доставку WB на выкуп. Приоритет: активная фиксация по SKU/складу, фиксация по SKU, факт WB, история SKU, история склейки, затем тарифный fallback.',
    kind: 'currency',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.orderProjectedLogistics),
    getTotal: (summary) => summary.orderProjectedLogistics,
  },
  {
    label: 'Логистика / заказ',
    source: 'логистика / заказы',
    help: 'Прогнозная логистика на один заказ уже с учетом ожидаемого выкупа. То есть средняя доставка WB на выкуп умножается на % выкупа.',
    kind: 'currency',
    tone: 'risk',
    getValue: (row) => logisticsPerOrder(row),
    getTotal: (summary) => logisticsPerOrder(summary),
  },
  {
    label: 'Логистика / выкуп',
    source: 'ставка WB до клиента',
    help: 'Средняя логистика WB на ожидаемый выкуп до применения процента выкупа. Приоритет источника: фиксация/история по остаткам, фиксация SKU, факт WB, история SKU, история склейки, затем тарифный fallback по правилам юнит-экономики.',
    kind: 'currency',
    tone: 'risk',
    getValue: (row) => logisticsPerBuyout(row),
    getTotal: (summary) => logisticsPerBuyout(summary),
  },
  {
    label: 'Покрытие логистики тарифами',
    source: 'заказы со складом и литражом',
    help: 'Доля заказов, где есть склад, литраж и тариф WB. Это диагностический fallback для новых SKU без фактической истории логистики.',
    kind: 'percent',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.orderWarehouseLogisticsCoveragePercent),
    getTotal: (summary) => summary.orderWarehouseLogisticsCoveragePercent,
  },
  {
    label: 'Выручка финансовая',
    source: 'финансовая выручка',
    help: 'Фактическая выручка по финансовым данным после того, как продажи попали в финансовый отчет. Это более поздний и финансово надежный слой, чем просто заказы.',
    kind: 'currency',
    tone: 'profit',
    getValue: (row) => firstNumber(row.financeRevenue, row.revenue),
    getTotal: (summary) => firstNumber(summary.financeRevenue, summary.revenue),
  },
  {
    label: 'Себестоимость',
    source: 'себестоимость товаров',
    help: 'Суммарная себестоимость выкупленных товаров внутри склейки. Нужна, чтобы чистая прибыль не считалась только от оборота.',
    kind: 'currency',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.costTotal),
    getTotal: (summary) => summary.costTotal,
  },
  {
    label: 'Комиссия WB',
    source: 'fact / ставка хвоста',
    help: 'Комиссия из WB realization. Для оперативного хвоста считаем по последней исторической ставке этого артикула.',
    kind: 'currency',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.commission),
    getTotal: (summary) => summary.commission,
  },
  {
    label: 'Логистика факт WB',
    source: 'fact / ставка хвоста',
    help: 'Фактическая логистика из WB realization. Для оперативного хвоста это старая оценка по исторической ставке; основная прогнозная строка теперь "Логистика заказов".',
    kind: 'currency',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.logistics),
    getTotal: (summary) => summary.logistics,
  },
  {
    label: 'Хранение в выплате WB',
    source: 'fact / ставка хвоста',
    help: 'Хранение из финансового отчета WB. В хвосте это оценка по исторической ставке, отдельно от оперативного платного хранения.',
    kind: 'currency',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.wbStorageFee),
    getTotal: (summary) => summary.wbStorageFee,
  },
  {
    label: 'Эквайринг WB',
    source: 'fact / ставка хвоста',
    help: 'Эквайринг из WB realization. Для оперативного хвоста считаем по последней исторической ставке этого артикула.',
    kind: 'currency',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.wbAcquiringFee),
    getTotal: (summary) => summary.wbAcquiringFee,
  },
  {
    label: 'Доплаты WB',
    source: 'fact / ставка хвоста',
    help: 'Доплаты WB уменьшают нагрузку расходов. В хвосте это оценка по исторической ставке артикула.',
    kind: 'currency',
    tone: 'profit',
    getValue: (row) => numberOrNull(row.wbAdditionalPayment),
    getTotal: (summary) => summary.wbAdditionalPayment,
  },
  {
    label: 'Резерв хвоста WB',
    source: 'сверка до выплаты',
    help: 'Остаточная поправка, чтобы сумма компонент хвоста сходилась с исторической выплатой WB по артикулу.',
    kind: 'currency',
    tone: 'risk',
    getValue: (row) => numberOrNull(row.provisionalOtherFees),
    getTotal: (summary) => summary.provisionalOtherFees,
  },
  {
    label: 'Хранение',
    source: 'платное хранение',
    help: 'Расходы на хранение товаров из склейки за день. Учитываем их в операционной прибыли, потому что это прямой расход.',
    kind: 'currency',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.storageCost),
    getTotal: (summary) => summary.storageCost,
  },
  {
    label: 'Остаток WB общий',
    source: 'история остатков',
    help: 'Суммарный остаток всех артикулов склейки на складах WB по дневному складскому снимку. Это состояние на дату, а не продажи.',
    kind: 'qty',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.stockCount),
    getTotal: (summary) => summary.stockCount,
  },
  {
    label: 'Остаток с % выкупа',
    source: 'остаток × выкуп',
    help: 'Грубая операционная оценка: текущий остаток склейки умножаем на процент выкупа. Это не факт продаж, а быстрый ориентир по доступному потенциалу.',
    kind: 'qty',
    tone: 'risk',
    getValue: (row) => adjustedStock(row),
    getTotal: (summary) => adjustedStock(summary),
  },
  {
    label: 'Оборачиваемость, дней',
    source: 'история остатков WB',
    help: 'Оценка WB, на сколько дней хватает остатка при текущем темпе движения товаров склейки. Большое число может означать зависание товара.',
    kind: 'qty',
    tone: 'risk',
    getValue: (row) => numberOrNull(row.avgStockTurnoverDays),
    getTotal: (summary) => summary.avgStockTurnoverDays,
  },
  {
    label: 'В пути до клиента',
    source: 'история остатков',
    help: 'Сколько товаров из склейки на эту дату ехало к клиентам. Смотрим рядом с заказами и будущими выкупами.',
    kind: 'qty',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.toClientCount),
    getTotal: (summary) => summary.toClientCount,
  },
  {
    label: 'В пути от клиента',
    source: 'история остатков',
    help: 'Сколько товаров из склейки на эту дату возвращалось от клиентов. Помогает быстрее увидеть возвратную нагрузку.',
    kind: 'qty',
    tone: 'neutral',
    getValue: (row) => numberOrNull(row.fromClientCount),
    getTotal: (summary) => summary.fromClientCount,
  },
  {
    label: 'Потерянные заказы',
    source: 'история остатков WB',
    help: 'Оценка WB по заказам, которые могли быть потеряны из-за проблем с наличием или размещением остатка.',
    kind: 'qty',
    tone: 'risk',
    getValue: (row) => numberOrNull(row.lostOrdersCount),
    getTotal: (summary) => summary.lostOrdersCount,
  },
  {
    label: 'Прибыль / шт',
    source: 'прибыль / выкупы',
    help: 'Средняя чистая прибыль на одну выкупленную штуку. Считаем чистую прибыль и делим на количество выкупленных товаров.',
    kind: 'currency',
    tone: 'profit',
    getValue: (row) => profitPerUnit(row),
    getTotal: (summary) => profitPerUnit(summary),
  },
];

const SKU_EXPANDED_METRICS: SkuExpandedMetric[] = [
  {
    id: 'orderProjectedNetProfit',
    label: 'ЧП с рекламой',
    source: 'заказы → прогноз',
    help: 'Главная оперативная чистая прибыль артикула по заказам: заказная выручка минус расчетные WB-расходы, себестоимость, реклама и налог.',
    kind: 'currency',
    tone: 'profit',
    getTotal: (row) => row.summary.orderProjectedNetProfit,
    getDaily: (dayRow) => numberOrNull(dayRow.orderProjectedNetProfit),
  },
  {
    id: 'netProfit',
    label: 'ЧП факт WB',
    source: 'финансовый факт',
    help: 'Фактическая чистая прибыль по WB realization и оперативному хвосту продаж. По дням нужна для сверки с прогнозом по заказам.',
    kind: 'currency',
    tone: 'profit',
    getTotal: (row) => row.summary.netProfit,
    getDaily: (dayRow) => numberOrNull(dayRow.netProfit),
  },
  {
    id: 'netProfitBeforeAds',
    label: 'Прогноз ЧП без рекламы',
    source: 'заказы → прогноз',
    help: 'Прогноз чистой прибыли артикула без учета рекламы. Нужен, чтобы понять, выдерживает ли заказная экономика товар сама по себе.',
    kind: 'currency',
    tone: 'profit',
    getTotal: (row) => projectedNetProfitBeforeAds(row.summary),
    getDaily: (dayRow) => projectedNetProfitBeforeAds(dayRow),
  },
  {
    id: 'profitPerUnit',
    label: 'Прибыль / шт',
    source: 'прибыль / выкупы',
    help: 'Сколько чистой прибыли в среднем приносит одна выкупленная штука этого артикула. Считаем прибыль и делим на выкупленное количество.',
    kind: 'currency',
    tone: 'profit',
    getTotal: (row) => profitPerUnit(row.summary),
    getDaily: (dayRow) => profitPerUnit(dayRow),
  },
  {
    id: 'adSpend',
    label: 'Реклама',
    source: 'рекламные расходы',
    help: 'Рекламный расход, который пришелся на этот артикул за день. Если продвигаем один товар, здесь видно, куда фактически списывался бюджет.',
    kind: 'currency',
    tone: 'ads',
    getTotal: (row) => row.summary.adSpend,
    getDaily: (dayRow) => numberOrNull(dayRow.adSpend),
  },
  {
    id: 'cpo',
    label: 'Цена заказа',
    source: 'реклама / заказы',
    help: 'Сколько рекламы в среднем ушло на один заказ этого артикула. Считаем рекламный расход артикула и делим на его заказы.',
    kind: 'currency',
    tone: 'ads',
    getTotal: (row) => costPerOrder(row.summary),
    getDaily: (dayRow) => costPerOrder(dayRow),
  },
  {
    id: 'drr',
    label: 'ДРР',
    source: 'реклама / сумма заказов',
    help: 'Доля рекламы в сумме заказов по артикулу. Чем выше процент, тем больше реклама давит на результат товара.',
    kind: 'percent',
    tone: 'risk',
    getTotal: (row) => drrByOrderRevenue(row.summary),
    getDaily: (dayRow) => drrByOrderRevenue(dayRow),
  },
  {
    id: 'adCtr',
    label: 'CTR рекламы',
    source: 'клики / показы',
    help: 'Показывает, насколько хорошо реклама получает клики. Считаем клики по артикулу относительно показов.',
    kind: 'percent',
    tone: 'neutral',
    getTotal: (row) => ctrPercent(row.summary),
    getDaily: (dayRow) => ctrPercent(dayRow),
  },
  {
    id: 'orders',
    label: 'Заказы',
    source: 'воронка заказов',
    help: 'Количество заказов по артикулу за день. Это главный быстрый сигнал спроса до фактического выкупа.',
    kind: 'qty',
    tone: 'orders',
    getTotal: (row) => firstNumber(row.summary.funnelOrderQty, row.summary.orderQty),
    getDaily: (dayRow) => orderCount(dayRow),
  },
  {
    id: 'avgOrderPrice',
    label: 'Средний чек заказа',
    source: 'сумма заказов / заказы',
    help: 'Средняя сумма одного заказа по артикулу. Считаем сумму заказов и делим на количество заказов.',
    kind: 'currency',
    tone: 'orders',
    getTotal: (row) => avgOrderPrice(row.summary),
    getDaily: (dayRow) => avgOrderPrice(dayRow),
  },
  {
    id: 'orderTurnoverBeforeSpp',
    label: 'Оборот заказов до СПП',
    source: 'заказы × цена до СПП',
    help: 'Оборот по заказам до скидки площадки: количество заказов умножаем на цену продавца после скидки продавца, но до СПП.',
    kind: 'currency',
    tone: 'orders',
    getTotal: (row) => firstNumber(row.summary.orderTurnoverBeforeSpp, row.summary.funnelOrderRevenue, row.summary.orderRevenue),
    getDaily: (dayRow) => firstNumber(dayRow.orderTurnoverBeforeSpp, dayRow.funnelOrderRevenue, dayRow.orderRevenue),
  },
  {
    id: 'orderRevenueAfterSpp',
    label: 'Выручка после СПП',
    source: 'заказы × цена после СПП',
    help: 'Выручка по заказам после СПП: количество заказов умножаем на цену после скидки площадки из снимка цен.',
    kind: 'currency',
    tone: 'orders',
    getTotal: (row) => firstNumber(row.summary.orderRevenueAfterSpp, row.summary.funnelOrderRevenue, row.summary.orderRevenue),
    getDaily: (dayRow) => firstNumber(dayRow.orderRevenueAfterSpp, dayRow.funnelOrderRevenue, dayRow.orderRevenue),
  },
  {
    id: 'orderProjectedLogistics',
    label: 'Логистика заказов',
    source: 'заказы × % выкупа × логистика WB',
    help: 'Операционная логистика артикула по заказам. Считаем прогнозом: заказы × ожидаемый % выкупа × актуальная средняя доставка WB. Тарифы используются только как последний fallback.',
    kind: 'currency',
    tone: 'neutral',
    getTotal: (row) => row.summary.orderProjectedLogistics,
    getDaily: (dayRow) => numberOrNull(dayRow.orderProjectedLogistics),
  },
  {
    id: 'logisticsPerOrder',
    label: 'Логистика / заказ',
    source: 'логистика / заказы',
    help: 'Средняя прогнозная логистика на один заказ артикула уже с учетом ожидаемого выкупа. Для логистики на один выкуп смотри RAW/финансовую детализацию.',
    kind: 'currency',
    tone: 'risk',
    getTotal: (row) => logisticsPerOrder(row.summary),
    getDaily: (dayRow) => logisticsPerOrder(dayRow),
  },
  {
    id: 'orderProjectedLogisticsRate',
    label: 'Логистика / выкуп',
    source: 'ставка WB до клиента',
    help: 'Средняя ставка логистики WB на ожидаемый выкуп. Тарифный fallback синхронизирован с юнит-экономикой: до 1 л используется сетка WB 23/26/29/30/32 с коэффициентом склада, после 1 л — base+liter из WB; ИЛ/КРП учитываются при наличии локализации.',
    kind: 'currency',
    tone: 'risk',
    getTotal: (row) => logisticsPerBuyout(row.summary),
    getDaily: (dayRow) => logisticsPerBuyout(dayRow),
  },
  {
    id: 'orderWarehouseLogisticsCoveragePercent',
    label: 'Покрытие логистики тарифами',
    source: 'заказы со складом и литражом',
    help: 'Доля заказов артикула, где логистика посчитана по складу, литражу и тарифу WB. Если покрытия нет, используется исторический fallback.',
    kind: 'percent',
    tone: 'neutral',
    getTotal: (row) => row.summary.orderWarehouseLogisticsCoveragePercent,
    getDaily: (dayRow) => numberOrNull(dayRow.orderWarehouseLogisticsCoveragePercent),
  },
  {
    id: 'buyouts',
    label: 'Выкупы',
    source: 'воронка выкупов',
    help: 'Количество товаров, которые дошли до выкупа. Это более жесткий показатель, чем заказ, потому что клиент реально забрал товар.',
    kind: 'qty',
    tone: 'orders',
    getTotal: (row) => firstNumber(row.summary.funnelBuyoutQty, row.summary.soldQty),
    getDaily: (dayRow) => firstNumber(dayRow.funnelBuyoutQty, dayRow.soldQty),
  },
  {
    id: 'buyoutPercent',
    label: '% выкупа WB',
    source: 'WB: выкупы / завершенные заказы',
    help: 'Фактическая доля выкупов среди завершенных заказов артикула по данным WB.',
    kind: 'percent',
    tone: 'risk',
    getTotal: (row) => buyoutPercent(row.summary),
    getDaily: (dayRow) => buyoutPercent(dayRow),
  },
  {
    id: 'effectiveBuyoutPercent',
    label: 'Предварительный % выкупа',
    source: 'WB 13 недель / юнит-экономика',
    help: 'Операционный процент выкупа: берем надежный WB-процент за 13 недель, а если данных мало — ручной процент из активного сценария юнит-экономики.',
    kind: 'percent',
    tone: 'risk',
    getTotal: (row) => projectedBuyoutPercent(row.summary),
    getDaily: (dayRow) => projectedBuyoutPercent(dayRow),
  },
  {
    id: 'funnelImpressionsQty',
    label: 'Показы',
    source: 'показы карточки (воронка ЛК)',
    help: 'Сколько раз карточка товара показалась в поиске и каталоге WB. Самый верх воронки — до перехода в карточку. Источник — воронка личного кабинета WB по товарам.',
    kind: 'qty',
    tone: 'neutral',
    getTotal: (row) => row.summary.funnelImpressionsQty,
    getDaily: (dayRow) => numberOrNull(dayRow.funnelImpressionsQty),
  },
  {
    id: 'funnelCtrPercent',
    label: 'CTR воронки',
    source: 'переходы / показы',
    help: 'Какая доля показов карточки превратилась в переходы. Переходы делим на показы. Это не рекламный CTR (клики/показы рекламы), а CTR выдачи карточки.',
    kind: 'percent',
    tone: 'neutral',
    getTotal: (row) => funnelCtrPercent(row.summary),
    getDaily: (dayRow) => funnelCtrPercent(dayRow),
  },
  {
    id: 'funnelViewQty',
    label: 'Переходы',
    source: 'переходы в карточку',
    help: 'Сколько раз покупатели переходили в карточку товара. Это верх воронки: интерес есть, но еще не факт, что товар добавили в корзину или заказали.',
    kind: 'qty',
    tone: 'neutral',
    getTotal: (row) => row.summary.funnelViewQty,
    getDaily: (dayRow) => numberOrNull(dayRow.funnelViewQty),
  },
  {
    id: 'funnelAddToCartPercent',
    label: '% в корзину',
    source: 'корзина / переходы',
    help: 'Какая часть посетителей карточки добавила товар в корзину. Если переходы есть, а корзина слабая, обычно проверяем фото, цену, отзывы и оффер.',
    kind: 'percent',
    tone: 'neutral',
    getTotal: (row) => addToCartPercent(row.summary),
    getDaily: (dayRow) => addToCartPercent(dayRow),
  },
  {
    id: 'storageCost',
    label: 'Хранение',
    source: 'платное хранение',
    help: 'Расходы на хранение по артикулу. Важно смотреть вместе с остатками и оборачиваемостью, чтобы товар не съедал прибыль складом.',
    kind: 'currency',
    tone: 'neutral',
    getTotal: (row) => row.summary.storageCost,
    getDaily: (dayRow) => numberOrNull(dayRow.storageCost),
  },
  {
    id: 'commission',
    label: 'Комиссия WB',
    source: 'fact / ставка хвоста',
    help: 'Комиссия WB по артикулу. Для оперативного хвоста показываем оценку по исторической ставке этого артикула.',
    kind: 'currency',
    tone: 'neutral',
    getTotal: (row) => row.summary.commission,
    getDaily: (dayRow) => numberOrNull(dayRow.commission),
  },
  {
    id: 'logistics',
    label: 'Логистика факт WB',
    source: 'fact / ставка хвоста',
    help: 'Фактическая логистика WB по артикулу из realization. Для оперативного хвоста это старая оценка по исторической ставке; основная прогнозная строка теперь "Логистика заказов".',
    kind: 'currency',
    tone: 'neutral',
    getTotal: (row) => row.summary.logistics,
    getDaily: (dayRow) => numberOrNull(dayRow.logistics),
  },
  {
    id: 'wbAcquiringFee',
    label: 'Эквайринг WB',
    source: 'fact / ставка хвоста',
    help: 'Эквайринг WB по артикулу. Для оперативного хвоста показываем оценку по исторической ставке этого артикула.',
    kind: 'currency',
    tone: 'neutral',
    getTotal: (row) => row.summary.wbAcquiringFee,
    getDaily: (dayRow) => numberOrNull(dayRow.wbAcquiringFee),
  },
  {
    id: 'wbAdditionalPayment',
    label: 'Доплаты WB',
    source: 'fact / ставка хвоста',
    help: 'Доплаты WB по артикулу. Положительное значение работает в плюс к выплате.',
    kind: 'currency',
    tone: 'profit',
    getTotal: (row) => row.summary.wbAdditionalPayment,
    getDaily: (dayRow) => numberOrNull(dayRow.wbAdditionalPayment),
  },
  {
    id: 'provisionalOtherFees',
    label: 'Резерв хвоста WB',
    source: 'сверка до выплаты',
    help: 'Остаточная поправка хвоста по артикулу до прихода еженедельного WB realization.',
    kind: 'currency',
    tone: 'risk',
    getTotal: (row) => row.summary.provisionalOtherFees,
    getDaily: (dayRow) => numberOrNull(dayRow.provisionalOtherFees),
  },
  {
    id: 'currentSpp',
    label: 'СПП',
    source: 'история цен',
    help: 'Скидка площадки по последнему известному ценовому снимку на эту дату. Если в этот день нового снимка не было, переносим последнее известное значение.',
    kind: 'percent',
    tone: 'neutral',
    getTotal: (row) => row.summary.currentSpp,
    getDaily: (dayRow) => numberOrNull(dayRow.currentSpp),
  },
  {
    id: 'priceAfterSpp',
    label: 'Цена после СПП',
    source: 'история цен',
    help: 'Цена, которую видит покупатель после скидки продавца и скидки площадки. Берем последний снимок цены за день.',
    kind: 'currency',
    tone: 'orders',
    getTotal: (row) => row.summary.priceAfterSpp,
    getDaily: (dayRow) => numberOrNull(dayRow.priceAfterSpp),
  },
  {
    id: 'stockCount',
    label: 'Остаток WB',
    source: 'история остатков',
    help: 'Сколько штук было на складах WB по дневному складскому снимку. Это состояние на дату, а не сумма за период.',
    kind: 'qty',
    tone: 'neutral',
    getTotal: (row) => row.summary.stockCount,
    getDaily: (dayRow) => numberOrNull(dayRow.stockCount),
  },
  {
    id: 'toClientCount',
    label: 'В пути до клиента',
    source: 'история остатков',
    help: 'Товары, которые на эту дату ехали к клиентам. Помогает связать заказы, будущие выкупы и возвраты.',
    kind: 'qty',
    tone: 'neutral',
    getTotal: (row) => row.summary.toClientCount,
    getDaily: (dayRow) => numberOrNull(dayRow.toClientCount),
  },
  {
    id: 'fromClientCount',
    label: 'В пути от клиента',
    source: 'история остатков',
    help: 'Товары, которые на эту дату возвращались от клиентов. Смотрим рядом с выкупами и отменами.',
    kind: 'qty',
    tone: 'neutral',
    getTotal: (row) => row.summary.fromClientCount,
    getDaily: (dayRow) => numberOrNull(dayRow.fromClientCount),
  },
  {
    id: 'adjustedStock',
    label: 'Остаток с % выкупа',
    source: 'остаток × выкуп',
    help: 'Грубая оценка: текущий на дату остаток умножаем на процент выкупа этого же дня. Это не факт продаж, а быстрый операционный ориентир.',
    kind: 'qty',
    tone: 'risk',
    getTotal: (row) => adjustedStock(row.summary),
    getDaily: (dayRow) => adjustedStock(dayRow),
  },
  {
    id: 'avgStockTurnoverDays',
    label: 'Оборачиваемость, дней',
    source: 'история остатков WB',
    help: 'Оценка WB, на сколько дней хватает остатка при текущем темпе движения товара. Большое число может означать зависание товара.',
    kind: 'qty',
    tone: 'risk',
    getTotal: (row) => row.summary.avgStockTurnoverDays,
    getDaily: (dayRow) => numberOrNull(dayRow.avgStockTurnoverDays),
  },
  {
    id: 'lostOrdersCount',
    label: 'Потерянные заказы',
    source: 'история остатков WB',
    help: 'Оценка WB по заказам, которые могли быть потеряны из-за проблем с наличием или размещением остатка.',
    kind: 'qty',
    tone: 'risk',
    getTotal: (row) => row.summary.lostOrdersCount,
    getDaily: (dayRow) => numberOrNull(dayRow.lostOrdersCount),
  },
];

function numberOrNull(value: MetricValue) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstNumber(...values: MetricValue[]) {
  for (const value of values) {
    const numeric = numberOrNull(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function orderCount(row: MetricRow) {
  return firstNumber(row.funnelOrderQty, row.orderQty);
}

function projectedNetProfitBeforeAds(row: MetricRow) {
  const profit = numberOrNull(row.orderProjectedNetProfit);
  const ads = numberOrNull(row.adSpend);
  if (profit === null && ads === null) return null;
  return (profit ?? 0) + (ads ?? 0);
}

function costPerOrder(row: MetricRow) {
  return divide(numberOrNull(row.adSpend), orderCount(row));
}

function logisticsPerOrder(row: MetricRow) {
  return divide(numberOrNull(row.orderProjectedLogistics), orderCount(row));
}

function logisticsPerBuyout(row: MetricRow) {
  return firstNumber(
    row.orderProjectedLogisticsRate,
    divide(numberOrNull(row.orderProjectedLogistics), numberOrNull(row.orderProjectedQty)),
  );
}

function orderRevenue(row: MetricRow) {
  return firstNumber(row.orderTurnoverBeforeSpp, row.funnelOrderRevenue, row.orderRevenue, row.adOrderSum);
}

function drrByOrderRevenue(row: MetricRow) {
  const value = divide(numberOrNull(row.adSpend), orderRevenue(row));
  return value === null ? null : value * 100;
}

function ctrPercent(row: MetricRow) {
  const direct = numberOrNull(row.adCtr);
  if (direct !== null && direct >= 0 && direct <= 100) return direct;
  return ctrFromClicksViews(numberOrNull(row.adClicks), numberOrNull(row.adViews));
}

function avgOrderPrice(row: MetricRow) {
  const direct = numberOrNull(row.avgOrderPrice);
  if (direct !== null) return direct;
  return divide(orderRevenue(row), orderCount(row));
}

function buyoutPercent(row: MetricRow) {
  const direct = numberOrNull(row.buyoutPercent);
  if (direct !== null) return direct;

  const buyouts = firstNumber(row.funnelBuyoutQty, row.soldQty);
  const cancels = numberOrNull(row.funnelCancelQty);
  if (buyouts !== null && cancels !== null && buyouts + cancels > 0) {
    return (buyouts / (buyouts + cancels)) * 100;
  }

  const value = divide(buyouts, orderCount(row));
  return value === null ? null : value * 100;
}

function projectedBuyoutPercent(row: MetricRow) {
  return firstNumber(row.effectiveBuyoutPercent, row.buyoutPercentWb, row.manualBuyoutPercent, row.buyoutPercent);
}

function adjustedStock(row: MetricRow) {
  const stock = numberOrNull(row.stockCount);
  const buyout = buyoutPercent(row);
  if (stock === null || buyout === null) return null;
  return stock * (buyout / 100);
}

function addToCartPercent(row: MetricRow) {
  const direct = numberOrNull(row.funnelAddToCartPercent);
  if (direct !== null) return direct;
  const value = divide(numberOrNull(row.funnelAddToCartQty), numberOrNull(row.funnelViewQty));
  return value === null ? null : value * 100;
}

// CTR воронки = переходы / показы (оба из per-nm воронки ЛК). Отличается от
// рекламного ctrPercent (клики/показы рекламы).
function funnelCtrPercent(row: MetricRow) {
  const value = divide(numberOrNull(row.funnelImpressionsOpenCard), numberOrNull(row.funnelImpressionsQty));
  return value === null ? null : value * 100;
}

function profitPerUnit(row: MetricRow) {
  const direct = numberOrNull(row.profitPerUnit);
  if (direct !== null) return direct;
  return divide(
    numberOrNull(row.netProfit),
    firstNumber(row.financeSoldQty, row.soldQty, row.funnelBuyoutQty),
  );
}

function sumMetric(series: DynamicsSeries, key: MetricKey) {
  let total = 0;
  let hasValue = false;

  Object.values(series).forEach((row) => {
    const value = numberOrNull(row[key]);
    if (value !== null) {
      total += value;
      hasValue = true;
    }
  });

  return hasValue ? total : null;
}

function averageMetric(series: DynamicsSeries, key: MetricKey) {
  let total = 0;
  let count = 0;

  Object.values(series).forEach((row) => {
    const value = numberOrNull(row[key]);
    if (value !== null) {
      total += value;
      count += 1;
    }
  });

  return count > 0 ? total / count : null;
}

function orderWeightedAverageMetric(series: DynamicsSeries, key: MetricKey) {
  let total = 0;
  let weightTotal = 0;

  Object.values(series).forEach((row) => {
    const value = numberOrNull(row[key]);
    const weight = orderCount(row);
    if (value !== null && weight !== null && weight > 0) {
      total += value * weight;
      weightTotal += weight;
    }
  });

  return weightTotal > 0 ? total / weightTotal : averageMetric(series, key);
}

function latestMetric(series: DynamicsSeries, key: MetricKey) {
  const rows = Object.values(series);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = numberOrNull(rows[index]?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function divide(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function ctrFromClicksViews(clicks: number | null, views: number | null) {
  if (views === null || views <= 0) return null;
  if (clicks === null || clicks < 0) return null;
  if (clicks <= views) return (clicks / views) * 100;
  return null;
}

function buildSummary(series: DynamicsSeries): Summary {
  const revenue = sumMetric(series, 'revenue');
  const soldQty = sumMetric(series, 'soldQty');
  const financeRevenue = sumMetric(series, 'financeRevenue');
  const financeSoldQty = sumMetric(series, 'financeSoldQty');
  const orderQty = sumMetric(series, 'orderQty');
  const orderRevenue = sumMetric(series, 'orderRevenue');
  const orderTurnoverBeforeSpp = sumMetric(series, 'orderTurnoverBeforeSpp');
  const orderRevenueAfterSpp = sumMetric(series, 'orderRevenueAfterSpp');
  const funnelOrderQty = sumMetric(series, 'funnelOrderQty');
  const funnelOrderRevenue = sumMetric(series, 'funnelOrderRevenue');
  const funnelBuyoutQty = sumMetric(series, 'funnelBuyoutQty');
  const funnelBuyoutRevenue = sumMetric(series, 'funnelBuyoutRevenue');
  const funnelCancelQty = sumMetric(series, 'funnelCancelQty');
  const funnelViewQty = sumMetric(series, 'funnelViewQty');
  const funnelImpressionsQty = sumMetric(series, 'funnelImpressionsQty');
  const funnelImpressionsOpenCard = sumMetric(series, 'funnelImpressionsOpenCard');
  const funnelAddToCartQty = sumMetric(series, 'funnelAddToCartQty');
  const adSpend = sumMetric(series, 'adSpend');
  const adOrderSum = sumMetric(series, 'adOrderSum');
  const adViews = sumMetric(series, 'adViews');
  const adClicks = sumMetric(series, 'adClicks');
  const opProfit = sumMetric(series, 'opProfit');
  const costTotal = sumMetric(series, 'costTotal');
  const orderProjectedQty = sumMetric(series, 'orderProjectedQty');
  const orderProjectedRevenue = sumMetric(series, 'orderProjectedRevenue');
  const orderProjectedOpProfit = sumMetric(series, 'orderProjectedOpProfit');
  const orderProjectedCostTotal = sumMetric(series, 'orderProjectedCostTotal');
  const orderProjectedLogistics = sumMetric(series, 'orderProjectedLogistics');
  const orderWarehouseLogistics = sumMetric(series, 'orderWarehouseLogistics');
  const orderWarehouseLogisticsCoveragePercent = orderWeightedAverageMetric(series, 'orderWarehouseLogisticsCoveragePercent');
  const orderProjectedNetProfit = sumMetric(series, 'orderProjectedNetProfit');
  const commission = sumMetric(series, 'commission');
  const logistics = sumMetric(series, 'logistics');
  const wbStorageFee = sumMetric(series, 'wbStorageFee');
  const wbAcquiringFee = sumMetric(series, 'wbAcquiringFee');
  const wbAdditionalPayment = sumMetric(series, 'wbAdditionalPayment');
  const provisionalOtherFees = sumMetric(series, 'provisionalOtherFees');
  const storageCost = sumMetric(series, 'storageCost');
  const netProfit = sumMetric(series, 'netProfit');
  const netProfitBeforeAds = sumMetric(series, 'netProfitBeforeAds');
  const buyoutPercentWb = averageMetric(series, 'buyoutPercentWb');
  const manualBuyoutPercent = averageMetric(series, 'manualBuyoutPercent');
  const effectiveBuyoutPercent = averageMetric(series, 'effectiveBuyoutPercent');
  const funnelAvgPrice = averageMetric(series, 'funnelAvgPrice');
  const currentSpp = latestMetric(series, 'currentSpp');
  const currentPrice = latestMetric(series, 'currentPrice');
  const sellerPriceAfterDiscount = latestMetric(series, 'sellerPriceAfterDiscount');
  const priceAfterSpp = latestMetric(series, 'priceAfterSpp');
  const stockCount = latestMetric(series, 'stockCount');
  const toClientCount = latestMetric(series, 'toClientCount');
  const fromClientCount = latestMetric(series, 'fromClientCount');
  const lostOrdersCount = latestMetric(series, 'lostOrdersCount');
  const avgStockTurnoverDays = latestMetric(series, 'avgStockTurnoverDays');
  const saleRateDays = latestMetric(series, 'saleRateDays');

  const profitabilityRevenue = financeRevenue && financeRevenue > 0 ? financeRevenue : revenue;
  const profitabilitySoldQty = financeSoldQty && financeSoldQty > 0 ? financeSoldQty : soldQty;
  const drrBase = orderTurnoverBeforeSpp && orderTurnoverBeforeSpp > 0
    ? orderTurnoverBeforeSpp
    : (funnelOrderRevenue && funnelOrderRevenue > 0
      ? funnelOrderRevenue
      : (orderRevenue && orderRevenue > 0
        ? orderRevenue
        : (adOrderSum && adOrderSum > 0 ? adOrderSum : null)));
  const drrBaseLabel = orderTurnoverBeforeSpp && orderTurnoverBeforeSpp > 0
    ? 'оборот заказов до СПП всей склейки'
    : (funnelOrderRevenue && funnelOrderRevenue > 0
      ? 'сумма заказов из воронки всей склейки'
      : (orderRevenue && orderRevenue > 0
        ? 'резервная сумма заказов всей склейки'
        : (adOrderSum && adOrderSum > 0 ? 'сумма заказов из рекламы, если других данных нет' : 'нет базы')));
  const closedOutcomes = (funnelBuyoutQty ?? 0) + (funnelCancelQty ?? 0);
  const funnelOrderToBuyoutPercent = divide(funnelBuyoutQty, funnelOrderQty);
  const buyoutPercent = closedOutcomes > 0
    ? divide(funnelBuyoutQty, closedOutcomes)
    : funnelOrderToBuyoutPercent;
  const buyoutBaseLabel = closedOutcomes > 0 ? 'выкупы относительно выкупов и отмен' : 'выкупы относительно заказов, если отмен нет';
  const avgOrderPrice = divide(
    orderTurnoverBeforeSpp && orderTurnoverBeforeSpp > 0
      ? orderTurnoverBeforeSpp
      : (funnelOrderRevenue && funnelOrderRevenue > 0 ? funnelOrderRevenue : orderRevenue),
    funnelOrderQty && funnelOrderQty > 0 ? funnelOrderQty : orderQty,
  );
  const avgBuyoutPrice = divide(profitabilityRevenue, profitabilitySoldQty);
  const profitPerUnit = divide(netProfit, profitabilitySoldQty);
  const funnelAddToCartPercent = divide(funnelAddToCartQty, funnelViewQty);
  const funnelCartToOrderPercent = divide(funnelOrderQty, funnelAddToCartQty);
  const adCtr = ctrFromClicksViews(adClicks, adViews);

  return {
    revenue,
    soldQty,
    financeRevenue,
    financeSoldQty,
    orderQty,
    orderRevenue,
    orderTurnoverBeforeSpp,
    orderRevenueAfterSpp,
    funnelOrderQty,
    funnelOrderRevenue,
    funnelBuyoutQty,
    funnelBuyoutRevenue,
    funnelCancelQty,
    funnelViewQty,
    funnelImpressionsQty,
    funnelImpressionsOpenCard,
    funnelAddToCartQty,
    funnelAvgPrice,
    adSpend,
    adOrderSum,
    adViews,
    adClicks,
    adCtr,
    opProfit,
    costTotal,
    orderProjectedQty,
    orderProjectedRevenue,
    orderProjectedOpProfit,
    orderProjectedCostTotal,
    orderProjectedLogistics,
    orderWarehouseLogistics,
    orderWarehouseLogisticsCoveragePercent,
    orderProjectedNetProfit,
    commission,
    logistics,
    wbStorageFee,
    wbAcquiringFee,
    wbAdditionalPayment,
    provisionalOtherFees,
    storageCost,
    currentSpp,
    currentPrice,
    sellerPriceAfterDiscount,
    priceAfterSpp,
    stockCount,
    toClientCount,
    fromClientCount,
    lostOrdersCount,
    avgStockTurnoverDays,
    saleRateDays,
    netProfit,
    netProfitBeforeAds,
    buyoutPercentWb,
    manualBuyoutPercent,
    effectiveBuyoutPercent,
    drr: drrBase ? (divide(adSpend, drrBase) ?? 0) * 100 : null,
    drrBase,
    drrBaseLabel,
    buyoutPercent: buyoutPercent === null ? null : buyoutPercent * 100,
    buyoutBaseLabel,
    avgOrderPrice,
    avgBuyoutPrice,
    profitPerUnit,
    funnelAddToCartPercent: funnelAddToCartPercent === null ? null : funnelAddToCartPercent * 100,
    funnelCartToOrderPercent: funnelCartToOrderPercent === null ? null : funnelCartToOrderPercent * 100,
    funnelOrderToBuyoutPercent: funnelOrderToBuyoutPercent === null ? null : funnelOrderToBuyoutPercent * 100,
  };
}

function pickDays(days: string[], mode: WindowMode) {
  if (mode === 'all') return days;
  return days.slice(-Number(mode));
}

function sliceSeries(series: DynamicsSeries, days: string[]) {
  return days.reduce<DynamicsSeries>((acc, day) => {
    acc[day] = series[day] ?? {};
    return acc;
  }, {});
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatQty(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

function formatMetric(value: number | null | undefined, kind: MetricKind) {
  if (kind === 'currency') return formatCurrency(value);
  if (kind === 'percent') return formatPercent(value);
  return formatQty(value);
}

function performanceDirection(metric: { id?: string; label: string; tone: OperationMetric['tone'] }): PerformanceDirection {
  const key = `${metric.id ?? ''} ${metric.label}`.toLowerCase();

  if (/(drr|cpo|adspend|storagecost|lostorders|commission|logistics|acquiring|provisional|бюджет рекламы|дрр|цена заказа|себестоимость|хранение|комиссия|логистика|эквайринг|резерв|потерянные|оборачиваемость)/.test(key)) {
    return 'lower';
  }

  if (/(currentspp|currentprice|sellerprice|priceafterspp|stockcount|toclient|fromclient|спп|цена продавца|цена после|остаток|в пути)/.test(key)) {
    return 'neutral';
  }

  if (/(netprofit|profitperunit|orderprojected|orders|buyouts|buyoutpercent|ctr|revenue|avgorderprice|funnelview|addtocart|чп|прибыль|прогноз|заказы|выкупы|% выкупа|сумма заказов|выручка|переходы|% в корзину)/.test(key)) {
    return 'higher';
  }

  return metric.tone === 'ads' || metric.tone === 'risk' ? 'lower' : 'higher';
}

function heatCellClass(
  value: number | null | undefined,
  peers: Array<number | null | undefined>,
  direction: PerformanceDirection,
) {
  const numeric = numberOrNull(value);
  if (numeric === null) return '';

  const values = peers
    .map((item) => numberOrNull(item))
    .filter((item): item is number => item !== null);
  if (values.length < 3) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  if (!Number.isFinite(spread) || spread === 0) return '';

  const normalized = (numeric - min) / spread;
  const score = direction === 'lower' ? 1 - normalized : normalized;

  if (direction === 'neutral') {
    const distance = Math.abs(normalized - 0.5);
    if (distance >= 0.42) {
      return 'bg-gradient-to-br from-amber-100 to-white text-amber-950 ring-1 ring-inset ring-amber-200 dark:from-amber-950/45 dark:to-slate-950 dark:text-amber-100 dark:ring-amber-800/60';
    }
    if (distance >= 0.3) {
      return 'bg-gradient-to-br from-sky-50 to-white text-sky-950 ring-1 ring-inset ring-sky-100 dark:from-sky-950/35 dark:to-slate-950 dark:text-sky-100 dark:ring-sky-900/60';
    }
    return '';
  }

  if (score >= 0.82) {
    return 'bg-gradient-to-br from-emerald-100 to-white text-emerald-950 ring-1 ring-inset ring-emerald-200 dark:from-emerald-950/45 dark:to-slate-950 dark:text-emerald-100 dark:ring-emerald-800/60';
  }
  if (score >= 0.65) {
    return 'bg-gradient-to-br from-emerald-50 to-white text-emerald-950 dark:from-emerald-950/25 dark:to-slate-950 dark:text-emerald-100';
  }
  if (score <= 0.18) {
    return 'bg-gradient-to-br from-rose-100 to-white text-rose-950 ring-1 ring-inset ring-rose-200 dark:from-rose-950/45 dark:to-slate-950 dark:text-rose-100 dark:ring-rose-800/60';
  }
  if (score <= 0.35) {
    return 'bg-gradient-to-br from-rose-50 to-white text-rose-950 dark:from-rose-950/25 dark:to-slate-950 dark:text-rose-100';
  }
  return '';
}

function productLabel(product: ProductOption | undefined, nmId: number) {
  return product?.title?.trim() || product?.vendorCode?.trim() || `Артикул ${nmId}`;
}

function shortText(value: string, limit = 42) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function resolvePhoto(product: ProductOption | undefined, nmId: number) {
  return getWbThumbnailUrl(product?.photoUrl) || getWbPhotoUrl(nmId, 'tm');
}

function dayLabelToIso(day: string) {
  const [dd, mm, yyyy] = day.split('.');
  return dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : day;
}

function formatIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const [yyyy, mm, dd] = value.split('-');
  return yyyy && mm && dd ? `${dd}.${mm}.${yyyy}` : value;
}

function dateInputValue(date: Date) {
  return toLocalDateParam(date);
}

function financeCoverageText(finance: DynamicsFinanceMeta | undefined) {
  if (!finance) return null;

  if (finance.includesOperationalTail) {
    const cutoff = formatIsoDate(finance.realizationCutoffDate);
    const tailFrom = formatIsoDate(finance.operationalTailFrom);
    return cutoff
      ? `Финансы WB подтверждены до ${cutoff}, после — оперативный хвост.`
      : `Финального отчета WB за период нет, считаем оперативный хвост${tailFrom ? ` с ${tailFrom}` : ''}.`;
  }

  const cutoff = formatIsoDate(finance.realizationCutoffDate);
  return cutoff ? `Финансы WB подтверждены до ${cutoff}.` : 'Финальный отчет WB за период не найден.';
}

type MetricSettings = {
  order: string[];
  hidden: string[];
};

type ConfigurableMetric = {
  id?: string;
  label: string;
  source?: string;
};

const GROUP_METRIC_SETTINGS_KEY = 'dynamics-lab:group-metrics:v2';
const SKU_METRIC_SETTINGS_KEY = 'dynamics-lab:sku-metrics:v2';
const VIEW_STATE_STORAGE_KEY_PREFIX = 'dynamics-lab:view-state:v1';

type DynamicsViewState = {
  selectedGroupId?: string;
  windowMode?: WindowMode;
  detailPanel?: DetailPanel;
  skuQuery?: string;
  dateFrom?: string;
  dateTo?: string;
};

const GROUP_DEFAULT_METRIC_ORDER = [
  'Заказы',
  'ЧП склейка с рекламой',
  'Прогноз ЧП без рекламы',
  'ЧП факт WB / выкупы',
  'Прибыль / шт',
  'Выкупы',
  '% выкупа WB',
  'Предварительный % выкупа',
  'Переходы',
  '% в корзину',
  'Оборот заказов до СПП',
  'Выручка после СПП',
  'Средний чек заказа',
  'СПП',
  'Цена после СПП',
  'Логистика заказов',
  'Логистика / заказ',
  'Логистика / выкуп',
  'Покрытие логистики тарифами',
  'Бюджет рекламы общий',
  'ДРР общий',
  'Цена заказа склейки',
  'CTR рекламы',
  'Себестоимость',
  'Комиссия WB',
  'Логистика факт WB',
  'Хранение',
  'Хранение в выплате WB',
  'Эквайринг WB',
  'Доплаты WB',
  'Резерв хвоста WB',
  'Выручка финансовая',
  'Остаток WB общий',
  'Остаток с % выкупа',
  'Оборачиваемость, дней',
  'В пути до клиента',
  'В пути от клиента',
  'Потерянные заказы',
];

const SKU_DEFAULT_METRIC_ORDER = [
  'orders',
  'orderProjectedNetProfit',
  'netProfitBeforeAds',
  'netProfit',
  'profitPerUnit',
  'buyouts',
  'buyoutPercent',
  'effectiveBuyoutPercent',
  'orderTurnoverBeforeSpp',
  'orderRevenueAfterSpp',
  'avgOrderPrice',
  'orderProjectedLogistics',
  'logisticsPerOrder',
  'orderProjectedLogisticsRate',
  'orderWarehouseLogisticsCoveragePercent',
  'adSpend',
  'drr',
  'cpo',
  'adCtr',
  'storageCost',
  'commission',
  'logistics',
  'wbAcquiringFee',
  'wbAdditionalPayment',
  'provisionalOtherFees',
  'currentSpp',
  'priceAfterSpp',
  'funnelImpressionsQty',
  'funnelCtrPercent',
  'funnelViewQty',
  'funnelAddToCartPercent',
  'stockCount',
  'toClientCount',
  'fromClientCount',
  'adjustedStock',
  'avgStockTurnoverDays',
  'lostOrdersCount',
];

function viewStateStorageKey(tenantId: string) {
  return `${VIEW_STATE_STORAGE_KEY_PREFIX}:${tenantId}`;
}

function isWindowMode(value: unknown): value is WindowMode {
  return value === '10' || value === '20' || value === 'all';
}

function isDetailPanel(value: unknown): value is DetailPanel {
  return value === 'sku' || value === 'formulas';
}

function parseStoredDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readViewState(tenantId: string): DynamicsViewState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(viewStateStorageKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      selectedGroupId: typeof parsed.selectedGroupId === 'string' ? parsed.selectedGroupId : undefined,
      windowMode: isWindowMode(parsed.windowMode) ? parsed.windowMode : undefined,
      detailPanel: isDetailPanel(parsed.detailPanel) ? parsed.detailPanel : undefined,
      skuQuery: typeof parsed.skuQuery === 'string' ? parsed.skuQuery : undefined,
      dateFrom: typeof parsed.dateFrom === 'string' ? parsed.dateFrom : undefined,
      dateTo: typeof parsed.dateTo === 'string' ? parsed.dateTo : undefined,
    };
  } catch {
    return null;
  }
}

function writeViewState(tenantId: string, state: DynamicsViewState) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(viewStateStorageKey(tenantId), JSON.stringify(state));
  } catch {
    // localStorage may be unavailable in private mode; the page should still work.
  }
}

function metricSettingId(metric: ConfigurableMetric) {
  return metric.id ?? metric.label;
}

function defaultMetricOrder(metrics: ConfigurableMetric[], preferredOrder: string[] = []) {
  const knownIds = metrics.map(metricSettingId);
  const knownSet = new Set(knownIds);
  const preferredIds = preferredOrder.filter((id, index, list) => (
    knownSet.has(id) && list.indexOf(id) === index
  ));
  return [
    ...preferredIds,
    ...knownIds.filter((id) => !preferredIds.includes(id)),
  ];
}

function defaultMetricSettings(metrics: ConfigurableMetric[], preferredOrder: string[] = []): MetricSettings {
  return {
    order: defaultMetricOrder(metrics, preferredOrder),
    hidden: [],
  };
}

function normalizeMetricSettings(
  settings: MetricSettings | null | undefined,
  metrics: ConfigurableMetric[],
  preferredOrder: string[] = [],
): MetricSettings {
  const knownIds = metrics.map(metricSettingId);
  const knownSet = new Set(knownIds);
  const fallbackOrder = defaultMetricOrder(metrics, preferredOrder);
  const configuredOrder = (settings?.order ?? []).filter((id, index, list) => (
    knownSet.has(id) && list.indexOf(id) === index
  ));
  const order = [
    ...configuredOrder,
    ...fallbackOrder.filter((id) => !configuredOrder.includes(id)),
  ];
  const hidden = (settings?.hidden ?? []).filter((id, index, list) => (
    knownSet.has(id) && list.indexOf(id) === index
  ));

  return { order, hidden };
}

function readMetricSettings(storageKey: string, metrics: ConfigurableMetric[], preferredOrder: string[] = []): MetricSettings {
  if (typeof window === 'undefined') return defaultMetricSettings(metrics, preferredOrder);

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultMetricSettings(metrics, preferredOrder);
    const parsed = JSON.parse(raw) as Partial<MetricSettings>;
    return normalizeMetricSettings({
      order: Array.isArray(parsed.order) ? parsed.order.filter((item): item is string => typeof item === 'string') : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((item): item is string => typeof item === 'string') : [],
    }, metrics, preferredOrder);
  } catch {
    return defaultMetricSettings(metrics, preferredOrder);
  }
}

function useMetricSettings<T extends ConfigurableMetric>(storageKey: string, metrics: T[], preferredOrder: string[] = []) {
  const [settings, setSettings] = useState<MetricSettings>(() => readMetricSettings(storageKey, metrics, preferredOrder));

  const normalized = useMemo(() => normalizeMetricSettings(settings, metrics, preferredOrder), [metrics, preferredOrder, settings]);
  const hiddenSet = useMemo(() => new Set(normalized.hidden), [normalized.hidden]);
  const orderedMetrics = useMemo(() => {
    const metricById = new Map(metrics.map((metric) => [metricSettingId(metric), metric]));
    return normalized.order
      .map((id) => metricById.get(id))
      .filter((metric): metric is T => Boolean(metric));
  }, [metrics, normalized.order]);
  const visibleMetrics = useMemo(() => (
    orderedMetrics.filter((metric) => !hiddenSet.has(metricSettingId(metric)))
  ), [hiddenSet, orderedMetrics]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  }, [normalized, storageKey]);

  const reorderMetric = (draggedId: string, targetId: string) => {
    if (!draggedId || !targetId || draggedId === targetId) return;

    setSettings((prev) => {
      const next = normalizeMetricSettings(prev, metrics, preferredOrder);
      if (!next.order.includes(draggedId) || !next.order.includes(targetId)) return next;

      const withoutDragged = next.order.filter((id) => id !== draggedId);
      const targetIndex = withoutDragged.indexOf(targetId);
      if (targetIndex < 0) return next;

      const order = [...withoutDragged];
      order.splice(targetIndex, 0, draggedId);
      return { ...next, order };
    });
  };

  const toggleMetric = (id: string) => {
    setSettings((prev) => {
      const next = normalizeMetricSettings(prev, metrics, preferredOrder);
      const hidden = new Set(next.hidden);
      if (hidden.has(id)) {
        hidden.delete(id);
      } else if (next.order.length - hidden.size > 1) {
        hidden.add(id);
      }
      return { ...next, hidden: Array.from(hidden) };
    });
  };

  const hideAllMetrics = () => {
    setSettings((prev) => {
      const next = normalizeMetricSettings(prev, metrics, preferredOrder);
      return { ...next, hidden: [...next.order] };
    });
  };

  const showAllMetrics = () => {
    setSettings((prev) => {
      const next = normalizeMetricSettings(prev, metrics, preferredOrder);
      return { ...next, hidden: [] };
    });
  };

  const resetMetrics = () => setSettings(defaultMetricSettings(metrics, preferredOrder));

  return {
    orderedMetrics,
    visibleMetrics,
    hiddenSet,
    reorderMetric,
    toggleMetric,
    hideAllMetrics,
    showAllMetrics,
    resetMetrics,
  };
}

export default function DynamicsLabPage() {
  const { tenantId, dateFrom, dateTo, setDateRange } = useStore();
  const queryClient = useQueryClient();
  const [viewStateRestoredFor, setViewStateRestoredFor] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [windowMode, setWindowMode] = useState<WindowMode>('20');
  const [detailPanel, setDetailPanel] = useState<DetailPanel>('sku');
  const [isGroupMetricSettingsOpen, setIsGroupMetricSettingsOpen] = useState(false);
  const [dragOverGroupMetricId, setDragOverGroupMetricId] = useState<string | null>(null);
  const [skuQuery, setSkuQuery] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isRenamingGroup, setIsRenamingGroup] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
  const [isAddingSku, setIsAddingSku] = useState(false);
  const [skuPickerQuery, setSkuPickerQuery] = useState('');
  const [pendingSkuIds, setPendingSkuIds] = useState<number[]>([]);
  const [eventDraft, setEventDraft] = useState<CreateDynamicsGroupEventInput>({
    groupId: '',
    eventDate: dateInputValue(dateTo),
    eventType: 'note',
    title: '',
    body: '',
    assignee: '',
    dueDate: '',
    checkDate: '',
  });

  const groupsQuery = useQuery<ProductGroup[], Error>({
    queryKey: ['productGroups', tenantId],
    queryFn: () => getGroups(tenantId!),
    enabled: Boolean(tenantId),
  });

  const groups = groupsQuery.data ?? [];
  const resolvedGroupId = selectedGroupId && groups.some((group) => group.id === selectedGroupId)
    ? selectedGroupId
    : (groups[0]?.id ?? '');
  const selectedGroup = groups.find((group) => group.id === resolvedGroupId) ?? null;

  useEffect(() => {
    if (!tenantId || viewStateRestoredFor === tenantId) return;

    const timeoutId = window.setTimeout(() => {
      const stored = readViewState(tenantId);
      if (stored?.selectedGroupId) setSelectedGroupId(stored.selectedGroupId);
      if (stored?.windowMode) setWindowMode(stored.windowMode);
      if (stored?.detailPanel) setDetailPanel(stored.detailPanel);
      if (stored?.skuQuery !== undefined) setSkuQuery(stored.skuQuery);

      const storedFrom = parseStoredDate(stored?.dateFrom);
      const storedTo = parseStoredDate(stored?.dateTo);
      if (storedFrom && storedTo && storedFrom <= storedTo) {
        setDateRange(storedFrom, storedTo);
      }

      setViewStateRestoredFor(tenantId);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [setDateRange, tenantId, viewStateRestoredFor]);

  useEffect(() => {
    if (!tenantId || viewStateRestoredFor !== tenantId || groupsQuery.isLoading) return;

    writeViewState(tenantId, {
      selectedGroupId: resolvedGroupId,
      windowMode,
      detailPanel,
      skuQuery,
      dateFrom: dateInputValue(dateFrom),
      dateTo: dateInputValue(dateTo),
    });
  }, [dateFrom, dateTo, detailPanel, groupsQuery.isLoading, resolvedGroupId, skuQuery, tenantId, viewStateRestoredFor, windowMode]);

  const invalidateGroupWorkspace = () => {
    queryClient.invalidateQueries({ queryKey: ['productGroups'] });
    queryClient.invalidateQueries({ queryKey: ['dynamics-rnp-operational'] });
    queryClient.invalidateQueries({ queryKey: ['dynamicsGroupEvents'] });
  };

  const dynamicsQuery = useQuery<DynamicsResponse | null, Error>({
    queryKey: ['dynamics-rnp-operational', tenantId, resolvedGroupId, dateFrom, dateTo],
    queryFn: async () => {
      if (!tenantId || !resolvedGroupId) return null;
      const params = new URLSearchParams({
        groupId: resolvedGroupId,
        from: dateInputValue(dateFrom),
        to: dateInputValue(dateTo),
      });
      const res = await fetch(`/api/views/dynamics?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Не удалось загрузить динамику группы');
      return res.json() as Promise<DynamicsResponse>;
    },
    enabled: Boolean(tenantId && resolvedGroupId),
  });

  const eventsQuery = useQuery<DynamicsGroupEventView[], Error>({
    queryKey: ['dynamicsGroupEvents', resolvedGroupId, dateFrom, dateTo],
    queryFn: () => listDynamicsGroupEvents(resolvedGroupId, dateInputValue(dateFrom), dateInputValue(dateTo)),
    enabled: Boolean(resolvedGroupId),
  });

  const productsQuery = useQuery<ProductsResponse>({
    queryKey: ['allProducts', tenantId],
    queryFn: async () => {
      const res = await fetch('/api/views/products/options', { cache: 'no-store' });
      if (!res.ok) return { data: [] };
      return res.json() as Promise<ProductsResponse>;
    },
    enabled: Boolean(tenantId),
  });

  const createGroupMutation = useMutation({
    mutationFn: (name: string) => createGroup(tenantId!, name),
    onSuccess: (newGroup) => {
      queryClient.invalidateQueries({ queryKey: ['productGroups'] });
      setSelectedGroupId(newGroup!.id);
      setIsCreatingGroup(false);
      setNewGroupName('');
      setGroupActionError(null);
    },
    onError: (error: Error) => setGroupActionError(error.message),
  });

  const renameGroupMutation = useMutation({
    mutationFn: ({ groupId, name }: { groupId: string; name: string }) => renameGroup(groupId, name),
    onSuccess: () => {
      invalidateGroupWorkspace();
      setIsRenamingGroup(false);
      setRenameDraft('');
      setGroupActionError(null);
    },
    onError: (error: Error) => setGroupActionError(error.message),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: string) => deleteGroup(groupId),
    onSuccess: (deleted) => {
      const nextGroup = groups.find((group) => group.id !== deleted.id) ?? null;
      setSelectedGroupId(nextGroup?.id ?? '');
      setIsRenamingGroup(false);
      setRenameDraft('');
      setGroupActionError(null);
      invalidateGroupWorkspace();
    },
    onError: (error: Error) => setGroupActionError(error.message),
  });

  const addSkuMutation = useMutation({
    mutationFn: (nmIds: number[]) => addMembersToGroup(resolvedGroupId, nmIds),
    onSuccess: () => {
      setIsAddingSku(false);
      setSkuPickerQuery('');
      setPendingSkuIds([]);
      invalidateGroupWorkspace();
    },
    onError: (error: Error) => setGroupActionError(error.message),
  });

  const removeSkuMutation = useMutation({
    mutationFn: (nmId: number) => removeMemberFromGroup(resolvedGroupId, nmId),
    onSuccess: () => invalidateGroupWorkspace(),
    onError: (error: Error) => setGroupActionError(error.message),
  });

  const createEventMutation = useMutation({
    mutationFn: (input: CreateDynamicsGroupEventInput) => createDynamicsGroupEvent({ ...input, groupId: resolvedGroupId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dynamicsGroupEvents'] });
      setEventDraft((prev) => ({
        ...prev,
        groupId: resolvedGroupId,
        title: '',
        body: '',
        assignee: '',
        dueDate: '',
        checkDate: '',
      }));
    },
  });

  const productByNmId = useMemo(() => (
    new Map((productsQuery.data?.data ?? []).map((product) => [product.nmId, product]))
  ), [productsQuery.data?.data]);
  const groupSkuIds = useMemo(() => (
    new Set(Object.keys(dynamicsQuery.data?.skus ?? {}).map((nmId) => Number(nmId)))
  ), [dynamicsQuery.data?.skus]);
  const filteredSkuOptions = useMemo(() => {
    const normalized = skuPickerQuery.trim().toLowerCase();
    return (productsQuery.data?.data ?? [])
      .filter((product) => !groupSkuIds.has(product.nmId))
      .filter((product) => {
        if (!normalized) return true;
        return product.nmId.toString().includes(normalized)
          || product.vendorCode.toLowerCase().includes(normalized)
          || (product.title?.toLowerCase().includes(normalized) ?? false);
      })
      .slice(0, 120);
  }, [groupSkuIds, productsQuery.data?.data, skuPickerQuery]);

  const data = dynamicsQuery.data;
  const visibleDays = useMemo(() => (data ? pickDays(data.days, windowMode) : []), [data, windowMode]);
  const visibleGroupSeries = useMemo(() => (data ? sliceSeries(data.group, visibleDays) : {}), [data, visibleDays]);
  const summary = useMemo(() => buildSummary(visibleGroupSeries), [visibleGroupSeries]);
  const financeMeta = data?.meta?.finance;
  const financeNote = useMemo(() => financeCoverageText(financeMeta), [financeMeta]);
  const groupMetricSettings = useMetricSettings(GROUP_METRIC_SETTINGS_KEY, OPERATION_METRICS, GROUP_DEFAULT_METRIC_ORDER);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DynamicsGroupEventView[]>();
    events.forEach((event) => {
      const bucket = map.get(event.eventDate) ?? [];
      bucket.push(event);
      map.set(event.eventDate, bucket);
    });
    return map;
  }, [events]);

  const skuRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.skus).map(([nmIdRaw, series]) => {
      const nmId = Number(nmIdRaw);
      const periodSeries = sliceSeries(series, visibleDays);
      const rowSummary = buildSummary(periodSeries);
      const product = productByNmId.get(nmId);
      const stock = product?.currentStock ?? null;
      const dailyBuyouts = rowSummary.funnelBuyoutQty && visibleDays.length > 0
        ? rowSummary.funnelBuyoutQty / visibleDays.length
        : null;
      const turnoverDays = stock !== null && dailyBuyouts && dailyBuyouts > 0 ? stock / dailyBuyouts : null;
      const mainNetProfit = rowSummary.orderProjectedNetProfit ?? rowSummary.netProfit ?? 0;
      const role = mainNetProfit < 0
        ? 'утечка прибыли'
        : ((rowSummary.adSpend ?? 0) > 0 && (rowSummary.drr ?? 0) > 25
          ? 'проверить рекламу'
          : ((rowSummary.funnelOrderQty ?? rowSummary.orderQty ?? 0) > 0 ? 'рабочий SKU' : 'нет движения'));

      return {
        nmId,
        product,
        summary: rowSummary,
        stock,
        turnoverDays,
        role,
      };
    })
      .filter((row) => {
        const normalized = skuQuery.trim().toLowerCase();
        if (!normalized) return true;
        return row.nmId.toString().includes(normalized)
          || productLabel(row.product, row.nmId).toLowerCase().includes(normalized)
          || (row.product?.vendorCode?.toLowerCase().includes(normalized) ?? false);
      })
      .sort((a, b) => (
        (b.summary.orderProjectedNetProfit ?? b.summary.netProfit ?? 0)
        - (a.summary.orderProjectedNetProfit ?? a.summary.netProfit ?? 0)
      ));
  }, [data, productByNmId, skuQuery, visibleDays]);

  const groupPhotos = useMemo(() => skuRows.slice(0, 8), [skuRows]);

  const startRenamingGroup = () => {
    if (!selectedGroup) return;
    setRenameDraft(selectedGroup.name);
    setIsRenamingGroup(true);
    setGroupActionError(null);
  };

  const submitCreateGroup = () => {
    if (!newGroupName.trim()) {
      setGroupActionError('Название склейки не может быть пустым');
      return;
    }
    createGroupMutation.mutate(newGroupName);
  };

  const submitRenameGroup = () => {
    if (!selectedGroup || !renameDraft.trim()) {
      setGroupActionError('Название склейки не может быть пустым');
      return;
    }
    renameGroupMutation.mutate({ groupId: selectedGroup.id, name: renameDraft });
  };

  const submitDeleteGroup = () => {
    if (!selectedGroup) return;
    const confirmed = window.confirm(`Удалить склейку «${selectedGroup.name}»? Товары из справочника не удалятся.`);
    if (!confirmed) return;
    deleteGroupMutation.mutate(selectedGroup.id);
  };

  const togglePendingSku = (nmId: number) => {
    setPendingSkuIds((prev) => (
      prev.includes(nmId)
        ? prev.filter((value) => value !== nmId)
        : [...prev, nmId]
    ));
  };

  const closeSkuPicker = () => {
    setIsAddingSku(false);
    setSkuPickerQuery('');
    setPendingSkuIds([]);
  };

  const submitEvent = () => {
    if (!resolvedGroupId) return;
    createEventMutation.mutate({ ...eventDraft, groupId: resolvedGroupId });
  };

  const startGroupMetricDrag = (event: DragEvent<HTMLElement>, metricId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', metricId);
  };

  const dropGroupMetric = (event: DragEvent<HTMLTableRowElement>, targetId: string) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');
    groupMetricSettings.reorderMetric(draggedId, targetId);
    setDragOverGroupMetricId(null);
  };

  if (!tenantId) {
    return (
      <OperatorState
        icon={Users}
        title="Динамика (РНП) недоступна без кабинета"
        description="Выберите активный магазин, чтобы открыть операционную вкладку по склейкам."
        actionLabel="Открыть настройки"
        actionHref="/settings"
      />
    );
  }

  if (groupsQuery.error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить группы"
        description={groupsQuery.error.message}
        actionLabel="Повторить"
        action={() => groupsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(['10', '20', 'all'] as WindowMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setWindowMode(mode)}
            className={`h-10 rounded-xl px-4 text-xs font-black uppercase tracking-[0.12em] transition ${
              windowMode === mode
                ? 'bg-cyan-700 text-white shadow-sm ring-1 ring-cyan-800 hover:bg-cyan-800 dark:bg-cyan-500 dark:text-slate-950 dark:ring-cyan-300'
                : 'border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-700 dark:hover:bg-cyan-950/40'
            }`}
          >
            {mode === 'all' ? 'все дни' : `${mode} дней`}
          </button>
        ))}
      </div>

      {groupActionError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-200">
          {groupActionError}
        </div>
      ) : null}

      {isCreatingGroup ? (
        <section className="rounded-[1.75rem] border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-900/50 dark:bg-slate-950">
          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
            <FolderPlus className="h-4 w-4 text-emerald-600" />
            Новая склейка
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitCreateGroup();
                if (event.key === 'Escape') setIsCreatingGroup(false);
              }}
              placeholder="Название, например: Классики"
              className="h-11 min-w-[280px] flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              autoFocus
            />
            <button
              type="button"
              onClick={submitCreateGroup}
              disabled={!newGroupName.trim() || createGroupMutation.isPending}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createGroupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreatingGroup(false);
                setNewGroupName('');
              }}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-5 text-sm font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              Отмена
            </button>
          </div>
        </section>
      ) : null}

      {isAddingSku ? (
        <SkuPickerPanel
          products={filteredSkuOptions}
          pendingSkuIds={pendingSkuIds}
          query={skuPickerQuery}
          onQueryChange={setSkuPickerQuery}
          onToggle={togglePendingSku}
          onSelectVisible={() => {
            const next = new Set(pendingSkuIds);
            filteredSkuOptions.forEach((product) => next.add(product.nmId));
            setPendingSkuIds(Array.from(next));
          }}
          onClear={() => setPendingSkuIds([])}
          onClose={closeSkuPicker}
          onSubmit={() => addSkuMutation.mutate(pendingSkuIds)}
          isPending={addSkuMutation.isPending}
        />
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="grid gap-3 border-b border-slate-200 p-4 dark:border-slate-800 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Склейка</div>
              <div className="flex -space-x-2">
                {groupPhotos.map((row) => (
                  <div key={row.nmId} className="h-9 w-9 overflow-hidden rounded-xl border-2 border-white bg-white shadow-sm dark:border-slate-950 dark:bg-slate-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={resolvePhoto(row.product, row.nmId)} alt={productLabel(row.product, row.nmId)} className="h-full w-full object-contain" loading="lazy" referrerPolicy="no-referrer" />
                  </div>
                ))}
              </div>
              <div className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:ring-emerald-800/50">
                активна
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {isRenamingGroup && selectedGroup ? (
                <div className="flex min-w-[280px] flex-1 gap-2">
                  <input
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitRenameGroup();
                      if (event.key === 'Escape') setIsRenamingGroup(false);
                    }}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-slate-950 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={submitRenameGroup}
                    disabled={!renameDraft.trim() || renameGroupMutation.isPending}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Сохранить название"
                  >
                    {renameGroupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRenamingGroup(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    aria-label="Отменить переименование"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <select
                  className="h-10 min-w-[280px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-slate-950 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  value={resolvedGroupId}
                  onChange={(event) => {
                    setSelectedGroupId(event.target.value);
                    setGroupActionError(null);
                  }}
                >
                  <option value="">Выберите склейку...</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              )}

              <div className="text-sm font-bold text-slate-500 dark:text-slate-400">
                {skuRows.length.toLocaleString('ru-RU')} SKU · {visibleDays.length.toLocaleString('ru-RU')} дней
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCreatingGroup(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white transition hover:bg-emerald-700"
            >
              <FolderPlus className="h-4 w-4" />
              Создать
            </button>
            <button
              type="button"
              onClick={() => setIsAddingSku(true)}
              disabled={!resolvedGroupId}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-3 text-xs font-black text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              SKU
            </button>
            <button
              type="button"
              onClick={startRenamingGroup}
              disabled={!selectedGroup || isRenamingGroup || renameGroupMutation.isPending || deleteGroupMutation.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:bg-slate-900/40"
            >
              <Pencil className="h-4 w-4" />
              Название
            </button>
            <button
              type="button"
              onClick={submitDeleteGroup}
              disabled={!selectedGroup || deleteGroupMutation.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-200 dark:hover:bg-rose-900/30 dark:disabled:bg-slate-900/40"
            >
              {deleteGroupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </button>
          </div>
        </div>

        <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-7">
          <KpiCard icon={Receipt} label="ЧП с рекламой" value={formatCurrency(summary.orderProjectedNetProfit)} tone={(summary.orderProjectedNetProfit ?? 0) >= 0 ? 'good' : 'bad'} help="Главная оперативная чистая прибыль по текущим заказам: заказная выручка минус расчетные расходы WB, себестоимость, реклама и налог." />
          <KpiCard icon={BarChart3} label="ЧП факт WB" value={formatCurrency(summary.netProfit)} tone={(summary.netProfit ?? 0) >= 0 ? 'good' : 'bad'} help="Фактическая чистая прибыль по WB realization и оперативному хвосту продаж. Нужна для сверки с прогнозом по заказам." />
          <KpiCard icon={Megaphone} label="Реклама" value={formatCurrency(summary.adSpend)} tone="warn" help="Сумма рекламных расходов по всем артикулам склейки. Нужна, чтобы видеть общий бюджет, даже если реклама идет на один товар." />
          <KpiCard icon={ShoppingCart} label="Цена заказа" value={formatCurrency(costPerOrder(summary))} tone="warn" help="Средний рекламный расход на один заказ всей склейки. Считаем общий рекламный расход и делим на все заказы склейки." />
          <KpiCard icon={TrendingDown} label="ДРР склейки" value={formatPercent(drrByOrderRevenue(summary))} tone={(drrByOrderRevenue(summary) ?? 0) <= 15 ? 'good' : 'warn'} help="Показывает, какую долю от суммы заказов забрала реклама. Чем выше процент, тем тяжелее реклама давит на результат." />
          <KpiCard icon={ShoppingCart} label="Заказы" value={formatQty(summary.funnelOrderQty ?? summary.orderQty)} tone="info" help="Все заказы по артикулам внутри склейки за выбранное окно. Это быстрый показатель спроса." />
          <KpiCard icon={BarChart3} label="CTR рекламы" value={formatPercent(ctrPercent(summary))} tone="neutral" help="Доля кликов от рекламных показов. Помогает понять, реагируют ли покупатели на рекламу и карточку." />
        </div>
      </section>

      {!groupsQuery.isLoading && groups.length === 0 ? (
        <OperatorState
          icon={Users}
          title="Пока нет групп SKU"
          description="Создайте первую склейку здесь, затем добавьте в нее нужные артикулы."
          actionLabel="Создать склейку"
          action={() => setIsCreatingGroup(true)}
        />
      ) : null}

      {dynamicsQuery.isLoading || groupsQuery.isLoading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-[1.75rem] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-cyan-600" />
            <p className="mt-4 text-sm font-bold text-slate-500">Собираем дневную динамику...</p>
          </div>
        </div>
      ) : null}

      {dynamicsQuery.error ? (
        <OperatorState
          icon={AlertTriangle}
          tone="danger"
          title="Не удалось собрать динамику"
          description={dynamicsQuery.error.message}
          actionLabel="Повторить"
          action={() => dynamicsQuery.refetch()}
        />
      ) : null}

      {data ? (
        <section className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
              <div className="flex min-w-0 items-center gap-2">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Склейка</div>
                <div className="flex -space-x-1.5">
                  {groupPhotos.map((row) => (
                    <div key={row.nmId} className="h-8 w-8 overflow-hidden rounded-lg border-2 border-white bg-white shadow-sm dark:border-slate-950 dark:bg-slate-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolvePhoto(row.product, row.nmId)} alt={productLabel(row.product, row.nmId)} className="h-full w-full object-contain" loading="lazy" referrerPolicy="no-referrer" />
                    </div>
                  ))}
                </div>
                <div className="truncate text-xs font-black text-slate-600 dark:text-slate-300">
                  {selectedGroup?.name ?? 'Без склейки'} · {skuRows.length.toLocaleString('ru-RU')} SKU
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {financeNote ? (
                  <div className="inline-flex max-w-[520px] items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-[11px] font-bold text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span>{financeNote}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsGroupMetricSettingsOpen((value) => !value)}
                  className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:self-end"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Метрики
                </button>
              </div>
            </div>

            <QuickEventBar
              draft={eventDraft}
              eventsCount={events.length}
              onChange={setEventDraft}
              onSubmit={submitEvent}
              isPending={createEventMutation.isPending}
              error={createEventMutation.error?.message}
              disabled={!resolvedGroupId}
            />

            {isGroupMetricSettingsOpen ? (
              <MetricSettingsPanel
                metrics={groupMetricSettings.orderedMetrics}
                hiddenSet={groupMetricSettings.hiddenSet}
                onToggle={groupMetricSettings.toggleMetric}
                onHideAll={groupMetricSettings.hideAllMetrics}
                onShowAll={groupMetricSettings.showAllMetrics}
                onReset={groupMetricSettings.resetMetrics}
              />
            ) : null}

            <div className="max-h-[72vh] overflow-auto">
              <table className="w-full min-w-[1040px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-cyan-900 bg-slate-950 text-[10px] font-black uppercase tracking-[0.1em] text-white dark:border-cyan-800">
                    <th className="sticky left-0 top-0 z-40 w-[200px] min-w-[200px] border-r border-slate-700 bg-slate-950 px-2 py-2 text-left shadow-[8px_0_18px_-16px_rgba(15,23,42,0.65)]">Метрика</th>
                    <th className="sticky left-[200px] top-0 z-40 w-[108px] min-w-[108px] border-r border-emerald-500/40 bg-emerald-600 px-2 py-2 text-right text-white shadow-[8px_0_18px_-16px_rgba(15,23,42,0.65)]">Итого</th>
                    {visibleDays.map((day) => (
                      <th key={day} className="sticky top-0 z-30 w-[96px] min-w-[96px] bg-cyan-950 px-2 py-2 text-right text-cyan-50">{day}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupMetricSettings.visibleMetrics.map((metric) => {
                    const metricId = metricSettingId(metric);
                    const dailyValues = visibleDays.map((day) => metric.getValue(data.group[day] ?? {}));
                    const direction = performanceDirection(metric);

                    return (
                      <tr
                        key={metric.label}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setDragOverGroupMetricId(metricId);
                        }}
                        onDragLeave={() => setDragOverGroupMetricId((current) => (current === metricId ? null : current))}
                        onDrop={(event) => dropGroupMetric(event, metricId)}
                        className={`border-b border-slate-200 transition-colors dark:border-slate-800 ${dragOverGroupMetricId === metricId ? 'bg-cyan-50/70 dark:bg-cyan-950/30' : ''}`}
                      >
                        <td className={`sticky left-0 z-20 w-[200px] min-w-[200px] border-r border-slate-200 px-2 py-2 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 ${dragOverGroupMetricId === metricId ? 'bg-cyan-50 dark:bg-cyan-950/30' : 'bg-white dark:bg-slate-950'}`}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              draggable
                              onDragStart={(event) => startGroupMetricDrag(event, metricId)}
                              onDragEnd={() => setDragOverGroupMetricId(null)}
                              className="inline-flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-cyan-700 active:cursor-grabbing dark:text-slate-500 dark:hover:bg-slate-900 dark:hover:text-cyan-300"
                              aria-label={`Перетащить строку ${metric.label}`}
                              title="Потяни, чтобы изменить порядок строки"
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </button>
                            <MetricDot tone={metric.tone} />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-1 font-black leading-none text-slate-900 dark:text-slate-100">
                                <span className="truncate">{metric.label}</span>
                                <MetricHelp text={metric.help} />
                              </div>
                              <div className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">{metric.source}</div>
                            </div>
                          </div>
                        </td>
                        <td className={`sticky left-[200px] z-20 w-[108px] min-w-[108px] border-r border-slate-200 px-2 py-2 text-right text-sm font-black text-slate-950 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:text-slate-100 ${dragOverGroupMetricId === metricId ? 'bg-cyan-50 dark:bg-cyan-950/30' : 'bg-slate-50 dark:bg-slate-900'}`}>
                          {formatMetric(metric.getTotal(summary), metric.kind)}
                        </td>
                        {visibleDays.map((day, index) => {
                          const value = dailyValues[index];
                          return (
                            <td key={day} className={`px-2 py-2 text-right text-sm font-bold tabular-nums text-slate-800 transition-colors dark:text-slate-200 ${heatCellClass(value, dailyValues, direction)}`}>
                              {formatMetric(value, metric.kind)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="sticky left-0 z-20 w-[200px] min-w-[200px] border-r border-slate-200 bg-white px-2 py-2 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950">
                      <div className="flex items-center gap-2">
                        <MetricDot tone="neutral" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1 font-black text-slate-900 dark:text-slate-100">
                            <span className="truncate">Действия / задачи</span>
                            <MetricHelp text="Здесь показываем записи из операционного журнала: что поменяли, кому поставили задачу и когда нужно проверить эффект." />
                          </div>
                          <div className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">операционный журнал</div>
                        </div>
                      </div>
                    </td>
                    <td className="sticky left-[200px] z-20 w-[108px] min-w-[108px] border-r border-slate-200 bg-slate-50 px-2 py-2 text-right text-sm font-black shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-900">
                      {events.length.toLocaleString('ru-RU')}
                    </td>
                    {visibleDays.map((day) => {
                      const dayEvents = eventsByDay.get(dayLabelToIso(day)) ?? [];
                      return (
                        <td key={day} className="px-2 py-2 align-top">
                          <div className="flex min-h-8 flex-col items-end gap-1">
                            {dayEvents.length ? dayEvents.slice(0, 3).map((event) => (
                              <EventChip key={event.id} event={event} compact />
                            )) : <span className="text-slate-300">—</span>}
                            {dayEvents.length > 3 ? <span className="text-[11px] font-bold text-slate-400">+{dayEvents.length - 3}</span> : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
        </section>
      ) : null}

      {data ? (
        <section className="rounded-[1.75rem] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setDetailPanel('sku')}
              className={`rounded-2xl px-4 py-2 text-sm font-black transition ${detailPanel === 'sku' ? 'bg-cyan-700 text-white shadow-sm ring-1 ring-cyan-800 dark:bg-cyan-500 dark:text-slate-950 dark:ring-cyan-300' : 'border border-slate-300 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-700 dark:hover:bg-cyan-950/40'}`}
            >
              SKU в склейке
            </button>
            <button
              type="button"
              onClick={() => setDetailPanel('formulas')}
              className={`rounded-2xl px-4 py-2 text-sm font-black transition ${detailPanel === 'formulas' ? 'bg-cyan-700 text-white shadow-sm ring-1 ring-cyan-800 dark:bg-cyan-500 dark:text-slate-950 dark:ring-cyan-300' : 'border border-slate-300 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-700 dark:hover:bg-cyan-950/40'}`}
            >
              Формулы и источники
            </button>
          </div>
          <div className="p-5">
            {detailPanel === 'sku' ? (
              <SkuPanel
                rows={skuRows}
                dynamics={data.skus}
                visibleDays={visibleDays}
                query={skuQuery}
                onQueryChange={setSkuQuery}
                onRemoveSku={(nmId) => removeSkuMutation.mutate(nmId)}
                removingSkuId={removeSkuMutation.variables ?? null}
              />
            ) : (
              <FormulasPanel summary={summary} />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone, help }: { icon: LucideIcon; label: string; value: string; tone: 'good' | 'bad' | 'warn' | 'info' | 'neutral'; help: string }) {
  const toneClass = {
    good: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:ring-emerald-800/50',
    bad: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/20 dark:text-rose-200 dark:ring-rose-800/50',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-800/50',
    info: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:ring-cyan-800/50',
    neutral: 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800',
  }[tone];

  return (
    <div className={`rounded-xl p-3 ring-1 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em]">
          <span className="opacity-80">{label}</span>
          <MetricHelp text={help} />
        </div>
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-2 text-lg font-black tracking-tight">{value}</div>
    </div>
  );
}

function MetricHelp({ text }: { text: string }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const show = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = Math.min(380, window.innerWidth - 24);
    setPosition({
      top: Math.max(12, rect.top - 10),
      left: Math.min(Math.max(rect.left + rect.width / 2, tooltipWidth / 2 + 12), window.innerWidth - tooltipWidth / 2 - 12),
    });
  };

  return (
    <span
      className="inline-flex shrink-0"
      title={text}
      aria-label={text}
      tabIndex={0}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setPosition(null)}
    >
      <CircleHelp className="h-3.5 w-3.5 cursor-help text-slate-400 transition hover:text-cyan-600 focus:text-cyan-600 dark:text-slate-500 dark:hover:text-cyan-300" />
      {position ? createPortal(
        <span
          className="pointer-events-none fixed z-[9999] rounded-xl border border-slate-200 bg-white p-3 text-left text-xs font-semibold normal-case leading-5 tracking-normal text-slate-700 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          style={{
            top: position.top,
            left: position.left,
            width: 'min(380px, calc(100vw - 24px))',
            transform: 'translate(-50%, -100%)',
          }}
        >
          {text}
        </span>,
        document.body,
      ) : null}
      </span>
  );
}

function MetricSettingsPanel({
  metrics,
  hiddenSet,
  onToggle,
  onHideAll,
  onShowAll,
  onReset,
}: {
  metrics: ConfigurableMetric[];
  hiddenSet: Set<string>;
  onToggle: (id: string) => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onReset: () => void;
}) {
  const visibleCount = metrics.length - hiddenSet.size;

  return (
    <div className="border-b border-slate-200 bg-slate-50/90 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">Метрики</div>
          <div className="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400">Включено {visibleCount}/{metrics.length}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onHideAll}
            disabled={visibleCount === 0}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <X className="h-3.5 w-3.5" />
            Снять все
          </button>
          <button
            type="button"
            onClick={onShowAll}
            disabled={visibleCount === metrics.length}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-[11px] font-black text-cyan-700 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200 dark:hover:bg-cyan-950"
          >
            <Check className="h-3.5 w-3.5" />
            Выделить все
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Сброс
          </button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-3 2xl:grid-cols-4">
        {metrics.map((metric) => {
          const id = metricSettingId(metric);
          const hidden = hiddenSet.has(id);
          const isOnlyVisible = !hidden && visibleCount <= 1;

          return (
            <button
              type="button"
              key={id}
              onClick={() => onToggle(id)}
              disabled={isOnlyVisible}
              className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                hidden
                  ? 'border-slate-200 bg-white/60 text-slate-400 hover:bg-white dark:border-slate-800 dark:bg-slate-950/50 dark:hover:bg-slate-950'
                  : 'border-cyan-200 bg-white text-slate-900 shadow-sm hover:border-cyan-300 dark:border-cyan-900/60 dark:bg-slate-950 dark:text-slate-100'
              }`}
            >
              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                hidden
                  ? 'border-slate-200 bg-slate-50 text-transparent dark:border-slate-800 dark:bg-slate-900'
                  : 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200'
              }`}>
                <Check className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black">{metric.label}</div>
                {metric.source ? <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{metric.source}</div> : null}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${
                hidden
                  ? 'bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-500'
                  : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-200'
              }`}>
                {hidden ? 'Откл' : 'Вкл'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MetricDot({ tone }: { tone: OperationMetric['tone'] }) {
  const className = {
    profit: 'bg-emerald-500',
    ads: 'bg-rose-500',
    orders: 'bg-amber-500',
    neutral: 'bg-slate-400',
    risk: 'bg-cyan-500',
  }[tone];

  return <span className={`h-2.5 w-2.5 rounded-full ${className}`} />;
}

function EventChip({ event, compact = false }: { event: DynamicsGroupEventView; compact?: boolean }) {
  const meta = EVENT_TYPE_META[event.eventType];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex max-w-[150px] items-center gap-1 rounded-full px-2 py-1 text-[11px] font-black ${meta.className}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{compact ? meta.label : event.title}</span>
    </span>
  );
}

function QuickEventBar({
  draft,
  eventsCount,
  onChange,
  onSubmit,
  isPending,
  error,
  disabled,
}: {
  draft: CreateDynamicsGroupEventInput;
  eventsCount: number;
  onChange: (draft: CreateDynamicsGroupEventInput) => void;
  onSubmit: () => void;
  isPending: boolean;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2 border-b border-slate-200 bg-slate-50/80 p-2 dark:border-slate-800 dark:bg-slate-900/40 xl:grid-cols-[auto_126px_145px_minmax(180px,1fr)_130px_126px_auto]">
      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
        <Plus className="h-3.5 w-3.5 text-cyan-600" />
        Запись
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
          {eventsCount.toLocaleString('ru-RU')}
        </span>
      </div>

      <input
        type="date"
        value={draft.eventDate}
        onChange={(event) => onChange({ ...draft, eventDate: event.target.value })}
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
      <select
        value={draft.eventType}
        onChange={(event) => onChange({ ...draft, eventType: event.target.value as DynamicsGroupEventType })}
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      >
        {Object.entries(EVENT_TYPE_META).map(([type, meta]) => (
          <option key={type} value={type}>{meta.label}</option>
        ))}
      </select>
      <input
        value={draft.title}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        placeholder="Что сделали или что проверить"
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
      <input
        value={draft.assignee ?? ''}
        onChange={(event) => onChange({ ...draft, assignee: event.target.value })}
        placeholder="Ответственный"
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
      <input
        type="date"
        value={draft.checkDate ?? ''}
        onChange={(event) => onChange({ ...draft, checkDate: event.target.value })}
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || isPending || !draft.title.trim()}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-cyan-700 px-3 text-xs font-black text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Записать
      </button>

      {error ? (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-900/20 dark:text-rose-200 xl:col-span-7">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SkuPickerPanel({
  products,
  pendingSkuIds,
  query,
  onQueryChange,
  onToggle,
  onSelectVisible,
  onClear,
  onClose,
  onSubmit,
  isPending,
}: {
  products: ProductOption[];
  pendingSkuIds: number[];
  query: string;
  onQueryChange: (value: string) => void;
  onToggle: (nmId: number) => void;
  onSelectVisible: () => void;
  onClear: () => void;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const pendingSet = new Set(pendingSkuIds);

  return (
    <section className="rounded-[1.75rem] border border-cyan-200 bg-white p-4 shadow-sm dark:border-cyan-900/50 dark:bg-slate-950">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900 dark:text-slate-100">Добавить товары в склейку</div>
          <div className="mt-1 text-xs font-bold text-slate-400">Выбрано: {pendingSkuIds.length.toLocaleString('ru-RU')}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSelectVisible}
            className="h-9 rounded-xl bg-slate-100 px-3 text-xs font-black text-slate-600 transition hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Выбрать видимые
          </button>
          <button
            type="button"
            onClick={onClear}
            className="h-9 rounded-xl bg-slate-100 px-3 text-xs font-black text-slate-600 transition hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Очистить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            aria-label="Закрыть выбор товаров"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Поиск по nmID, артикулу или названию"
          className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      <div className="max-h-[420px] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        {products.length === 0 ? (
          <div className="p-6 text-center text-sm font-bold text-slate-400">Нет товаров для добавления по текущему поиску</div>
        ) : null}
        {products.map((product) => {
          const checked = pendingSet.has(product.nmId);
          return (
            <button
              key={product.nmId}
              type="button"
              onClick={() => onToggle(product.nmId)}
              className={`flex w-full items-center gap-3 border-b border-slate-200 px-4 py-3 text-left transition last:border-b-0 dark:border-slate-800 ${
                checked ? 'bg-cyan-50 dark:bg-cyan-900/20' : 'bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900'
              }`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-300 dark:border-slate-700'}`}>
                {checked ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolvePhoto(product, product.nmId)} alt={productLabel(product, product.nmId)} className="h-full w-full object-contain" loading="lazy" referrerPolicy="no-referrer" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{productLabel(product, product.nmId)}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">nmID {product.nmId} · {product.vendorCode || 'без артикула'}</div>
              </div>
              <div className="hidden text-right text-xs font-bold text-slate-400 sm:block">
                <div>остаток {formatQty(product.currentStock ?? null)}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={pendingSkuIds.length === 0 || isPending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 text-sm font-black text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Добавить выбранные
        </button>
      </div>
    </section>
  );
}

function SkuPanel({
  rows,
  dynamics,
  visibleDays,
  query,
  onQueryChange,
  onRemoveSku,
  removingSkuId,
}: {
  rows: SkuRowView[];
  dynamics: Record<number, DynamicsSeries>;
  visibleDays: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onRemoveSku: (nmId: number) => void;
  removingSkuId: number | null;
}) {
  const [expandedSkuIds, setExpandedSkuIds] = useState<Record<number, boolean>>({});
  const [isMetricSettingsOpen, setIsMetricSettingsOpen] = useState(false);
  const [dragOverSkuMetricId, setDragOverSkuMetricId] = useState<string | null>(null);
  const skuMetricSettings = useMetricSettings(SKU_METRIC_SETTINGS_KEY, SKU_EXPANDED_METRICS, SKU_DEFAULT_METRIC_ORDER);

  const toggleExpanded = (nmId: number) => {
    setExpandedSkuIds((prev) => ({ ...prev, [nmId]: !prev[nmId] }));
  };

  const startSkuMetricDrag = (event: DragEvent<HTMLElement>, metricId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', metricId);
  };

  const dropSkuMetric = (event: DragEvent<HTMLTableRowElement>, targetId: string) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain');
    skuMetricSettings.reorderMetric(draggedId, targetId);
    setDragOverSkuMetricId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Артикулы в склейке</div>
          <div className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Строка SKU показывает ЧП по дням, раскрытие — полный операционный набор</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsMetricSettingsOpen((value) => !value)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Метрики
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Поиск SKU"
              className="h-9 min-w-[220px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-bold outline-none focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>
        </div>
      </div>

      {isMetricSettingsOpen ? (
        <MetricSettingsPanel
          metrics={skuMetricSettings.orderedMetrics}
          hiddenSet={skuMetricSettings.hiddenSet}
          onToggle={skuMetricSettings.toggleMetric}
          onHideAll={skuMetricSettings.hideAllMetrics}
          onShowAll={skuMetricSettings.showAllMetrics}
          onReset={skuMetricSettings.resetMetrics}
        />
      ) : null}

      <div className="max-h-[76vh] overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[1120px] border-collapse text-xs">
          <thead className="text-left text-[10px] font-black uppercase tracking-[0.1em] text-white">
            <tr>
              <th className="sticky left-0 top-0 z-40 w-[240px] min-w-[240px] border-r border-slate-700 bg-slate-950 px-2 py-2 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.65)]">Артикул</th>
              <th className="sticky left-[240px] top-0 z-40 w-[108px] min-w-[108px] border-r border-emerald-500/40 bg-emerald-600 px-2 py-2 text-right text-white shadow-[8px_0_18px_-16px_rgba(15,23,42,0.65)]">Итого</th>
              {visibleDays.map((day) => (
                <th key={day} className="sticky top-0 z-30 w-[96px] min-w-[96px] bg-cyan-950 px-2 py-2 text-right text-cyan-50">{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleDays.length + 2} className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                  В склейке пока нет артикулов по текущему фильтру.
                </td>
              </tr>
            ) : null}

            {rows.map((row) => {
                const series = dynamics[row.nmId] ?? {};
                const isExpanded = Boolean(expandedSkuIds[row.nmId]);
                const metrics = skuMetricSettings.visibleMetrics;
                const netProfitValues = visibleDays.map((day) => numberOrNull(series[day]?.orderProjectedNetProfit));
                return (
                  <Fragment key={row.nmId}>
                    <tr className="border-t border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
                      <td
                        className="sticky left-0 z-20 w-[240px] min-w-[240px] cursor-pointer border-r border-slate-200 bg-slate-50 px-2 py-2 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-900"
                        onClick={() => toggleExpanded(row.nmId)}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={resolvePhoto(row.product, row.nmId)} alt={productLabel(row.product, row.nmId)} className="h-full w-full object-contain" loading="lazy" referrerPolicy="no-referrer" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black leading-none text-slate-900 dark:text-slate-100">{shortText(productLabel(row.product, row.nmId), 28)}</div>
                            <div className="mt-0.5 truncate text-[10px] font-bold text-slate-400">nmID {row.nmId} · {row.product?.vendorCode || 'без артикула'}</div>
                            <span className="mt-0.5 inline-flex rounded-full bg-white px-1.5 py-0 text-[9px] font-black text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                              {row.role}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRemoveSku(row.nmId);
                            }}
                            disabled={removingSkuId === row.nmId}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-900/20"
                            aria-label={`Удалить ${row.nmId} из склейки`}
                          >
                            {removingSkuId === row.nmId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="sticky left-[240px] z-20 w-[108px] min-w-[108px] border-r border-slate-200 bg-slate-100 px-2 py-2 text-right text-sm font-black text-slate-950 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100">
                        {formatCurrency(row.summary.orderProjectedNetProfit)}
                      </td>
                      {visibleDays.map((day, index) => (
                        <td key={day} className={`px-2 py-2 text-right text-sm font-bold tabular-nums text-slate-800 transition-colors dark:text-slate-200 ${heatCellClass(netProfitValues[index], netProfitValues, 'higher')}`}>
                          {formatCurrency(netProfitValues[index])}
                        </td>
                      ))}
                    </tr>

                    {isExpanded ? metrics.map((metric) => {
                      const metricId = metricSettingId(metric);
                      const dailyValues = visibleDays.map((day) => (
                        metric.getDaily ? metric.getDaily(series[day] ?? {}) : null
                      ));
                      const direction = performanceDirection(metric);

                      return (
                        <tr
                          key={`${row.nmId}-${metric.id}`}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDragOverSkuMetricId(metricId);
                          }}
                          onDragLeave={() => setDragOverSkuMetricId((current) => (current === metricId ? null : current))}
                          onDrop={(event) => dropSkuMetric(event, metricId)}
                          className={`border-t border-slate-200 transition-colors dark:border-slate-800 ${dragOverSkuMetricId === metricId ? 'bg-cyan-50/70 dark:bg-cyan-950/30' : ''}`}
                        >
                          <td className={`sticky left-0 z-20 w-[240px] min-w-[240px] border-r border-slate-200 px-2 py-2 pl-6 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 ${dragOverSkuMetricId === metricId ? 'bg-cyan-50 dark:bg-cyan-950/30' : 'bg-white dark:bg-slate-950'}`}>
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => startSkuMetricDrag(event, metricId)}
                                onDragEnd={() => setDragOverSkuMetricId(null)}
                                className="mt-[-2px] inline-flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-cyan-700 active:cursor-grabbing dark:text-slate-500 dark:hover:bg-slate-900 dark:hover:text-cyan-300"
                                aria-label={`Перетащить строку ${metric.label}`}
                                title="Потяни, чтобы изменить порядок строки"
                              >
                                <GripVertical className="h-3.5 w-3.5" />
                              </button>
                              <MetricDot tone={metric.tone} />
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1 font-black leading-none text-slate-900 dark:text-slate-100">
                                  <span className="truncate">{metric.label}</span>
                                  <MetricHelp text={metric.help} />
                                </div>
                                <div className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">{metric.source}</div>
                              </div>
                            </div>
                          </td>
                          <td className={`sticky left-[240px] z-20 w-[108px] min-w-[108px] border-r border-slate-200 px-2 py-2 text-right text-sm font-black text-slate-950 shadow-[8px_0_18px_-16px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:text-slate-100 ${dragOverSkuMetricId === metricId ? 'bg-cyan-50 dark:bg-cyan-950/30' : 'bg-slate-50 dark:bg-slate-900'}`}>
                            {formatMetric(metric.getTotal(row), metric.kind)}
                          </td>
                          {visibleDays.map((day, index) => {
                            const dailyValue = dailyValues[index];
                            return (
                              <td key={day} className={`px-2 py-2 text-right text-sm font-bold tabular-nums text-slate-700 transition-colors dark:text-slate-300 ${heatCellClass(dailyValue, dailyValues, direction)}`}>
                                {metric.getDaily ? formatMetric(dailyValue, metric.kind) : <span className="text-slate-300">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }) : null}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormulasPanel({ summary }: { summary: Summary }) {
  const formulas = [
    ['ЧП с рекламой', 'Берем сумму заказов, применяем ставки WB, вычитаем логистику заказов, себестоимость, рекламу, хранение и налог. Логистику прогнозируем по ожидаемым выкупам, а тарифы используем только как последний fallback.'],
    ['ЧП факт WB', 'Берем финансовый результат по WB realization и оперативному хвосту продаж для сверки с прогнозом.'],
    ['ЧП без рекламы', 'Берем прогноз ЧП по заказам и добавляем обратно рекламный расход, чтобы увидеть товар без влияния рекламы.'],
    ['Цена заказа склейки', 'Рекламный расход всей склейки делим на количество заказов всей склейки.'],
    ['Оборот заказов до СПП', 'Количество заказов умножаем на цену до СПП из дневного снимка цен, при отсутствии снимка берем сумму заказов WB.'],
    ['Выручка после СПП', 'Количество заказов умножаем на цену после СПП из дневного снимка цен.'],
    ['Логистика заказов', 'Формула: заказы × ожидаемый % выкупа × актуальная средняя логистика WB до клиента. Приоритет: фиксация/история по остаткам, фиксация SKU, факт WB, история SKU, история склейки, затем тарифный fallback.'],
    ['Тарифный fallback', 'Синхронизирован с юнит-экономикой: до 1 л берем WB-сетку 23/26/29/30/32 × коэффициент склада, после 1 л — base+liter из WB. При наличии локализации добавляем ИЛ/КТР и КРП/ИРП.'],
    ['Средний чек заказа', 'Оборот заказов до СПП всей склейки делим на количество заказов всей склейки.'],
    ['ДРР склейки', `Рекламный расход всей склейки делим на ${summary.drrBaseLabel}.`],
    ['CTR рекламы', 'Клики по рекламе делим на рекламные показы и переводим в процент.'],
    ['% выкупа WB', summary.buyoutBaseLabel],
    ['Предварительный % выкупа', 'Берем надежный WB-процент за 13 недель, а если данных мало — ручной процент из активного сценария юнит-экономики.'],
    ['Прибыль / шт', 'Чистую прибыль делим на количество выкупленных товаров.'],
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {formulas.map(([label, formula]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
            <div className="mt-2 text-sm font-black text-slate-900 dark:text-slate-100">{formula}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {PRACTICE_RULES.map((rule, index) => (
          <div key={rule} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/12 text-xs font-black text-cyan-700 dark:text-cyan-200">{index + 1}</div>
            <p className="text-xs font-bold leading-5 text-slate-600 dark:text-slate-300">{rule}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {RESEARCH_SOURCES.map((source) => (
          <a
            key={source.href}
            href={source.href}
            target="_blank"
            rel="noreferrer"
            className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-cyan-300 hover:bg-white dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-cyan-800 dark:hover:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-slate-100">{source.title}</div>
                <div className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-slate-400">{source.label}</div>
              </div>
              <ExternalLink className="h-4 w-4 text-slate-400 transition group-hover:text-cyan-600" />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{source.note}</p>
          </a>
        ))}
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-900/20 dark:text-emerald-100">
        <div className="mb-2 flex items-center gap-2 font-black">
          <ShieldCheck className="h-4 w-4" />
          Источник решения
        </div>
        Вкладка берет деньги из финансового отчета, спрос из воронки продаж, рекламу из рекламного кабинета, цены из дневных снимков СПП, остатки из истории складских снимков, а резервные заказы и продажи использует только если основной слой не пришел.
      </div>
    </div>
  );
}
