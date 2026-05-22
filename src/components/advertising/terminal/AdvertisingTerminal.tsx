'use client';

import Image from 'next/image';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  CirclePause,
  Columns3,
  Crosshair,
  GripHorizontal,
  Loader2,
  Search,
  ShieldCheck,
  TrendingDown,
} from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';

import {
  dayLabel,
  formatDecimal,
  formatDateTime,
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
  statusLabel,
} from '../_shared/format';
import type {
  AdvertisingOverviewResponse,
  AdvertisingProductListRow,
  AdvertisingProductsResponse,
} from '../_shared/types';

type Props = {
  tenantId: string;
  fromParam: string;
  toParam: string;
  onOpenWorkspace?: (nmId: number) => void;
};

type TerminalMode = 'campaigns' | 'products';
type ColumnPreset = 'control' | 'analytics' | 'full';
type RiskFilter = 'all' | 'danger' | 'warning' | 'good' | 'group' | 'active' | 'paused';
type DetailTab = 'days' | 'queries' | 'positions' | 'stocks' | 'actions';

type StrategyRecord = {
  id: string;
  name: string;
  advertId: number;
  nmId: number;
  mode: 'classic' | 'self_learning';
  biddingMode: 'drr' | 'cpm' | 'roas' | 'hybrid';
  targetAcosPct: number;
  maxCpcRub: number;
  minBid: number;
  maxBid: number;
  isEnabled: boolean;
  dryRun: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
};

type StrategyRun = {
  id: string;
  strategyId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
};

type StrategyRecentChange = {
  id: string;
  strategyId: string;
  cluster: string;
  previousBid: number | null;
  nextBid: number | null;
  status: string;
  reason: string | null;
  metrics: Record<string, unknown>;
  createdAt: string;
};

type StrategiesResponse = {
  generatedAt: string;
  strategies: StrategyRecord[];
  runs: StrategyRun[];
  recentChanges: StrategyRecentChange[];
};

type DecisionCenterCampaignRow = {
  advertId: number;
  nmId: number | null;
  status: number | null;
  type: number | null;
  bidType: string | null;
  paymentType: string | null;
  searchPlacement: boolean;
  recommendationPlacement: boolean;
  productTitle: string | null;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  adSpend: number;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
  acosPct: number | null;
  cpc: number | null;
  ctrPct: number | null;
  roas: number | null;
  cpo: number | null;
  skuCount: number;
  activeDays: number;
  lastDataAt: string | null;
  todayAdSpend: number;
  todayRevenue: number;
  todayOrders: number;
  yesterdayAdSpend: number;
  yesterdayRevenue: number;
  yesterdayOrders: number;
  openCards: number;
  carts: number;
  funnelOrders: number;
  cartRatePct: number | null;
  cartToOrderPct: number | null;
  currentSearchBidRub: number | null;
  currentRecommendationBidRub: number | null;
  minBidRub: number | null;
  maxBidRub: number | null;
  budgetCashRub: number | null;
  budgetNettingRub: number | null;
  budgetTotalRub: number | null;
  budgetLoadedAt: string | null;
  avgPosition: number | null;
  bestPosition: number | null;
  positionSamples: number;
  positionKeywords: number;
  positionUpdatedAt: string | null;
  searchClusterCount: number;
  searchClusterViews: number;
  searchClusterClicks: number;
  searchClusterOrders: number;
  searchClusterSpend: number;
  searchClusterCtrPct: number | null;
  searchClusterCpc: number | null;
  campaignCreatedAt: string | null;
  campaignStartedAt: string | null;
  campaignUpdatedAt: string | null;
};

type DecisionCenterTerminalResponse = {
  snapshot: {
    activeCampaigns: number;
    accountBalanceRub: number | null;
    accountBonusRub: number | null;
    accountAvailableRub: number | null;
    accountBalanceSyncedAt: string | null;
    campaigns: DecisionCenterCampaignRow[];
  };
};

type SourceHealthStatus = 'healthy' | 'warning' | 'invalid' | 'unknown';

type SourceHealthNode = {
  key: string;
  label: string;
  status: SourceHealthStatus;
  configured: boolean;
  checkedAt: string | null;
  refreshedAt: string | null;
  lastSyncedAt: string | null;
  message: string;
};

type SourceHealthResponse = {
  generatedAt: string;
  overallStatus: SourceHealthStatus;
  auth: {
    wbApiToken: SourceHealthNode;
    wbLkSession: SourceHealthNode;
    wbLkTokenV3: SourceHealthNode;
  };
  contours: {
    advertisingApi: SourceHealthNode;
    contentApi: SourceHealthNode;
    lkBackedRead: SourceHealthNode;
  };
  readiness: {
    campaignSnapshot: SourceHealthStatus;
    cardSnapshot: SourceHealthStatus;
    lkBackedSnapshot: SourceHealthStatus;
    missing: string[];
  };
};

type CampaignDetailDailyRow = {
  day: string;
  adSpend: number;
  revenue: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  acosPct: number | null;
  skuCount: number;
};

type CampaignDetailQueryDailyRow = {
  day: string;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  clickToOrderPct: number | null;
};

type CampaignDetailQueryRow = {
  cluster: string;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  clickToOrderPct: number | null;
  activeDays: number;
  daily: CampaignDetailQueryDailyRow[];
};

type CampaignDetailPositionDailyRow = {
  day: string;
  avgPosition: number | null;
  bestPosition: number | null;
  samples: number;
  frequency: number | null;
  impressions: number;
};

type CampaignDetailPositionRow = {
  keyword: string;
  avgPosition: number | null;
  bestPosition: number | null;
  samples: number;
  activeDays: number;
  frequency: number | null;
  impressions: number;
  daily: CampaignDetailPositionDailyRow[];
};

type CampaignTerminalDetailResponse = {
  generatedAt: string;
  advertId: number;
  nmId: number | null;
  dateWindow: {
    from: string;
    to: string;
  };
  daily: CampaignDetailDailyRow[];
  queries: CampaignDetailQueryRow[];
  positions: CampaignDetailPositionRow[];
};

type CampaignTerminalRow = {
  key: string;
  campaign: DecisionCenterCampaignRow;
  strategy: StrategyRecord | null;
  product: AdvertisingProductListRow | null;
  latestRun: StrategyRun | null;
  recentChanges: StrategyRecentChange[];
};

const REQUEST_TIMEOUT_MS = 15_000;
const EMPTY_ROWS: AdvertisingProductListRow[] = [];

const PRODUCT_FILTERS: Array<{ key: RiskFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'danger', label: 'Проблема' },
  { key: 'warning', label: 'Внимание' },
  { key: 'good', label: 'Норма' },
  { key: 'group', label: 'Склейки' },
];

const CAMPAIGN_FILTERS: Array<{ key: RiskFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'paused', label: 'На паузе' },
  { key: 'danger', label: 'Проблема' },
  { key: 'warning', label: 'Внимание' },
];

const COLUMN_PRESETS: Array<{ key: ColumnPreset; label: string; description: string }> = [
  { key: 'control', label: 'Управление', description: 'статус, ставки, бюджет, действие' },
  { key: 'analytics', label: 'Аналитика', description: 'трафик, конверсии, ДРР' },
  { key: 'full', label: 'Все', description: 'полный плотный терминал' },
];

const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'days', label: 'По дням' },
  { key: 'queries', label: 'Запросы' },
  { key: 'positions', label: 'Позиции' },
  { key: 'stocks', label: 'Остатки' },
  { key: 'actions', label: 'Действия' },
];

