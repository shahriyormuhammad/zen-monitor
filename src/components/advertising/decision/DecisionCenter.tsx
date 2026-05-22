'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Loader2, PackageSearch, ShieldAlert } from 'lucide-react';

type DecisionType = 'stop_now' | 'lower_bid' | 'raise_bid' | 'check_product' | 'quiet';
type DecisionRisk = 'high' | 'medium' | 'low' | 'none';
type ProductReasonCode =
  | 'stock'
  | 'card_content'
  | 'seo'
  | 'price'
  | 'competitor'
  | 'semantic'
  | 'bid_economics'
  | 'traffic_quality'
  | 'group_attribution';
type DecisionAction =
  | 'confirm_cleanup'
  | 'confirm_lower_bid'
  | 'confirm_raise_bid'
  | 'open_bids'
  | 'open_products'
  | 'open_settings'
  | 'none';

type DecisionCard = {
  id: string;
  type: DecisionType;
  title: string;
  productTitle: string | null;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  reason: string;
  money: string;
  risk: DecisionRisk;
  reasonCode: ProductReasonCode | null;
  reasonLabel: string | null;
  actionLabel: string;
  action: DecisionAction;
  plan: {
    primary: string;
    expectedEffect: string;
    guardrail: string;
    followUp: string;
  };
  nmId: number | null;
  groupId: string | null;
  groupName: string | null;
  attributionScope: 'sku' | 'group';
  advertId: number | null;
};

type DecisionResponse = {
  generatedAt: string;
  dateWindowDays: number;
  snapshot: {
    adSpend: number;
    revenue: number;
    orders: number;
    views: number;
    clicks: number;
    acosPct: number | null;
    cpc: number | null;
    ctrPct: number | null;
    activeScopes: number;
    activeCampaigns: number;
    riskyScopes: number;
    coveredFrom: string | null;
    coveredTo: string | null;
    activeDays: number;
    campaignCoveredFrom: string | null;
    campaignCoveredTo: string | null;
    campaignActiveDays: number;
    campaigns: Array<{
      advertId: number;
      nmId: number | null;
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
      skuCount: number;
    }>;
  };
  cards: DecisionCard[];
};

type ActionResult = {
  ok: boolean;
  dryRun: boolean;
  result?: {
    advertId?: number | null;
    paymentType?: 'cpc' | 'cpm' | null;
    requiresConfirmation?: boolean;
    unsupportedReason?: string;
    rows?: ActionResultRow[];
    summary?: {
      applyCount?: number;
      failedCount?: number;
      queuedOperations?: number;
      applied?: number;
      failed?: number;
      skipped?: number;
    };
  };
};

type ActionResultRow = {
  cluster?: string;
  currentBid?: number;
  nextBid?: number;
  delta?: number;
  changePct?: number;
  apply?: boolean;
  blockedReason?: string | null;
};

type CardActionState = {
  loading: boolean;
  preview: ActionResult | null;
  applied: ActionResult | null;
  error: string | null;
};

type LastActionRecord = {
  at: string;
  label: string;
  operationCount: number;
  failedCount: number;
};

type Props = {
  tenantId: string;
  fromParam: string;
  toParam: string;
  onOpenBids: () => void;
  onOpenProducts: () => void;
  onOpenOperations: () => void;
};

const TYPE_ICON = {
  stop_now: ShieldAlert,
  lower_bid: ArrowDown,
  raise_bid: ArrowUp,
  check_product: PackageSearch,
  quiet: CheckCircle2,
} as const;

const RISK_CLASS = {
  high: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300',
  none: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
} as const;

const RISK_LABEL = {
  high: 'Высокий риск',
  medium: 'Средний риск',
  low: 'Низкий риск',
  none: 'Без риска',
} as const;

const REASON_CLASS: Record<ProductReasonCode, string> = {
  stock: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  card_content: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
  seo: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300',
  price: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  competitor: 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300',
  semantic: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300',
  bid_economics: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  traffic_quality: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
  group_attribution: 'bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
};