async function fetchJsonWithTimeout<T>(url: string, fallbackMessage: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;

    if (!response.ok) {
      throw new Error(payload?.error || fallbackMessage);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${fallbackMessage}: запрос дольше ${REQUEST_TIMEOUT_MS / 1000} секунд`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function productKey(row: AdvertisingProductListRow) {
  return row.groupId ?? `sku:${row.nmId}`;
}

function productTitle(row: AdvertisingProductListRow) {
  return row.title || row.brand || row.vendorCode || `nmId ${row.nmId}`;
}

function campaignTitle(row: CampaignTerminalRow) {
  return row.strategy?.name
    || row.campaign.productTitle
    || (row.product ? productTitle(row.product) : null)
    || `Кампания ${row.campaign.advertId}`;
}

function campaignSubtitle(row: CampaignTerminalRow) {
  const nmLabel = row.campaign.nmId !== null
    ? `nmId ${row.campaign.nmId}`
    : `${row.campaign.skuCount} SKU`;
  return `advertId ${row.campaign.advertId} · ${nmLabel}`;
}

function productSubtitle(row: AdvertisingProductListRow) {
  return [
    `nmId ${row.nmId}`,
    row.vendorCode,
    row.brand,
  ].filter(Boolean).join(' · ');
}

function riskLabel(risk: AdvertisingProductListRow['risk']) {
  if (risk === 'danger') {
    return 'Проблема';
  }
  if (risk === 'warning') {
    return 'Внимание';
  }
  return 'Норма';
}

function riskClasses(risk: AdvertisingProductListRow['risk']) {
  if (risk === 'danger') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200';
  }
  if (risk === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200';
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200';
}

function RiskStatusIcon({ risk, className }: { risk: AdvertisingProductListRow['risk']; className: string }) {
  if (risk === 'danger') {
    return <AlertTriangle className={className} />;
  }
  if (risk === 'warning') {
    return <CirclePause className={className} />;
  }
  return <CheckCircle2 className={className} />;
}

function campaignHasActivity(campaign: DecisionCenterCampaignRow) {
  return campaign.adSpend > 0
    || campaign.revenue > 0
    || campaign.orders > 0
    || campaign.views > 0
    || campaign.clicks > 0;
}

function campaignRisk(campaign: DecisionCenterCampaignRow): AdvertisingProductListRow['risk'] {
  if (
    (campaign.adSpend >= 500 && campaign.revenue <= 0)
    || (campaign.clicks >= 20 && campaign.orders === 0)
    || (campaign.acosPct !== null && campaign.acosPct >= 60)
  ) {
    return 'danger';
  }
  if (
    (campaign.acosPct !== null && campaign.acosPct >= 35)
    || (campaign.views >= 1000 && (campaign.ctrPct ?? 0) < 0.4)
    || (campaign.adSpend > 0 && campaign.orders === 0)
  ) {
    return 'warning';
  }
  return 'good';
}

function campaignReason(campaign: DecisionCenterCampaignRow) {
  if (campaign.adSpend > 0 && campaign.revenue <= 0) {
    return 'Есть расход без выручки за выбранный период.';
  }
  if (campaign.clicks >= 20 && campaign.orders === 0) {
    return 'Клики есть, заказов нет: проверьте ставку, запросы и карточку.';
  }
  if (campaign.acosPct !== null && campaign.acosPct >= 35) {
    return `ДРР ${formatPercent(campaign.acosPct)} выше рабочего порога.`;
  }
  if (campaign.views >= 1000 && (campaign.ctrPct ?? 0) < 0.4) {
    return 'Много показов при низком CTR: проверьте релевантность и карточку.';
  }
  return 'Критичных отклонений по кампании за период нет.';
}

type CampaignActionSignal = {
  tone: 'danger' | 'warning' | 'opportunity' | 'ok' | 'muted';
  label: string;
  detail: string;
};

type SignalEvidence = {
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'warning' | 'good';
};

type SignalRecommendation = {
  title: string;
  text: string;
  targetTab?: DetailTab;
};

function campaignActionSignal(row: CampaignTerminalRow): CampaignActionSignal {
  const campaign = row.campaign;
  const active = isActiveCampaign(campaign);

  if (isPausedCampaign(campaign)) {
    return {
      tone: 'muted',
      label: 'Пауза',
      detail: 'Кампания не тратит бюджет',
    };
  }
  if (active && campaign.adSpend >= 500 && campaign.revenue <= 0) {
    return {
      tone: 'danger',
      label: 'Стоп-расход',
      detail: 'Расход есть, выручки нет',
    };
  }
  if (active && campaign.clicks >= 20 && campaign.orders === 0) {
    return {
      tone: 'danger',
      label: 'Запросы в минус',
      detail: 'Клики есть, заказов нет',
    };
  }
  if (active && campaign.acosPct !== null && campaign.acosPct >= 45) {
    return {
      tone: 'warning',
      label: 'Снизить ставку',
      detail: `ДРР ${formatPercent(campaign.acosPct)} выше порога`,
    };
  }
  if (
    active
    && campaign.budgetTotalRub !== null
    && campaign.budgetTotalRub <= Math.max(300, campaign.todayAdSpend * 1.2)
  ) {
    return {
      tone: 'warning',
      label: 'Бюджет низкий',
      detail: 'Может остановиться в течение дня',
    };
  }
  if (
    active
    && campaign.orders > 0
    && (campaign.roas ?? 0) >= 4
    && (campaign.bestPosition === null || campaign.bestPosition > 10)
  ) {
    return {
      tone: 'opportunity',
      label: 'Можно усилить',
      detail: 'Окупается, но позиция не в топе',
    };
  }
  if (active && campaign.avgPosition !== null && campaign.avgPosition > 50 && campaign.searchClusterOrders > 0) {
    return {
      tone: 'opportunity',
      label: 'Позиция низкая',
      detail: 'Есть заказы при слабой позиции',
    };
  }
  return {
    tone: active ? 'ok' : 'muted',
    label: active ? 'Норма' : 'Наблюдать',
    detail: active ? 'Явных срочных действий нет' : campaignOperationalLabel(campaign),
  };
}

function signalEvidence(row: CampaignTerminalRow): SignalEvidence[] {
  const campaign = row.campaign;
  const signal = campaignActionSignal(row);
  const base: SignalEvidence[] = [
    { label: 'Расход', value: formatMoney(campaign.adSpend) },
    { label: 'Выручка', value: formatMoney(campaign.revenue) },
    { label: 'Заказы', value: formatNumber(campaign.orders) },
    { label: 'ДРР', value: formatPercent(campaign.acosPct), tone: campaign.acosPct !== null && campaign.acosPct >= 45 ? 'danger' : 'default' },
    { label: 'ROAS', value: campaign.roas === null ? '—' : `${formatDecimal(campaign.roas, 1)}×`, tone: campaign.roas !== null && campaign.roas >= 4 ? 'good' : 'default' },
    { label: 'Лучшая позиция', value: formatNumber(campaign.bestPosition), tone: campaign.bestPosition !== null && campaign.bestPosition > 10 ? 'warning' : 'default' },
    { label: 'Бюджет', value: budgetLabel(campaign), tone: signal.label === 'Бюджет низкий' ? 'warning' : 'default' },
    { label: 'Клики / заказы', value: `${formatNumber(campaign.searchClusterClicks)} / ${formatNumber(campaign.searchClusterOrders)}` },
  ];

  if (signal.label === 'Можно усилить' || signal.label === 'Позиция низкая') {
    return base.filter((item) => ['ROAS', 'Заказы', 'Лучшая позиция', 'Бюджет', 'Клики / заказы'].includes(item.label));
  }
  if (signal.label === 'Стоп-расход' || signal.label === 'Запросы в минус') {
    return base.filter((item) => ['Расход', 'Выручка', 'Заказы', 'Клики / заказы', 'ДРР'].includes(item.label));
  }
  if (signal.label === 'Снизить ставку') {
    return base.filter((item) => ['ДРР', 'Расход', 'Выручка', 'ROAS', 'Лучшая позиция'].includes(item.label));
  }
  if (signal.label === 'Бюджет низкий') {
    return base.filter((item) => ['Бюджет', 'Расход', 'Заказы', 'ROAS'].includes(item.label));
  }
  return base.slice(0, 6);
}

function signalRecommendations(row: CampaignTerminalRow): SignalRecommendation[] {
  const signal = campaignActionSignal(row);
  const campaign = row.campaign;

  if (signal.label === 'Можно усилить') {
    return [
      {
        title: 'Почему можно усилить',
        text: `Кампания активна, есть заказы, ROAS ${campaign.roas === null ? 'н/д' : `${formatDecimal(campaign.roas, 1)}×`}, при этом лучшая позиция ${formatNumber(campaign.bestPosition)} не выглядит как закреплённый топ.`,
        targetTab: 'positions',
      },
      {
        title: 'Тест роста',
        text: 'Проверить dry-run поднятия ставки на 5-10% только по рабочим запросам, без массового повышения всей кампании.',
      },
      {
        title: 'Ограничение',
        text: `Перед усилением проверить бюджет ${budgetLabel(campaign)} и дневной расход ${formatMoney(campaign.todayAdSpend)}: усиление не должно съесть остаток за несколько часов.`,
      },
    ];
  }

  if (signal.label === 'Позиция низкая') {
    return [
      {
        title: 'Где теряем объём',
        text: `Средняя позиция ${formatDecimal(campaign.avgPosition, 1)}, но заказы по запросам есть. Сначала смотрим запросы и позиции, где конверсия уже подтверждена.`,
        targetTab: 'positions',
      },
      {
        title: 'Точечное усиление',
        text: 'Поднимать ставку только для запросов с заказами или хорошей конверсией, остальные не разгонять.',
        targetTab: 'queries',
      },
    ];
  }

  if (signal.label === 'Стоп-расход') {
    return [
      {
        title: 'Почему стоп',
        text: `Расход ${formatMoney(campaign.adSpend)}, выручка ${formatMoney(campaign.revenue)}. Сначала ищем дорогие запросы без заказов.`,
        targetTab: 'queries',
      },
      {
        title: 'Действие',
        text: 'Сделать dry-run паузы или резкого снижения ставки, применить только после проверки карточки и запросов.',
      },
    ];
  }

  if (signal.label === 'Запросы в минус') {
    return [
      {
        title: 'Почему минус',
        text: `Кликов ${formatNumber(campaign.clicks)}, заказов ${formatNumber(campaign.orders)}. Нужен разбор запросов по дням и конверсии.`,
        targetTab: 'queries',
      },
      {
        title: 'Действие',
        text: 'Отметить кластеры с расходом и нулевыми заказами, затем проверить снижение ставки или исключение через dry-run.',
      },
    ];
  }

  if (signal.label === 'Снизить ставку') {
    return [
      {
        title: 'Почему снижать',
        text: `ДРР ${formatPercent(campaign.acosPct)} выше рабочего порога, расход ${formatMoney(campaign.adSpend)}.`,
        targetTab: 'queries',
      },
      {
        title: 'Действие',
        text: 'Проверить снижение ставки на 10-15% и оставить защиту от падения заказов.',
      },
    ];
  }

  if (signal.label === 'Бюджет низкий') {
    return [
      {
        title: 'Почему бюджет',
        text: `Бюджет ${budgetLabel(campaign)} близок к дневному расходу ${formatMoney(campaign.todayAdSpend)}.`,
      },
      {
        title: 'Действие',
        text: 'Если кампания окупается, пополнить бюджет; если ДРР высокий, сначала снизить темп расхода.',
      },
    ];
  }

  if (signal.label === 'Пауза') {
    return [
      {
        title: 'Кампания на паузе',
        text: 'Расход не идёт. Если есть исторически хорошие заказы и низкий ДРР, можно проверить повторный запуск через dry-run.',
      },
    ];
  }

  return [
    {
      title: 'Явных действий нет',
      text: 'Кампания не нарушает текущие пороги. Дальше смотреть динамику, запросы и бюджет без срочного применения.',
    },
  ];
}

function signalClasses(signal: CampaignActionSignal) {
  if (signal.tone === 'danger') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200';
  }
  if (signal.tone === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200';
  }
  if (signal.tone === 'opportunity') {
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200';
  }
  if (signal.tone === 'ok') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function campaignRowBackground(signal: CampaignActionSignal, selected: boolean) {
  if (selected) {
    return 'bg-emerald-50/80 dark:bg-emerald-950/30';
  }
  if (signal.tone === 'danger') {
    return 'bg-rose-50/45 hover:bg-rose-50 dark:bg-rose-950/15 dark:hover:bg-rose-950/25';
  }
  if (signal.tone === 'warning') {
    return 'bg-amber-50/45 hover:bg-amber-50 dark:bg-amber-950/15 dark:hover:bg-amber-950/25';
  }
  if (signal.tone === 'opportunity') {
    return 'bg-sky-50/40 hover:bg-sky-50 dark:bg-sky-950/15 dark:hover:bg-sky-950/25';
  }
  return 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/70';
}

function campaignStickyBackground(signal: CampaignActionSignal, selected: boolean) {
  if (selected) {
    return 'bg-emerald-50 dark:bg-emerald-950';
  }
  if (signal.tone === 'danger') {
    return 'bg-rose-50 dark:bg-rose-950';
  }
  if (signal.tone === 'warning') {
    return 'bg-amber-50 dark:bg-amber-950';
  }
  if (signal.tone === 'opportunity') {
    return 'bg-sky-50 dark:bg-sky-950';
  }
  return 'bg-white dark:bg-slate-900';
}

function isActiveCampaign(campaign: DecisionCenterCampaignRow) {
  return campaign.status === 9;
}

function isPausedCampaign(campaign: DecisionCenterCampaignRow) {
  return campaign.status === 11;
}

function campaignOperationalLabel(campaign: DecisionCenterCampaignRow) {
  if (campaign.status === null) {
    return campaignHasActivity(campaign) ? 'Статус неизвестен' : 'Нет активности';
  }
  return statusLabel(campaign.status);
}

function campaignOperationalClasses(campaign: DecisionCenterCampaignRow) {
  if (isActiveCampaign(campaign)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  if (isPausedCampaign(campaign)) {
    return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
  if (campaign.status !== null) {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function campaignOperationalDotClasses(campaign: DecisionCenterCampaignRow) {
  if (isActiveCampaign(campaign)) {
    return 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]';
  }
  if (isPausedCampaign(campaign)) {
    return 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.16)]';
  }
  if (campaign.status !== null) {
    return 'bg-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.16)]';
  }
  return 'bg-slate-300 dark:bg-slate-600';
}

function campaignOperationalAccentClasses(campaign: DecisionCenterCampaignRow) {
  if (isActiveCampaign(campaign)) {
    return 'border-l-emerald-500';
  }
  if (isPausedCampaign(campaign)) {
    return 'border-l-amber-500';
  }
  if (campaign.status !== null) {
    return 'border-l-slate-400';
  }
  return 'border-l-slate-200 dark:border-l-slate-700';
}

function campaignPlacementLabel(campaign: DecisionCenterCampaignRow) {
  const placements = [
    campaign.searchPlacement ? 'Поиск' : null,
    campaign.recommendationPlacement ? 'Рекомендации' : null,
  ].filter(Boolean);

  if (placements.length > 0) {
    return placements.join(' + ');
  }
  if (campaign.paymentType) {
    return campaign.paymentType.toUpperCase();
  }
  return 'Рекламная статистика';
}

function campaignTypeLabel(type: number | null) {
  if (type === null) return 'тип н/д';
  const labels: Record<number, string> = {
    4: 'Каталог',
    5: 'Карточка',
    6: 'Поиск',
    7: 'Рекомендации',
    8: 'Авто',
    9: 'Аукцион',
  };
  return labels[type] ?? `тип ${type}`;
}

function bidTypeLabel(value: string | null) {
  if (value === 'manual') return 'ручная';
  if (value === 'unified') return 'единая';
  return value ?? 'тип ставки н/д';
}

function paymentTypeLabel(value: string | null) {
  if (value === 'cpm') return 'CPM';
  if (value === 'cpc') return 'CPC';
  return value?.toUpperCase() ?? 'оплата н/д';
}

function shortDateTime(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function campaignCpm(campaign: DecisionCenterCampaignRow) {
  if (campaign.views <= 0) return null;
  return (campaign.adSpend / campaign.views) * 1000;
}

function bidRangeLabel(campaign: DecisionCenterCampaignRow) {
  if (campaign.minBidRub === null && campaign.maxBidRub === null) return 'ставка —';
  if (campaign.minBidRub !== null && campaign.maxBidRub !== null && campaign.minBidRub !== campaign.maxBidRub) {
    return `${formatMoney(campaign.minBidRub)}–${formatMoney(campaign.maxBidRub)}`;
  }
  return formatMoney(campaign.minBidRub ?? campaign.maxBidRub);
}

function budgetLabel(campaign: DecisionCenterCampaignRow) {
  if (campaign.budgetTotalRub === null) return 'бюджет —';
  return formatMoney(campaign.budgetTotalRub);
}

function campaignDataScore(campaign: DecisionCenterCampaignRow) {
  const checks = [
    campaign.status !== null,
    campaign.budgetTotalRub !== null,
    campaign.positionSamples > 0,
    campaign.searchClusterCount > 0,
    campaign.openCards > 0,
    campaign.lastDataAt !== null,
  ];
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100);
}

function campaignDataTone(score: number) {
  if (score >= 80) return 'text-emerald-700 dark:text-emerald-300';
  if (score >= 50) return 'text-amber-700 dark:text-amber-300';
  return 'text-rose-700 dark:text-rose-300';
}

function strategyModeLabel(value: StrategyRecord['mode']) {
  return value === 'self_learning' ? 'Самообучение' : 'Классика';
}

function biddingModeLabel(value: StrategyRecord['biddingMode']) {
  if (value === 'cpm') return 'CPM';
  if (value === 'roas') return 'ROAS';
  if (value === 'hybrid') return 'Hybrid';
  return 'ДРР';
}

function runStatusLabel(value: string | null) {
  if (!value) return '—';
  if (value === 'success') return 'Успешно';
  if (value === 'failed') return 'Ошибка';
  if (value === 'skipped') return 'Пропуск';
  if (value === 'dry_run') return 'Dry-run';
  return value;
}

function numberOrDash(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function conversionPct(orders: number, clicks: number) {
  if (!Number.isFinite(clicks) || clicks <= 0) {
    return null;
  }
  return (orders / clicks) * 100;
}

function metricTone(value: number | null, dangerAt: number, warningAt: number) {
  if (value === null) {
    return 'text-slate-500 dark:text-slate-400';
  }
  if (value >= dangerAt) {
    return 'text-rose-600 dark:text-rose-300';
  }
  if (value >= warningAt) {
    return 'text-amber-600 dark:text-amber-300';
  }
  return 'text-emerald-700 dark:text-emerald-300';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sourceStatusLabel(status: SourceHealthStatus) {
  if (status === 'healthy') return 'ОК';
  if (status === 'warning') return 'Проверить';
  if (status === 'invalid') return 'Ошибка';
  return 'Нет данных';
}

function sourceStatusClasses(status: SourceHealthStatus) {
  if (status === 'healthy') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200';
  }
  if (status === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200';
  }
  if (status === 'invalid') {
    return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200';
  }
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function sourceTimestamp(node: SourceHealthNode) {
  return node.lastSyncedAt ?? node.refreshedAt ?? node.checkedAt;
}

export function AdvertisingTerminal({ tenantId, fromParam, toParam, onOpenWorkspace }: Props) {
  const [mode, setMode] = useState<TerminalMode>('campaigns');
  const [queryText, setQueryText] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [columnPreset, setColumnPreset] = useState<ColumnPreset>('control');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('days');
  const [masterPaneHeight, setMasterPaneHeight] = useState(420);
  const terminalGridRef = useRef<HTMLDivElement | null>(null);

  const productsQuery = useQuery<AdvertisingProductsResponse, Error>({
    queryKey: ['advertising-terminal-products', tenantId, fromParam, toParam],
    queryFn: () => fetchJsonWithTimeout<AdvertisingProductsResponse>(
      `/api/views/advertising/products?from=${fromParam}&to=${toParam}`,
      'Ошибка при загрузке терминала товаров',
    ),
    enabled: Boolean(tenantId),
    retry: 1,
  });

  const overviewQuery = useQuery<AdvertisingOverviewResponse, Error>({
    queryKey: ['advertising-terminal-overview', tenantId, fromParam, toParam],
    queryFn: () => fetchJsonWithTimeout<AdvertisingOverviewResponse>(
      `/api/views/advertising?from=${fromParam}&to=${toParam}`,
      'Ошибка при загрузке дневной детализации',
    ),
    enabled: Boolean(tenantId && mode === 'products'),
    retry: 1,
  });

  const strategiesQuery = useQuery<StrategiesResponse, Error>({
    queryKey: ['advertising-terminal-strategies', tenantId],
    queryFn: () => fetchJsonWithTimeout<StrategiesResponse>(
      '/api/views/advertising/workspace/strategies',
      'Ошибка при загрузке рекламных кампаний',
    ),
    enabled: Boolean(tenantId),
    retry: 1,
  });

  const decisionCenterQuery = useQuery<DecisionCenterTerminalResponse, Error>({
    queryKey: ['advertising-terminal-decision-center', tenantId, fromParam, toParam],
    queryFn: () => fetchJsonWithTimeout<DecisionCenterTerminalResponse>(
      `/api/views/advertising/decision-center?from=${fromParam}&to=${toParam}`,
      'Ошибка при загрузке фактических рекламных кампаний',
    ),
    enabled: Boolean(tenantId),
    retry: 1,
  });

  const sourceHealthQuery = useQuery<SourceHealthResponse, Error>({
    queryKey: ['advertising-terminal-source-health', tenantId],
    queryFn: () => fetchJsonWithTimeout<SourceHealthResponse>(
      '/api/views/advertising/source-health',
      'Ошибка при загрузке состояния источников',
    ),
    enabled: Boolean(tenantId),
    retry: 1,
  });

  const rows = productsQuery.data?.rows ?? EMPTY_ROWS;
  const overview = mode === 'products' ? overviewQuery.data ?? null : null;
  const normalizedSearch = queryText.trim().toLowerCase();
  const activeFilters = mode === 'campaigns' ? CAMPAIGN_FILTERS : PRODUCT_FILTERS;

  const productByNmId = useMemo(() => {
    const map = new Map<number, AdvertisingProductListRow>();
    for (const row of rows) {
      if (!map.has(row.nmId)) {
        map.set(row.nmId, row);
      }
    }
    return map;
  }, [rows]);

  const latestRunByStrategyId = useMemo(() => {
    const map = new Map<string, StrategyRun>();
    for (const run of strategiesQuery.data?.runs ?? []) {
      if (!map.has(run.strategyId)) {
        map.set(run.strategyId, run);
      }
    }
    return map;
  }, [strategiesQuery.data?.runs]);

  const recentChangesByStrategyId = useMemo(() => {
    const map = new Map<string, StrategyRecentChange[]>();
    for (const change of strategiesQuery.data?.recentChanges ?? []) {
      const rowsForStrategy = map.get(change.strategyId) ?? [];
      rowsForStrategy.push(change);
      map.set(change.strategyId, rowsForStrategy);
    }
    return map;
  }, [strategiesQuery.data?.recentChanges]);

  const strategyByCampaignKey = useMemo(() => {
    const exact = new Map<string, StrategyRecord>();
    const byAdvertId = new Map<number, StrategyRecord>();

    for (const strategy of strategiesQuery.data?.strategies ?? []) {
      exact.set(`${strategy.advertId}:${strategy.nmId}`, strategy);
      if (!byAdvertId.has(strategy.advertId)) {
        byAdvertId.set(strategy.advertId, strategy);
      }
    }

    return { byAdvertId, exact };
  }, [strategiesQuery.data?.strategies]);

  const campaignRows = useMemo<CampaignTerminalRow[]>(() => (
    (decisionCenterQuery.data?.snapshot.campaigns ?? []).map((campaign) => {
      const exactStrategy = campaign.nmId !== null
        ? strategyByCampaignKey.exact.get(`${campaign.advertId}:${campaign.nmId}`)
        : undefined;
      const strategy = exactStrategy ?? strategyByCampaignKey.byAdvertId.get(campaign.advertId) ?? null;
      const product = campaign.nmId !== null ? productByNmId.get(campaign.nmId) ?? null : null;

      return {
        key: `campaign:${campaign.advertId}:${campaign.nmId ?? 'all'}`,
        campaign,
        strategy,
        product,
        latestRun: strategy ? latestRunByStrategyId.get(strategy.id) ?? null : null,
        recentChanges: strategy ? (recentChangesByStrategyId.get(strategy.id) ?? []).slice(0, 20) : [],
      };
    }).sort((left, right) => {
      if (right.campaign.adSpend !== left.campaign.adSpend) {
        return right.campaign.adSpend - left.campaign.adSpend;
      }
      if (right.campaign.views !== left.campaign.views) {
        return right.campaign.views - left.campaign.views;
      }
      return right.campaign.advertId - left.campaign.advertId;
    })
  ), [
    decisionCenterQuery.data?.snapshot.campaigns,
    latestRunByStrategyId,
    productByNmId,
    recentChangesByStrategyId,
    strategyByCampaignKey,
  ]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (riskFilter === 'group' && row.attributionScope !== 'group') {
      return false;
    }
    if (riskFilter !== 'all' && riskFilter !== 'group' && row.risk !== riskFilter) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    return [
      productTitle(row),
      row.vendorCode,
      row.brand,
      row.groupName,
      String(row.nmId),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedSearch));
  }), [normalizedSearch, riskFilter, rows]);

  const filteredCampaignRows = useMemo(() => campaignRows.filter((row) => {
    const risk = campaignRisk(row.campaign);
    if (riskFilter === 'active' && !isActiveCampaign(row.campaign)) {
      return false;
    }
    if (riskFilter === 'paused' && !isPausedCampaign(row.campaign)) {
      return false;
    }
    if ((riskFilter === 'danger' || riskFilter === 'warning' || riskFilter === 'good') && risk !== riskFilter) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    return [
      campaignTitle(row),
      String(row.campaign.advertId),
      row.campaign.nmId !== null ? String(row.campaign.nmId) : null,
      row.campaign.productTitle,
      row.campaign.vendorCode,
      row.campaign.brand,
      row.product ? productTitle(row.product) : null,
      row.product?.vendorCode,
      row.product?.brand,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedSearch));
  }), [campaignRows, normalizedSearch, riskFilter]);

  const selectedRow =
    filteredRows.find((row) => productKey(row) === selectedKey)
    ?? filteredRows[0]
    ?? rows[0]
    ?? null;

  const selectedCampaign =
    filteredCampaignRows.find((row) => row.key === selectedKey)
    ?? filteredCampaignRows[0]
    ?? campaignRows[0]
    ?? null;

  const selectedProduct = mode === 'campaigns'
    ? selectedCampaign?.product ?? null
    : selectedRow;

  const campaignDetailQuery = useQuery<CampaignTerminalDetailResponse, Error>({
    queryKey: [
      'advertising-terminal-campaign-detail',
      tenantId,
      fromParam,
      toParam,
      selectedCampaign?.campaign.advertId ?? null,
      selectedCampaign?.campaign.nmId ?? null,
    ],
    queryFn: () => {
      const campaign = selectedCampaign?.campaign;
      if (!campaign) {
        throw new Error('Кампания не выбрана');
      }
      const params = new URLSearchParams({
        from: fromParam,
        to: toParam,
        advertId: String(campaign.advertId),
      });
      if (campaign.nmId !== null) {
        params.set('nmId', String(campaign.nmId));
      }
      return fetchJsonWithTimeout<CampaignTerminalDetailResponse>(
        `/api/views/advertising/terminal-detail?${params.toString()}`,
        'Ошибка при загрузке детализации кампании',
      );
    },
    enabled: Boolean(tenantId && mode === 'campaigns' && selectedCampaign),
    retry: 1,
  });

  const summary = useMemo(() => ({
    spend: mode === 'campaigns'
      ? campaignRows.reduce((sum, row) => sum + row.campaign.adSpend, 0)
      : rows.reduce((sum, row) => sum + row.adSpend, 0),
    revenue: mode === 'campaigns'
      ? campaignRows.reduce((sum, row) => sum + row.campaign.revenue, 0)
      : rows.reduce((sum, row) => sum + row.revenue, 0),
    orders: mode === 'campaigns'
      ? campaignRows.reduce((sum, row) => sum + row.campaign.orders, 0)
      : rows.reduce((sum, row) => sum + row.orders, 0),
    danger: mode === 'campaigns'
      ? campaignRows.filter((row) => campaignRisk(row.campaign) === 'danger').length
      : rows.filter((row) => row.risk === 'danger').length,
    warning: mode === 'campaigns'
      ? campaignRows.filter((row) => campaignRisk(row.campaign) === 'warning').length
      : rows.filter((row) => row.risk === 'warning').length,
    groups: rows.filter((row) => row.attributionScope === 'group').length,
    campaigns: campaignRows.length,
    activeCampaigns: campaignRows.filter((row) => isActiveCampaign(row.campaign)).length,
    pausedCampaigns: campaignRows.filter((row) => isPausedCampaign(row.campaign)).length,
    accountBalanceRub: decisionCenterQuery.data?.snapshot.accountBalanceRub ?? null,
    accountBonusRub: decisionCenterQuery.data?.snapshot.accountBonusRub ?? null,
    accountAvailableRub: decisionCenterQuery.data?.snapshot.accountAvailableRub ?? null,
    loadedBudgetRub: campaignRows.reduce((sum, row) => sum + (row.campaign.budgetTotalRub ?? 0), 0),
  }), [campaignRows, decisionCenterQuery.data?.snapshot.accountAvailableRub, decisionCenterQuery.data?.snapshot.accountBalanceRub, decisionCenterQuery.data?.snapshot.accountBonusRub, mode, rows]);

  const handlePaneResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const gridTop = terminalGridRef.current?.getBoundingClientRect().top ?? 0;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setMasterPaneHeight(clamp(moveEvent.clientY - gridTop, 260, 680));
    };
    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  if (productsQuery.isLoading || (mode === 'campaigns' && decisionCenterQuery.isLoading && campaignRows.length === 0)) {
    return (
      <div className="flex h-[52vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse text-sm font-medium text-slate-500 dark:text-slate-400">
          Собираем рекламный терминал...
        </p>
      </div>
    );
  }

  if (productsQuery.error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить терминал"
        description={productsQuery.error.message}
        actionLabel="Повторить"
        action={productsQuery.refetch}
      />
    );
  }

  if (mode === 'campaigns' && decisionCenterQuery.error && campaignRows.length === 0) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="Не удалось загрузить кампании"
        description={decisionCenterQuery.error.message}
        actionLabel="Повторить"
        action={decisionCenterQuery.refetch}
      />
    );
  }

  if (rows.length === 0 && campaignRows.length === 0) {
    return (
      <OperatorState
        icon={Boxes}
        tone="warning"
        title="Нет рекламных данных для терминала"
        description="Запустите синхронизацию рекламы и выберите период с активностью."
        actionLabel="Перейти в настройки"
        actionHref="/settings"
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
            <MetricCell label="Расход" value={formatMoney(summary.spend)} />
            <MetricCell label="Выручка" value={formatMoney(summary.revenue)} />
            <MetricCell label="Заказы" value={formatNumber(summary.orders)} />
            <MetricCell label="Кампании" value={formatNumber(summary.campaigns)} />
            <MetricCell label="Активные" value={formatNumber(summary.activeCampaigns)} />
            <MetricCell label="На паузе" value={formatNumber(summary.pausedCampaigns)} />
            <MetricCell label="Счёт" value={formatMoney(summary.accountBalanceRub)} />
            <MetricCell label="Бонус" value={formatMoney(summary.accountBonusRub)} />
            <MetricCell label="Доступно" value={formatMoney(summary.accountAvailableRub)} />
            <MetricCell label="Бюджеты" value={summary.loadedBudgetRub > 0 ? formatMoney(summary.loadedBudgetRub) : '—'} />
            <MetricCell label="Проблема" value={formatNumber(summary.danger)} tone="danger" />
            <MetricCell label="Внимание" value={formatNumber(summary.warning)} tone="warning" />
            <MetricCell label="Склейки" value={formatNumber(summary.groups)} />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              {([
                { key: 'campaigns', label: 'Кампании' },
                { key: 'products', label: 'Товары' },
              ] as const).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setMode(item.key);
                    setRiskFilter('all');
                    setSelectedKey(null);
                  }}
                  className={`h-8 rounded-md px-3 text-[11px] font-black transition ${
                    mode === item.key
                      ? 'bg-emerald-700 text-white dark:bg-emerald-400 dark:text-slate-950'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {mode === 'campaigns' ? (
              <div className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                {COLUMN_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    title={preset.description}
                    onClick={() => setColumnPreset(preset.key)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-black transition ${
                      columnPreset === preset.key
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                    }`}
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                    {preset.label}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="relative block min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder={mode === 'campaigns' ? 'Поиск: advertId, nmId, кампания' : 'Поиск: nmId, артикул, товар'}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs font-semibold text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-emerald-500"
              />
            </label>
            <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              {activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setRiskFilter(filter.key)}
                  className={`h-7 rounded-md px-2.5 text-[11px] font-black transition ${
                    riskFilter === filter.key
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <SourceHealthStrip
          health={sourceHealthQuery.data ?? null}
          loading={sourceHealthQuery.isLoading}
          error={sourceHealthQuery.error?.message ?? null}
        />
      </div>

      <div
        ref={terminalGridRef}
        className="grid min-h-[760px]"
        style={{ gridTemplateRows: `${masterPaneHeight}px 12px minmax(340px, 1fr)` }}
      >
        <div className="overflow-auto">
          {mode === 'campaigns' ? (
            <CampaignMasterTable
              rows={filteredCampaignRows}
              selectedKey={selectedCampaign?.key ?? null}
              onSelect={setSelectedKey}
              onOpenActions={(key) => {
                setSelectedKey(key);
                setDetailTab('actions');
              }}
              columnPreset={columnPreset}
            />
          ) : (
          <table className="min-w-[1420px] w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="w-[360px] px-3 py-2">Товар</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2 text-right">Расход</th>
                <th className="px-3 py-2 text-right">Выручка</th>
                <th className="px-3 py-2 text-right">Заказы</th>
                <th className="px-3 py-2 text-right">ДРР</th>
                <th className="px-3 py-2 text-right">ROAS</th>
                <th className="px-3 py-2 text-right">CTR</th>
                <th className="px-3 py-2 text-right">CPC</th>
                <th className="px-3 py-2">Риск</th>
                <th className="px-3 py-2">Следующий шаг</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredRows.map((row) => {
                const key = productKey(row);
                const selected = selectedRow ? productKey(selectedRow) === key : false;

                return (
                  <tr
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    className={`cursor-pointer align-middle transition ${
                      selected
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/30'
                        : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                          {row.photoUrl ? (
                            <Image
                              src={row.photoUrl}
                              alt={productTitle(row)}
                              fill
                              sizes="40px"
                              className="object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[9px] font-black text-slate-400">
                              ФОТО
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-black text-slate-900 dark:text-slate-100">{productTitle(row)}</p>
                          <p className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{productSubtitle(row)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {row.attributionScope === 'group' ? (
                        <div>
                          <p className="font-black text-emerald-700 dark:text-emerald-300">Склейка</p>
                          <p className="max-w-[150px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {row.groupName ?? 'без названия'} · {row.groupNmCount} SKU
                          </p>
                        </div>
                      ) : (
                        <p className="font-semibold text-slate-600 dark:text-slate-300">SKU</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-black text-slate-900 dark:text-slate-100">{formatMoney(row.adSpend)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoney(row.revenue)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(row.orders)}</td>
                    <td className={`px-3 py-2 text-right font-black ${metricTone(row.acosPct, 45, 30)}`}>{formatPercent(row.acosPct)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{numberOrDash(row.roas)}×</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(row.ctrPct, 2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoneyPrecise(row.cpc, 2)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${riskClasses(row.risk)}`}>
                        <RiskStatusIcon risk={row.risk} className="h-3 w-3" />
                        {riskLabel(row.risk)}
                      </span>
                    </td>
                    <td className="max-w-[240px] px-3 py-2">
                      <p className="line-clamp-2 font-semibold leading-4 text-slate-600 dark:text-slate-300">{row.reason}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}

          {(mode === 'campaigns' ? filteredCampaignRows.length : filteredRows.length) === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
              По текущему фильтру строк нет.
            </div>
          ) : null}
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          title="Изменить высоту списка"
          onPointerDown={handlePaneResizeStart}
          className="group flex cursor-row-resize items-center justify-center border-y border-slate-200 bg-slate-100 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <div className="flex h-5 w-16 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-400 shadow-sm transition group-hover:border-slate-400 group-hover:text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500 dark:group-hover:text-slate-300">
            <GripHorizontal className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="min-h-0 border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/40">
          {selectedProduct || selectedCampaign ? (
            <TerminalDetails
              row={selectedProduct}
              campaign={mode === 'campaigns' ? selectedCampaign : null}
              campaignDetail={mode === 'campaigns' ? campaignDetailQuery.data ?? null : null}
              overview={overview}
              overviewPending={mode === 'campaigns' ? campaignDetailQuery.isLoading : overviewQuery.isLoading}
              overviewError={mode === 'campaigns'
                ? campaignDetailQuery.error?.message ?? null
                : overviewQuery.error?.message ?? strategiesQuery.error?.message ?? null}
              detailTab={detailTab}
              onDetailTabChange={setDetailTab}
              onOpenWorkspace={onOpenWorkspace}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CampaignMasterTable({
  rows,
  selectedKey,
  onSelect,
  onOpenActions,
  columnPreset,
}: {
  rows: CampaignTerminalRow[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpenActions: (key: string) => void;
  columnPreset: ColumnPreset;
}) {
  const showCampaignInfo = columnPreset !== 'analytics';
  const showPeriod = columnPreset !== 'control';
  const showZones = columnPreset !== 'analytics';
  const showStrategy = columnPreset !== 'analytics';
  const showBudget = columnPreset !== 'analytics';
  const showCtr = columnPreset !== 'control';
  const showSpend = columnPreset !== 'control';
  const showDay = columnPreset !== 'analytics';
  const showFunnel = columnPreset !== 'control';
  const showQueries = columnPreset !== 'control';
  const showCarts = columnPreset !== 'control';
  const tableMinWidth = columnPreset === 'full'
    ? 2620
    : columnPreset === 'analytics'
      ? 1760
      : 1680;

  return (
    <table
      className="w-full border-separate border-spacing-0 text-left text-xs"
      style={{ minWidth: `${tableMinWidth}px` }}
    >
      <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400">
        <tr>
          <th className="sticky left-0 z-20 w-[390px] bg-slate-100 px-3 py-2 shadow-[8px_0_14px_rgba(15,23,42,0.05)] dark:bg-slate-900">
            Наименование / статус / время
          </th>
          {showCampaignInfo ? <th className="w-[120px] px-3 py-2">Камп.</th> : null}
          {showPeriod ? <th className="w-[120px] px-3 py-2 text-right">Период</th> : null}
          {showZones ? <th className="w-[170px] px-3 py-2">Зоны / позиции</th> : null}
          {showStrategy ? <th className="w-[190px] px-3 py-2">Стратегия / ставки</th> : null}
          {showBudget ? <th className="w-[160px] px-3 py-2 text-right">Бюджет</th> : null}
          {showCtr ? <th className="w-[150px] px-3 py-2 text-right">CTR / показы</th> : null}
          {showSpend ? <th className="w-[150px] px-3 py-2 text-right">Затраты</th> : null}
          {showDay ? <th className="w-[150px] px-3 py-2 text-right">День</th> : null}
          {showFunnel ? <th className="w-[150px] px-3 py-2 text-right">Воронка</th> : null}
          {showQueries ? <th className="w-[170px] px-3 py-2 text-right">Запросы / конв.</th> : null}
          {showCarts ? <th className="w-[160px] px-3 py-2 text-right">Корз. / Заказы</th> : null}
          <th className="w-[170px] px-3 py-2 text-right">ДРР / Выручка</th>
          <th className="w-[250px] px-3 py-2">Сигнал / шаг</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => {
          const product = row.product;
          const strategy = row.strategy;
          const risk = campaignRisk(row.campaign);
          const reason = campaignReason(row.campaign);
          const photoUrl = row.campaign.photoUrl ?? product?.photoUrl ?? null;
          const selected = selectedKey === row.key;
          const cpm = campaignCpm(row.campaign);
          const lastChangeAt = row.campaign.campaignUpdatedAt ?? row.campaign.lastDataAt;
          const dataScore = campaignDataScore(row.campaign);
          const signal = campaignActionSignal(row);

          return (
            <tr
              key={row.key}
              onClick={() => onSelect(row.key)}
              className={`group cursor-pointer align-middle transition ${campaignRowBackground(signal, selected)}`}
            >
              <td className={`sticky left-0 z-[5] border-l-4 px-3 py-2 shadow-[8px_0_14px_rgba(15,23,42,0.05)] ${campaignOperationalAccentClasses(row.campaign)} ${campaignStickyBackground(signal, selected)}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                    {photoUrl ? (
                      <Image
                        src={photoUrl}
                        alt={campaignTitle(row)}
                        fill
                        sizes="40px"
                        className="object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[9px] font-black text-slate-400">
                        AD
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-900 dark:text-slate-100">{campaignTitle(row)}</p>
                    <p className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {campaignSubtitle(row)}
                    </p>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-black ${campaignOperationalClasses(row.campaign)}`}>
                        <span className={`mt-0.5 h-2 w-2 rounded-full ${campaignOperationalDotClasses(row.campaign)}`} />
                        {campaignOperationalLabel(row.campaign)}
                      </span>
                      <span className="truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {shortDateTime(lastChangeAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              {showCampaignInfo ? (
                <td className="px-3 py-2">
                  <p className="font-black text-slate-800 dark:text-slate-100">{row.campaign.advertId}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{campaignTypeLabel(row.campaign.type)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{paymentTypeLabel(row.campaign.paymentType)} · {bidTypeLabel(row.campaign.bidType)}</p>
                </td>
              ) : null}
              {showPeriod ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{formatNumber(row.campaign.activeDays)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">дней с данными</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">SKU {formatNumber(row.campaign.skuCount)}</p>
                </td>
              ) : null}
              {showZones ? (
                <td className="px-3 py-2">
                  <p className="font-black text-slate-800 dark:text-slate-100">{campaignPlacementLabel(row.campaign)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    поиск {row.campaign.searchPlacement ? formatMoney(row.campaign.currentSearchBidRub) : '—'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    поз. {formatDecimal(row.campaign.avgPosition, 1)} · best {formatNumber(row.campaign.bestPosition)}
                  </p>
                </td>
              ) : null}
              {showStrategy ? (
                <td className="px-3 py-2">
                  {strategy ? (
                    <>
                      <p className="font-black text-slate-800 dark:text-slate-100">{strategyModeLabel(strategy.mode)} · {biddingModeLabel(strategy.biddingMode)}</p>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">цель ДРР {formatPercent(strategy.targetAcosPct, 0)}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">лимит {formatMoney(strategy.minBid)}–{formatMoney(strategy.maxBid)}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-black text-slate-800 dark:text-slate-100">{bidRangeLabel(row.campaign)}</p>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">стратегия не подключена</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">рек. {row.campaign.recommendationPlacement ? formatMoney(row.campaign.currentRecommendationBidRub) : '—'}</p>
                    </>
                  )}
                </td>
              ) : null}
              {showBudget ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{budgetLabel(row.campaign)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">счёт {formatMoney(row.campaign.budgetCashRub)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">взаим. {formatMoney(row.campaign.budgetNettingRub)}</p>
                </td>
              ) : null}
              {showCtr ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{formatPercent(row.campaign.ctrPct, 2)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{formatNumber(row.campaign.views)} показов</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{formatNumber(row.campaign.clicks)} кликов</p>
                </td>
              ) : null}
              {showSpend ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{formatMoney(row.campaign.adSpend)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">CPC {formatMoneyPrecise(row.campaign.cpc, 2)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">CPM {formatMoneyPrecise(cpm, 2)}</p>
                </td>
              ) : null}
              {showDay ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{formatMoney(row.campaign.todayAdSpend)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">сегодня · {formatNumber(row.campaign.todayOrders)} зак.</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">вчера {formatMoney(row.campaign.yesterdayAdSpend)}</p>
                </td>
              ) : null}
              {showFunnel ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{formatNumber(row.campaign.openCards)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">карточек</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">в корз. {formatPercent(row.campaign.cartRatePct, 1)}</p>
                </td>
              ) : null}
              {showQueries ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{formatNumber(row.campaign.searchClusterCount)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {formatNumber(row.campaign.searchClusterClicks)} / {formatNumber(row.campaign.searchClusterOrders)}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">CPC {formatMoneyPrecise(row.campaign.searchClusterCpc, 2)}</p>
                </td>
              ) : null}
              {showCarts ? (
                <td className="px-3 py-2 text-right">
                  <p className="font-black text-slate-900 dark:text-slate-100">{formatNumber(row.campaign.carts)} × {formatNumber(row.campaign.orders)}</p>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">CPO {formatMoneyPrecise(row.campaign.cpo, 2)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">C→O {formatPercent(row.campaign.cartToOrderPct, 1)}</p>
                </td>
              ) : null}
              <td className="px-3 py-2 text-right">
                <p className={`font-black ${metricTone(row.campaign.acosPct, 45, 30)}`}>{formatPercent(row.campaign.acosPct)}</p>
                <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{formatMoney(row.campaign.revenue)}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">ROAS {row.campaign.roas === null ? '—' : `${formatDecimal(row.campaign.roas, 1)}×`}</p>
              </td>
              <td className="max-w-[250px] px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    title="Открыть разбор и рекомендации"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenActions(row.key);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black transition hover:scale-[1.02] hover:shadow-sm ${signalClasses(signal)}`}
                  >
                    <Crosshair className="h-3 w-3" />
                    {signal.label}
                  </button>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${riskClasses(risk)}`}>
                    <RiskStatusIcon risk={risk} className="h-3 w-3" />
                    {riskLabel(risk)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 font-semibold leading-4 text-slate-600 dark:text-slate-300">
                  {signal.detail}. {reason}
                </p>
                <p className={`mt-1 text-[11px] font-black ${campaignDataTone(dataScore)}`}>
                  данные {dataScore}% · поз. {formatNumber(row.campaign.positionSamples)} · запросы {formatNumber(row.campaign.searchClusterViews)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {strategy ? `${runStatusLabel(row.latestRun?.status ?? strategy.lastStatus)} · ${formatDateTime(row.latestRun?.startedAt ?? strategy.lastRunAt)}` : 'прогон стратегии —'}
                </p>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MetricCell({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'warning';
}) {
  const valueClass = tone === 'danger'
    ? 'text-rose-700 dark:text-rose-300'
    : tone === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-slate-900 dark:text-slate-100';

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-black ${valueClass}`}>{value}</p>
    </div>
  );
}

function SourceHealthStrip({
  health,
  loading,
  error,
}: {
  health: SourceHealthResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !health) {
    return (
      <div className="mt-3 flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Проверяем источники WB...
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        Source health недоступен: {error}
      </div>
    );
  }

  if (!health) {
    return null;
  }

  const items = [
    health.auth.wbApiToken,
    health.auth.wbLkSession,
    health.auth.wbLkTokenV3,
    health.contours.advertisingApi,
    health.contours.contentApi,
    health.contours.lkBackedRead,
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((item) => {
        const timestamp = sourceTimestamp(item);
        const Icon = item.status === 'healthy'
          ? CheckCircle2
          : item.status === 'invalid'
            ? AlertTriangle
            : CirclePause;

        return (
          <div
            key={item.key}
            title={item.message}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-black ${sourceStatusClasses(item.status)}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{item.label}</span>
            <span className="font-semibold opacity-80">{sourceStatusLabel(item.status)}</span>
            {timestamp ? (
              <span className="font-semibold opacity-60">{formatDateTime(timestamp)}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TerminalDetails({
  row,
  campaign,
  campaignDetail,
  overview,
  overviewPending,
  overviewError,
  detailTab,
  onDetailTabChange,
  onOpenWorkspace,
}: {
  row: AdvertisingProductListRow | null;
  campaign: CampaignTerminalRow | null;
  campaignDetail: CampaignTerminalDetailResponse | null;
  overview: AdvertisingOverviewResponse | null;
  overviewPending: boolean;
  overviewError: string | null;
  detailTab: DetailTab;
  onDetailTabChange: (tab: DetailTab) => void;
  onOpenWorkspace?: (nmId: number) => void;
}) {
  const title = campaign ? campaignTitle(campaign) : row ? productTitle(row) : 'Объект не выбран';
  const subtitle = campaign
    ? campaignSubtitle(campaign)
    : row ? productSubtitle(row) : 'Нет данных';
  const photoUrl = campaign?.campaign.photoUrl ?? row?.photoUrl ?? campaign?.product?.photoUrl ?? null;
  const risk = campaign ? campaignRisk(campaign.campaign) : row?.risk ?? 'warning';
  const metricSource = campaign?.campaign ?? null;
  const adSpend = metricSource?.adSpend ?? row?.adSpend ?? 0;
  const revenue = metricSource?.revenue ?? row?.revenue ?? 0;
  const orders = metricSource?.orders ?? row?.orders ?? 0;
  const acosPct = metricSource?.acosPct ?? row?.acosPct ?? null;
  const ctrPct = metricSource?.ctrPct ?? row?.ctrPct ?? null;
  const cpc = metricSource?.cpc ?? row?.cpc ?? null;
  const signal = campaign ? campaignActionSignal(campaign) : null;

  return (
    <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] overflow-hidden">
      <aside className="border-r border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex gap-3">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
            {photoUrl ? (
              <Image
                src={photoUrl}
                alt={title}
                fill
                sizes="80px"
                className="object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-black text-slate-400">
                ФОТО
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-black leading-5 text-slate-900 dark:text-slate-100">{title}</p>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{subtitle}</p>
            <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-black ${campaign ? campaignOperationalClasses(campaign.campaign) : riskClasses(risk)}`}>
              {campaign ? (
                <>
                  <span className={`h-2 w-2 rounded-full ${campaignOperationalDotClasses(campaign.campaign)}`} />
                  {campaignOperationalLabel(campaign.campaign)}
                </>
              ) : (
                <>
                  <RiskStatusIcon risk={risk} className="h-3 w-3" />
                  {riskLabel(risk)}
                </>
              )}
            </span>
            {signal ? (
              <span className={`ml-1 mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-black ${signalClasses(signal)}`}>
                <Crosshair className="h-3 w-3" />
                {signal.label}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <CompactMetric label="Расход" value={formatMoney(adSpend)} />
          <CompactMetric label="Выручка" value={formatMoney(revenue)} />
          <CompactMetric label="Заказы" value={formatNumber(orders)} />
          <CompactMetric label="ДРР" value={formatPercent(acosPct)} tone={metricTone(acosPct, 45, 30)} />
          <CompactMetric label="CTR" value={formatPercent(ctrPct, 2)} />
          <CompactMetric label="CPC" value={formatMoneyPrecise(cpc, 2)} />
          {campaign ? <CompactMetric label="Бюджет" value={budgetLabel(campaign.campaign)} /> : null}
          {campaign ? <CompactMetric label="Позиция" value={formatDecimal(campaign.campaign.avgPosition, 1)} /> : null}
          {campaign ? <CompactMetric label="Запросы" value={formatNumber(campaign.campaign.searchClusterCount)} /> : null}
          {campaign ? <CompactMetric label="Данные" value={`${campaignDataScore(campaign.campaign)}%`} /> : null}
        </div>

        {campaign ? (
          <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs font-semibold text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
            {campaign.strategy
              ? `${strategyModeLabel(campaign.strategy.mode)} · ${biddingModeLabel(campaign.strategy.biddingMode)} · ставки ${formatMoney(campaign.strategy.minBid)} – ${formatMoney(campaign.strategy.maxBid)}`
              : `Рекламная статистика · SKU в кампании: ${formatNumber(campaign.campaign.skuCount)} · стратегия не подключена`}
          </div>
        ) : null}

        {row?.attributionScope === 'group' ? (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
            Склейка: {row.groupName ?? 'без названия'} · {row.groupNmCount} SKU · рекламируется {row.advertisedNmCount}
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap gap-1">
            {DETAIL_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onDetailTabChange(tab.key)}
                className={`h-8 rounded-md px-3 text-xs font-black transition ${
                  detailTab === tab.key
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {overviewPending ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Детализация
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {overviewError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              {overviewError}
            </div>
          ) : null}
          {detailTab === 'days' ? <DaysPanel overview={overview} campaignDetail={campaignDetail} /> : null}
          {detailTab === 'queries' ? <QueriesPanel overview={overview} campaignDetail={campaignDetail} /> : null}
          {detailTab === 'positions' ? <PositionsPanel campaignDetail={campaignDetail} /> : null}
          {detailTab === 'stocks' ? <StocksPanel row={row} campaign={campaign} /> : null}
          {detailTab === 'actions' ? (
            <ActionsPanel
              row={row}
              campaign={campaign}
              onDetailTabChange={onDetailTabChange}
              onOpenWorkspace={onOpenWorkspace}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CompactMetric({
  label,
  value,
  tone = 'text-slate-900 dark:text-slate-100',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/50">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 font-black ${tone}`}>{value}</p>
    </div>
  );
}

function SignalEvidenceCell({ item }: { item: SignalEvidence }) {
  const toneClass = item.tone === 'danger'
    ? 'text-rose-700 dark:text-rose-300'
    : item.tone === 'warning'
      ? 'text-amber-700 dark:text-amber-300'
      : item.tone === 'good'
        ? 'text-emerald-700 dark:text-emerald-300'
        : 'text-slate-900 dark:text-slate-100';

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{item.label}</p>
      <p className={`mt-1 text-sm font-black ${toneClass}`}>{item.value}</p>
    </div>
  );
}

function DaysPanel({
  overview,
  campaignDetail,
}: {
  overview: AdvertisingOverviewResponse | null;
  campaignDetail: CampaignTerminalDetailResponse | null;
}) {
  if (campaignDetail) {
    const daily = campaignDetail.daily;

    if (daily.length === 0) {
      return <EmptyPanel text="По выбранной кампании дневной срез пока не накоплен." />;
    }

    return (
      <table className="min-w-[1040px] w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2">Дата</th>
            <th className="px-3 py-2 text-right">Расход</th>
            <th className="px-3 py-2 text-right">Выручка</th>
            <th className="px-3 py-2 text-right">Заказы</th>
            <th className="px-3 py-2 text-right">Показы</th>
            <th className="px-3 py-2 text-right">Клики</th>
            <th className="px-3 py-2 text-right">CTR</th>
            <th className="px-3 py-2 text-right">CPC</th>
            <th className="px-3 py-2 text-right">ДРР</th>
            <th className="px-3 py-2 text-right">SKU</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {daily.map((day) => (
            <tr key={day.day} className="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60">
              <td className="px-3 py-2 font-black text-slate-900 dark:text-slate-100">{dayLabel(day.day)}</td>
              <td className="px-3 py-2 text-right font-black text-slate-900 dark:text-slate-100">{formatMoney(day.adSpend)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoney(day.revenue)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.orders)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.views)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.clicks)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(day.ctrPct, 2)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoneyPrecise(day.cpc, 2)}</td>
              <td className={`px-3 py-2 text-right font-black ${metricTone(day.acosPct, 45, 30)}`}>{formatPercent(day.acosPct)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">{formatNumber(day.skuCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const daily = overview?.daily ?? [];

  if (daily.length === 0) {
    return <EmptyPanel text="Дневной срез за выбранный период пока не накоплен." />;
  }

  return (
    <table className="min-w-[980px] w-full text-left text-xs">
      <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <tr>
          <th className="px-3 py-2">Дата</th>
          <th className="px-3 py-2 text-right">Расход</th>
          <th className="px-3 py-2 text-right">Выручка</th>
          <th className="px-3 py-2 text-right">ЧП до рекламы</th>
          <th className="px-3 py-2 text-right">ЧП после рекламы</th>
          <th className="px-3 py-2 text-right">Заказы</th>
          <th className="px-3 py-2 text-right">CTR</th>
          <th className="px-3 py-2 text-right">CPC</th>
          <th className="px-3 py-2 text-right">ДРР</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {daily.map((day) => (
          <tr key={day.day} className="bg-white dark:bg-slate-900">
            <td className="px-3 py-2 font-black text-slate-900 dark:text-slate-100">{dayLabel(day.day)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoney(day.adSpend)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoney(day.revenue)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoney(day.netProfitBeforeAds)}</td>
            <td className="px-3 py-2 text-right font-black text-slate-900 dark:text-slate-100">{formatMoney(day.netProfit)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.orders)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(day.ctrPct, 2)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoneyPrecise(day.cpc, 2)}</td>
            <td className={`px-3 py-2 text-right font-black ${metricTone(day.acosPct, 45, 30)}`}>{formatPercent(day.acosPct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QueriesPanel({
  overview,
  campaignDetail,
}: {
  overview: AdvertisingOverviewResponse | null;
  campaignDetail: CampaignTerminalDetailResponse | null;
}) {
  if (campaignDetail) {
    const clusters = campaignDetail.queries;

    if (clusters.length === 0) {
      return <EmptyPanel text="По выбранной кампании поисковые запросы за период пока не накоплены." />;
    }

    return (
      <table className="min-w-[1080px] w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
          <tr>
            <th className="w-[360px] px-3 py-2">Запрос / кластер</th>
            <th className="px-3 py-2 text-right">Расход</th>
            <th className="px-3 py-2 text-right">Показы</th>
            <th className="px-3 py-2 text-right">Клики</th>
            <th className="px-3 py-2 text-right">Заказы</th>
            <th className="px-3 py-2 text-right">Конв.</th>
            <th className="px-3 py-2 text-right">CTR</th>
            <th className="px-3 py-2 text-right">CPC</th>
            <th className="px-3 py-2 text-right">Дней</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {clusters.map((cluster) => (
            <tr key={cluster.cluster} className="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60">
              <td className="group relative px-3 py-2">
                <p className="max-w-[340px] truncate font-black text-slate-900 dark:text-slate-100">{cluster.cluster}</p>
                <p className="text-[11px] font-semibold text-slate-400">история по дням</p>
                {cluster.daily.length > 0 ? <QueryHistoryTooltip cluster={cluster} /> : null}
              </td>
              <td className="px-3 py-2 text-right font-black text-slate-900 dark:text-slate-100">{formatMoney(cluster.adSpend)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(cluster.views)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(cluster.clicks)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(cluster.orders)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(cluster.clickToOrderPct, 1)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(cluster.ctrPct, 2)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoneyPrecise(cluster.cpc, 2)}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">{formatNumber(cluster.activeDays)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const clusters = overview?.topClusters ?? [];

  if (clusters.length === 0) {
    return <EmptyPanel text="Поисковые запросы и кластеры за выбранный период пока не накоплены." />;
  }

  return (
    <table className="min-w-[760px] w-full text-left text-xs">
      <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <tr>
          <th className="px-3 py-2">Запрос / кластер</th>
          <th className="px-3 py-2 text-right">Расход</th>
          <th className="px-3 py-2 text-right">Показы</th>
          <th className="px-3 py-2 text-right">Клики</th>
          <th className="px-3 py-2 text-right">Заказы</th>
          <th className="px-3 py-2 text-right">Конв.</th>
          <th className="px-3 py-2 text-right">CTR</th>
          <th className="px-3 py-2 text-right">CPC</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {clusters.slice(0, 40).map((cluster) => (
          <tr key={cluster.cluster} className="bg-white dark:bg-slate-900">
            <td className="px-3 py-2 font-black text-slate-900 dark:text-slate-100">{cluster.cluster}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoney(cluster.adSpend)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(cluster.views)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(cluster.clicks)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(cluster.orders)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(conversionPct(cluster.orders, cluster.clicks), 1)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(cluster.ctrPct, 2)}</td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoneyPrecise(cluster.cpc, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QueryHistoryTooltip({ cluster }: { cluster: CampaignDetailQueryRow }) {
  return (
    <div className="pointer-events-none invisible absolute left-3 top-12 z-30 w-[590px] rounded-lg border border-slate-200 bg-white p-3 text-xs opacity-0 shadow-2xl transition-opacity delay-0 duration-150 group-hover:visible group-hover:opacity-100 group-hover:delay-[3000ms] dark:border-slate-700 dark:bg-slate-950">
      <p className="mb-2 max-w-[550px] truncate font-black text-slate-900 dark:text-slate-100">{cluster.cluster}</p>
      <table className="w-full text-left">
        <thead className="text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="py-1">Дата</th>
            <th className="py-1 text-right">Расход</th>
            <th className="py-1 text-right">Показы</th>
            <th className="py-1 text-right">Клики</th>
            <th className="py-1 text-right">Заказы</th>
            <th className="py-1 text-right">Конв.</th>
            <th className="py-1 text-right">CTR</th>
            <th className="py-1 text-right">CPC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {cluster.daily.slice(0, 12).map((day) => (
            <tr key={`${cluster.cluster}:${day.day}`}>
              <td className="py-1 font-black text-slate-800 dark:text-slate-100">{dayLabel(day.day)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoney(day.adSpend)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.views)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.clicks)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.orders)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(day.clickToOrderPct, 1)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatPercent(day.ctrPct, 2)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatMoneyPrecise(day.cpc, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionsPanel({
  campaignDetail,
}: {
  campaignDetail: CampaignTerminalDetailResponse | null;
}) {
  const positions = campaignDetail?.positions ?? [];

  if (!campaignDetail) {
    return <EmptyPanel text="Выберите кампанию, чтобы увидеть позиции по запросам." />;
  }

  if (positions.length === 0) {
    return <EmptyPanel text="По выбранной кампании позиции за период пока не накоплены." />;
  }

  return (
    <table className="min-w-[980px] w-full text-left text-xs">
      <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <tr>
          <th className="w-[360px] px-3 py-2">Запрос</th>
          <th className="px-3 py-2 text-right">Средняя</th>
          <th className="px-3 py-2 text-right">Лучшая</th>
          <th className="px-3 py-2 text-right">Сэмплы</th>
          <th className="px-3 py-2 text-right">Частота</th>
          <th className="px-3 py-2 text-right">Показы</th>
          <th className="px-3 py-2 text-right">Дней</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {positions.map((position) => (
          <tr key={position.keyword} className="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60">
            <td className="group relative px-3 py-2">
              <p className="max-w-[340px] truncate font-black text-slate-900 dark:text-slate-100">{position.keyword}</p>
              <p className="text-[11px] font-semibold text-slate-400">история по дням</p>
              {position.daily.length > 0 ? <PositionHistoryTooltip position={position} /> : null}
            </td>
            <td className="px-3 py-2 text-right font-black text-slate-900 dark:text-slate-100">
              {formatDecimal(position.avgPosition, 1)}
            </td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
              {formatNumber(position.bestPosition)}
            </td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
              {formatNumber(position.samples)}
            </td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
              {formatNumber(position.frequency)}
            </td>
            <td className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
              {formatNumber(position.impressions)}
            </td>
            <td className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">
              {formatNumber(position.activeDays)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PositionHistoryTooltip({ position }: { position: CampaignDetailPositionRow }) {
  return (
    <div className="pointer-events-none invisible absolute left-3 top-12 z-30 w-[520px] rounded-lg border border-slate-200 bg-white p-3 text-xs opacity-0 shadow-2xl transition-opacity delay-0 duration-150 group-hover:visible group-hover:opacity-100 group-hover:delay-[3000ms] dark:border-slate-700 dark:bg-slate-950">
      <p className="mb-2 max-w-[480px] truncate font-black text-slate-900 dark:text-slate-100">{position.keyword}</p>
      <table className="w-full text-left">
        <thead className="text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="py-1">Дата</th>
            <th className="py-1 text-right">Средняя</th>
            <th className="py-1 text-right">Лучшая</th>
            <th className="py-1 text-right">Сэмплы</th>
            <th className="py-1 text-right">Частота</th>
            <th className="py-1 text-right">Показы</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {position.daily.slice(0, 12).map((day) => (
            <tr key={`${position.keyword}:${day.day}`}>
              <td className="py-1 font-black text-slate-800 dark:text-slate-100">{dayLabel(day.day)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatDecimal(day.avgPosition, 1)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.bestPosition)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.samples)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.frequency)}</td>
              <td className="py-1 text-right font-semibold text-slate-700 dark:text-slate-200">{formatNumber(day.impressions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StocksPanel({
  row,
  campaign,
}: {
  row: AdvertisingProductListRow | null;
  campaign: CampaignTerminalRow | null;
}) {
  const risk = campaign ? campaignRisk(campaign.campaign) : row?.risk ?? 'warning';
  const reason = campaign ? campaignReason(campaign.campaign) : row?.reason;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <InfoBlock
        icon={Boxes}
        title="Склад"
        value="P107"
        text="Остатки, days of stock и OOS-риск подключаются в следующем срезе терминала."
      />
      <InfoBlock
        icon={TrendingDown}
        title="Рекламный риск"
        value={campaign || row ? riskLabel(risk) : 'Нет товарного среза'}
        text={reason ?? 'Для кампании пока нет связанной товарной строки за выбранный период.'}
      />
      <InfoBlock
        icon={ShieldCheck}
        title={campaign ? 'Кампания' : 'Scope'}
        value={campaign ? `#${campaign.campaign.advertId}` : row?.attributionScope === 'group' ? 'Склейка' : 'SKU'}
        text={campaign
          ? campaign.strategy
            ? `${campaignOperationalLabel(campaign.campaign)} · ${strategyModeLabel(campaign.strategy.mode)}`
            : `${campaignOperationalLabel(campaign.campaign)} · ${campaign.campaign.skuCount} SKU`
          : row?.attributionScope === 'group'
          ? `${row.groupName ?? 'без названия'} · ${row.groupNmCount} SKU`
          : `nmId ${row?.nmId ?? '—'}`}
      />
    </div>
  );
}

function ActionsPanel({
  row,
  campaign,
  onDetailTabChange,
  onOpenWorkspace,
}: {
  row: AdvertisingProductListRow | null;
  campaign: CampaignTerminalRow | null;
  onDetailTabChange: (tab: DetailTab) => void;
  onOpenWorkspace?: (nmId: number) => void;
}) {
  const risk = campaign ? campaignRisk(campaign.campaign) : row?.risk ?? 'warning';
  const reason = campaign ? campaignReason(campaign.campaign) : row?.reason;
  const signal = campaign ? campaignActionSignal(campaign) : null;
  const evidence = campaign ? signalEvidence(campaign) : [];
  const recommendations = campaign ? signalRecommendations(campaign) : [];
  const action = signal && signal.tone !== 'ok' && signal.tone !== 'muted'
    ? signal.detail
    : risk === 'danger'
    ? 'Проверить снижение ставки или паузу через dry-run'
    : risk === 'warning'
      ? 'Проверить ставку, CTR и поисковые запросы'
      : 'Наблюдать, масштабировать только в лимитах';
  const nmId = row?.nmId ?? campaign?.campaign.nmId ?? campaign?.strategy?.nmId ?? null;

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Следующий шаг</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {signal ? (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black ${signalClasses(signal)}`}>
              <Crosshair className="h-3 w-3" />
              {signal.label}
            </span>
          ) : null}
          <p className="text-sm font-black text-slate-900 dark:text-slate-100">{action}</p>
        </div>
        <p className="mt-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">
          {reason ?? 'Сначала нужен товарный срез за период; действия остаются через dry-run и audit.'}
        </p>
        {campaign ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300">
            Кампания #{campaign.campaign.advertId}: {campaign.strategy
              ? `${campaignOperationalLabel(campaign.campaign)} · ${strategyModeLabel(campaign.strategy.mode)} · последний прогон ${formatDateTime(campaign.latestRun?.startedAt ?? campaign.strategy.lastRunAt)}`
              : `${campaignOperationalLabel(campaign.campaign)} · SKU ${campaign.campaign.skuCount} · расход ${formatMoney(campaign.campaign.adSpend)}`}
          </div>
        ) : null}
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
          <CompactMetric label="Guardrails" value="обязательны" />
          <CompactMetric label="Dry-run" value="перед apply" />
          <CompactMetric label="Audit" value="каждое действие" />
        </div>
      </div>

        {campaign ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-400">Почему система так решила</p>
                <p className="mt-2 text-sm font-black text-slate-900 dark:text-slate-100">
                  {signal?.label ?? 'Сигнал'}: {signal?.detail ?? 'по текущим метрикам'}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => onDetailTabChange('queries')}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Запросы
                </button>
                <button
                  type="button"
                  onClick={() => onDetailTabChange('positions')}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Позиции
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {evidence.map((item) => (
                <SignalEvidenceCell key={item.label} item={item} />
              ))}
            </div>

            <div className="mt-4 grid gap-2">
              {recommendations.map((recommendation) => (
                <div
                  key={recommendation.title}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/50"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xs font-black text-slate-900 dark:text-slate-100">{recommendation.title}</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">
                        {recommendation.text}
                      </p>
                    </div>
                    {recommendation.targetTab ? (
                      <button
                        type="button"
                        onClick={() => onDetailTabChange(recommendation.targetTab!)}
                        className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                      >
                        Открыть
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {campaign?.recentChanges.length ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">Последние изменения</p>
            <div className="max-h-32 overflow-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-2 py-1">Кластер</th>
                    <th className="px-2 py-1 text-right">Ставка</th>
                    <th className="px-2 py-1">Статус</th>
                    <th className="px-2 py-1">Время</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {campaign.recentChanges.slice(0, 8).map((change) => (
                    <tr key={change.id}>
                      <td className="max-w-[220px] truncate px-2 py-1 font-semibold text-slate-800 dark:text-slate-100">
                        {change.cluster}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold text-slate-700 dark:text-slate-200">
                        {formatMoney(change.previousBid)} → {formatMoney(change.nextBid)}
                      </td>
                      <td className="px-2 py-1 text-slate-600 dark:text-slate-300">{runStatusLabel(change.status)}</td>
                      <td className="px-2 py-1 text-slate-500">{formatDateTime(change.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/50">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Переход</p>
        <button
          type="button"
          onClick={() => {
            if (nmId !== null) {
              onOpenWorkspace?.(nmId);
            }
          }}
          disabled={!onOpenWorkspace || nmId === null}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Открыть ставки
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function InfoBlock({
  icon: Icon,
  title,
  value,
  text,
}: {
  icon: typeof Boxes;
  title: string;
  value: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-emerald-600" />
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">{title}</p>
      </div>
      <p className="mt-2 text-lg font-black text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">{text}</p>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      {text}
    </div>
  );
}