function getStorageKey(tenantId: string) {
  return `advertising-decision-actions:${tenantId}`;
}

function getActionSummary(result: ActionResult | null) {
  const summary = result?.result?.summary ?? null;
  if (!summary) {
    return { operationCount: 0, failedCount: 0 };
  }
  return {
    operationCount: summary.applied
      ?? summary.queuedOperations
      ?? summary.applyCount
      ?? 0,
    failedCount: summary.failed
      ?? summary.failedCount
      ?? 0,
  };
}

function formatLastActionAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatProductIdentity(card: DecisionCard) {
  const headline = card.productTitle || card.brand || card.vendorCode || (card.nmId ? `nmId ${card.nmId}` : null);
  if (!headline) return null;
  const suffix = card.nmId ? `nmId ${card.nmId}` : null;
  if (!suffix || headline.includes(suffix)) {
    return headline;
  }
  return `${headline} · ${suffix}`;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatBidNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMetricMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatMetricPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(1)}%`;
}

function formatMetricNumber(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString('ru-RU');
}

function isCpcBidRow(row: ActionResultRow) {
  return (row.cluster ?? '').toLowerCase().includes('cpc');
}

function normalizeBidValue(row: ActionResultRow, value: number) {
  return isCpcBidRow(row) ? value / 100 : value;
}

function formatBidValue(row: ActionResultRow, value: number) {
  return `${formatBidNumber(normalizeBidValue(row, value))} ₽`;
}

function formatBidChange(row: ActionResultRow) {
  const currentBid = finiteNumber(row.currentBid);
  const nextBid = finiteNumber(row.nextBid);
  if (currentBid === null || nextBid === null) {
    return null;
  }

  const rawDelta = finiteNumber(row.delta) ?? nextBid - currentBid;
  const delta = normalizeBidValue(row, rawDelta);
  const changePct = finiteNumber(row.changePct);
  const deltaSign = delta > 0 ? '+' : delta < 0 ? '-' : '';
  const deltaText = `${deltaSign}${formatBidNumber(Math.abs(delta))} ₽`;
  const pctText = changePct === null
    ? null
    : `${changePct > 0 ? '+' : ''}${formatBidNumber(changePct)}%`;

  return `${formatBidValue(row, currentBid)} → ${formatBidValue(row, nextBid)} (${pctText ? `${deltaText}, ${pctText}` : deltaText})`;
}

function getActionRows(result: ActionResult | null) {
  return result?.result?.rows?.filter((row) => formatBidChange(row) !== null) ?? [];
}

function humanizeActionError(raw: string) {
  const message = raw.trim();
  const normalized = message.toLowerCase();
  if (
    normalized.includes('gateway time')
    || normalized.includes('504')
    || normalized.includes('timeout')
  ) {
    return 'WB не ответил вовремя. Повторите через 1-2 минуты.';
  }
  if (
    normalized.includes('unexpected token')
    || normalized.includes('not valid json')
    || normalized.includes('<html')
  ) {
    return 'Сервер рекламы вернул некорректный ответ. Повторите через 1-2 минуты.';
  }
  if (normalized.includes('не вернул текущие ставки')) {
    return 'WB не вернул текущие ставки. Откройте вкладку «Ставки» и повторите.';
  }
  if (normalized.includes('не найдена активная поисковая кампания')) {
    return 'Не нашли активную поисковую кампанию для этого товара.';
  }
  return message;
}

async function parseActionResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return await response.json() as ActionResult & { error?: string };
  }

  const text = await response.text().catch(() => '');
  const message = text
    ? text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    : '';

  return {
    ok: false,
    dryRun: false,
    error: humanizeActionError(message || `Сервер вернул не JSON ответ (${response.status})`),
  } satisfies ActionResult & { error?: string };
}

export function DecisionCenter({ tenantId, fromParam, toParam, onOpenBids, onOpenProducts, onOpenOperations }: Props) {
  const [actionStateById, setActionStateById] = useState<Record<string, CardActionState>>({});
  const [lastActionById, setLastActionById] = useState<Record<string, LastActionRecord>>({});
  const [manualStepPctById, setManualStepPctById] = useState<Record<string, number>>({});
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(getStorageKey(tenantId));
      setLastActionById(raw ? JSON.parse(raw) as Record<string, LastActionRecord> : {});
    } catch {
      setLastActionById({});
    }
  }, [tenantId]);

  useEffect(() => {
    setShowAllCampaigns(false);
  }, [tenantId, fromParam, toParam]);

  const query = useQuery<DecisionResponse, Error>({
    queryKey: ['advertising-decision-center', tenantId, fromParam, toParam],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/advertising/decision-center?from=${fromParam}&to=${toParam}`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        throw new Error('Не удалось собрать действия по рекламе');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  function runAction(action: DecisionAction) {
    if (action === 'open_bids') {
      onOpenBids();
    }
    if (action === 'open_products') {
      onOpenProducts();
    }
  }

  async function runConfirmedAction(card: DecisionCard, dryRun: boolean, manualStepPct?: number) {
    setActionStateById((state) => ({
      ...state,
      [card.id]: {
        loading: true,
        preview: state[card.id]?.preview ?? null,
        applied: state[card.id]?.applied ?? null,
        error: null,
      },
    }));

    try {
      const response = await fetch('/api/views/advertising/decision-center/action', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `ad-decision:${card.id}:${dryRun ? 'dry' : 'apply'}:${Date.now()}`,
        },
        body: JSON.stringify({
          decisionType: card.type,
          from: fromParam,
          to: toParam,
          nmId: card.nmId ?? undefined,
          dryRun,
          maxClusters: 10,
          manualStepPct: canUseManualStep(card) && Number.isFinite(manualStepPct)
            ? Math.max(1, Math.min(80, Math.round(Math.abs(manualStepPct!))))
            : undefined,
        }),
      });
      const payload = await parseActionResponse(response);
      if (!response.ok) {
        throw new Error(humanizeActionError(payload.error || 'Не удалось выполнить действие'));
      }

      const counts = getActionSummary(payload);
      const lastAction: LastActionRecord = {
        at: new Date().toISOString(),
        label: dryRun ? 'Проверено' : 'Подтверждено',
        operationCount: counts.operationCount,
        failedCount: counts.failedCount,
      };

      setActionStateById((state) => ({
        ...state,
        [card.id]: {
          loading: false,
          preview: dryRun ? payload : state[card.id]?.preview ?? null,
          applied: dryRun ? state[card.id]?.applied ?? null : payload,
          error: null,
        },
      }));
      setLastActionById((state) => {
        const next = { ...state, [card.id]: lastAction };
        try {
          window.localStorage.setItem(getStorageKey(tenantId), JSON.stringify(next));
        } catch {
          // localStorage is best-effort UI memory; action execution already succeeded.
        }
        return next;
      });
    } catch (error) {
      setActionStateById((state) => ({
        ...state,
        [card.id]: {
          loading: false,
          preview: state[card.id]?.preview ?? null,
          applied: state[card.id]?.applied ?? null,
          error: humanizeActionError(error instanceof Error ? error.message : String(error)),
        },
      }));
    }
  }

  if (query.isLoading) {
    return (
      <section className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
      </section>
    );
  }

  if (query.error) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 shadow-sm dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
        <div className="flex items-center gap-2 text-sm font-bold">
          <AlertTriangle className="h-4 w-4" />
          {query.error.message}
        </div>
      </section>
    );
  }

  const cards = query.data?.cards ?? [];
  const snapshot = query.data?.snapshot ?? null;
  const visibleCampaigns = showAllCampaigns
    ? (snapshot?.campaigns ?? [])
    : (snapshot?.campaigns.slice(0, 6) ?? []);
  const hasKpiCoverageGap = Boolean(
    snapshot
    && snapshot.coveredFrom
    && snapshot.coveredTo
    && (snapshot.coveredFrom > fromParam || snapshot.coveredTo < toParam),
  );

  function canUseManualStep(card: DecisionCard) {
    return card.action === 'confirm_lower_bid' || card.action === 'confirm_raise_bid';
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100">Что делать сейчас</h2>
      </div>
      {snapshot ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <article className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Расход</p>
              <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatMetricMoney(snapshot.adSpend)}</p>
            </article>
            <article className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Заказы</p>
              <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatMetricNumber(snapshot.orders)}</p>
            </article>
            <article className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">ДРР</p>
              <p className={`mt-1 text-sm font-black ${
                snapshot.acosPct !== null && snapshot.acosPct >= 35
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-emerald-700 dark:text-emerald-300'
              }`}
              >
                {formatMetricPercent(snapshot.acosPct)}
              </p>
            </article>
            <article className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Кампании</p>
              <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatMetricNumber(snapshot.activeCampaigns)}</p>
            </article>
            <article className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">CPC</p>
              <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatMetricMoney(snapshot.cpc)}</p>
            </article>
            <article className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">CTR</p>
              <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">{formatMetricPercent(snapshot.ctrPct)}</p>
              {snapshot.ctrPct === null ? (
                <p className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  Нет надёжных данных CTR
                </p>
              ) : null}
            </article>
          </div>
          <div className="mt-3 rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-black text-slate-900 dark:text-slate-100">Кампании в работе</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Период: {query.data?.dateWindowDays ?? 0} дн.</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Факт KPI: {snapshot.coveredFrom ?? '—'} — {snapshot.coveredTo ?? '—'} ({formatMetricNumber(snapshot.activeDays)} дн.)
              </p>
              {hasKpiCoverageGap ? (
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-300">
                  В выбранном диапазоне есть «пустые» дни без данных/расхода.
                </p>
              ) : null}
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Рисковых зон: {formatMetricNumber(snapshot.riskyScopes)}</p>
              {snapshot.campaignActiveDays > 0 && snapshot.campaignActiveDays < snapshot.activeDays ? (
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-300">
                  Кампании по часам: {snapshot.campaignCoveredFrom ?? '—'} — {snapshot.campaignCoveredTo ?? '—'} ({formatMetricNumber(snapshot.campaignActiveDays)} дн.)
                </p>
              ) : null}
              {snapshot.activeCampaigns > snapshot.campaigns.length ? (
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  В списке {formatMetricNumber(snapshot.campaigns.length)} из {formatMetricNumber(snapshot.activeCampaigns)}
                </p>
              ) : null}
            </div>
            {snapshot.campaigns.length > 0 ? (
              <div className="space-y-2">
                <div className="grid gap-2 lg:grid-cols-2">
                  {visibleCampaigns.map((campaign) => {
                    const identity = campaign.productTitle
                      || campaign.brand
                      || campaign.vendorCode
                      || (campaign.nmId ? `nmId ${campaign.nmId}` : null);
                    return (
                      <div
                        key={campaign.advertId}
                        className="rounded-xl border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-800/70"
                      >
                        <p className="font-black text-slate-900 dark:text-slate-100">
                          Кампания #{campaign.advertId} · SKU {formatMetricNumber(campaign.skuCount)}
                        </p>
                        <p className="mt-1 font-semibold text-slate-700 dark:text-slate-300">
                          Расход {formatMetricMoney(campaign.adSpend)} · Заказы {formatMetricNumber(campaign.orders)} · ДРР {formatMetricPercent(campaign.acosPct)}
                        </p>
                        {identity ? (
                          <p className="mt-1 truncate font-medium text-slate-500 dark:text-slate-400">
                            {identity}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {snapshot.campaigns.length > 6 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllCampaigns((value) => !value)}
                    className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {showAllCampaigns
                      ? 'Свернуть список кампаний'
                      : `Показать все кампании (${formatMetricNumber(snapshot.campaigns.length)})`}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Кампании с расходом за выбранный период не найдены.
              </p>
            )}
          </div>
        </section>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-5">
        {cards.map((card) => {
          const Icon = TYPE_ICON[card.type];
          const actionState = actionStateById[card.id] ?? null;
          const previewSummary = actionState?.preview?.result?.summary ?? null;
          const appliedSummary = actionState?.applied?.result?.summary ?? null;
          const previewUnsupportedReason = actionState?.preview?.result?.unsupportedReason ?? null;
          const previewRows = getActionRows(actionState?.preview ?? null);
          const appliedRows = getActionRows(actionState?.applied ?? null);
          const lastAction = lastActionById[card.id] ?? null;
          const canConfirm = card.action === 'confirm_cleanup'
            || card.action === 'confirm_lower_bid'
            || card.action === 'confirm_raise_bid';
          const canManualStep = canUseManualStep(card);
          const manualStepPct = manualStepPctById[card.id] ?? 10;
          const productIdentity = formatProductIdentity(card);
          const previewCount = previewSummary
            ? (previewSummary.queuedOperations ?? previewSummary.applyCount ?? 0)
            : 0;
          const appliedCount = appliedSummary
            ? (appliedSummary.applied ?? appliedSummary.applyCount ?? 0)
            : 0;
          const failedCount = appliedSummary
            ? (appliedSummary.failed ?? appliedSummary.failedCount ?? 0)
            : 0;
          const campaignId = card.advertId
            ?? actionState?.preview?.result?.advertId
            ?? actionState?.applied?.result?.advertId
            ?? null;
          const campaignType = actionState?.preview?.result?.paymentType
            ?? actionState?.applied?.result?.paymentType
            ?? null;
          return (
            <article
              key={card.id}
              className="flex min-h-[210px] flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60">
                    {card.photoUrl ? (
                      <Image
                        src={card.photoUrl}
                        alt={card.productTitle || card.title}
                        fill
                        sizes="56px"
                        className="object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-700 dark:text-slate-200">
                        <Icon className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${RISK_CLASS[card.risk]}`}>
                      {RISK_LABEL[card.risk]}
                    </span>
                    {card.reasonCode && card.reasonLabel ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${REASON_CLASS[card.reasonCode]}`}>
                        {card.reasonLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">{card.title}</h3>
                  {productIdentity ? (
                    <p className="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {productIdentity}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-4 text-xs font-medium leading-5 text-slate-600 dark:text-slate-300">
                    {card.reason}
                  </p>
                </div>
                <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{card.money}</p>
                {card.attributionScope === 'group' ? (
                  <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    Склейка: {card.groupName ?? 'без названия'}
                  </p>
                ) : null}
                {campaignId ? (
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    Кампания: #{campaignId}{campaignType ? ` · ${campaignType.toUpperCase()}` : ''}
                  </p>
                ) : null}
                {previewSummary && !appliedSummary ? (
                  <div className={`rounded-xl p-2 text-xs font-semibold ${
                    previewUnsupportedReason
                      ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                      : 'bg-slate-50 text-slate-600 dark:bg-slate-900/50 dark:text-slate-300'
                  }`}
                  >
                    {previewUnsupportedReason ? (
                      previewUnsupportedReason
                    ) : (
                      <div className="space-y-1">
                        <p>Готово к применению: {previewCount}.</p>
                        {previewRows.slice(0, 2).map((row, index) => {
                          const bidChange = formatBidChange(row);
                          return bidChange ? (
                            <p key={`${row.cluster ?? 'bid'}-${index}`} className="text-slate-900 dark:text-slate-100">
                              {row.cluster ?? 'Ставка'}: {bidChange}
                            </p>
                          ) : null;
                        })}
                        {previewRows.length > 2 ? (
                          <p className="text-slate-500 dark:text-slate-400">Еще изменений: {previewRows.length - 2}</p>
                        ) : null}
                        {previewRows.length === 0 && previewCount > 0 ? (
                          <p className="text-slate-500 dark:text-slate-400">
                            WB вернул {previewCount} изменение; детали откройте в «Операциях».
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
                {!previewSummary && card.plan ? (
                  <div className="rounded-xl bg-slate-50 p-2 text-xs font-semibold text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                    <p className="text-slate-900 dark:text-slate-100">{card.plan.primary}</p>
                    <p className="mt-1">{card.plan.expectedEffect}</p>
                  </div>
                ) : null}
                {canManualStep && !appliedSummary ? (
                  <label className="block rounded-xl bg-slate-50 p-2 text-xs font-semibold text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                    <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Свой шаг ставки, %</span>
                    <input
                      type="number"
                      min={1}
                      max={80}
                      step={1}
                      value={manualStepPct}
                      onChange={(event) => {
                        const raw = Number(event.target.value);
                        const normalized = Number.isFinite(raw)
                          ? Math.max(1, Math.min(80, Math.round(raw)))
                          : 10;
                        setManualStepPctById((state) => ({ ...state, [card.id]: normalized }));
                      }}
                      className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-bold text-slate-900 outline-none ring-emerald-500 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                      {card.type === 'lower_bid' ? 'Будет снижение' : 'Будет повышение'} на {manualStepPct}%.
                    </span>
                  </label>
                ) : null}
                {appliedSummary ? (
                  <div className="rounded-xl bg-emerald-50 p-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                    <p>Применено: {appliedCount}. Ошибок: {failedCount}.</p>
                    {appliedRows.slice(0, 2).map((row, index) => {
                      const bidChange = formatBidChange(row);
                      return bidChange ? (
                        <p key={`${row.cluster ?? 'bid'}-${index}`} className="mt-1 text-emerald-900 dark:text-emerald-100">
                          {row.cluster ?? 'Ставка'}: {bidChange}
                        </p>
                      ) : null;
                    })}
                  </div>
                ) : null}
                {lastAction ? (
                  <p className="rounded-xl bg-slate-50 p-2 text-xs font-semibold text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                    {lastAction.label} {formatLastActionAt(lastAction.at)} · {lastAction.operationCount} опер. · ошибок {lastAction.failedCount}
                  </p>
                ) : null}
                {actionState?.error ? (
                  <p className="rounded-xl bg-red-50 p-2 text-xs font-semibold text-red-700 dark:bg-red-950/30 dark:text-red-300">
                    {actionState.error}
                  </p>
                ) : null}
              </div>
              {canConfirm ? (
                <div className="mt-4 grid gap-2">
                  {!previewSummary ? (
                    <button
                      type="button"
                      onClick={() => runConfirmedAction(card, true, manualStepPct)}
                      disabled={Boolean(actionState?.loading || actionState?.applied)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white transition hover:bg-slate-700 disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                    >
                      {actionState?.loading ? 'Проверяем...' : card.actionLabel}
                    </button>
                  ) : null}
                  {previewSummary && !appliedSummary ? (
                    <button
                      type="button"
                      onClick={() => runConfirmedAction(card, false, manualStepPct)}
                      disabled={Boolean(actionState?.loading || previewCount <= 0)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-xs font-black text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-default disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300"
                    >
                      Подтвердить
                    </button>
                  ) : null}
                  {previewSummary && !appliedSummary ? (
                    <button
                      type="button"
                      onClick={() => runConfirmedAction(card, true, manualStepPct)}
                      disabled={Boolean(actionState?.loading)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Проверить заново
                    </button>
                  ) : null}
                  {(previewSummary || appliedSummary) ? (
                    <button
                      type="button"
                      onClick={onOpenOperations}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Открыть операции
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => runAction(card.action)}
                  disabled={card.action === 'none'}
                  className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white transition hover:bg-slate-700 disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  {card.actionLabel}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
