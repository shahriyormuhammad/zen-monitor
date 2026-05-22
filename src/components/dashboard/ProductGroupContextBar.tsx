'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layers3,
  Loader2,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';

import { getGroupMembers } from '@/app/(dashboard)/product-groups/actions';
import { getWbPhotoUrl } from '@/lib/wb-api/wb-photos';

type ProductGroup = {
  id: string;
  name: string;
};

type ProductGroupMember = {
  groupId: string;
  nmId: number;
};

type ProductOption = {
  nmId: number;
  vendorCode: string;
  photoUrl: string | null;
  title?: string | null;
  currentStock?: number | null;
  currentPrice?: number | null;
  currentDiscount?: number | null;
  currentSpp?: number | null;
};

type ProductsResponse = {
  data: ProductOption[];
};

type FinanceRow = {
  nmId: number;
  brand?: string | null;
  category?: string | null;
  vendorCode?: string | null;
  photoUrl?: string | null;
  quantity?: number;
  revenue?: number;
  expenses?: number;
  profit?: number;
  ads?: number;
  cogs?: number;
  costPrice?: number;
  currentStock?: number;
  daysOfStock?: number;
  lostOrders?: number;
  lostOrdersSum?: number;
  stockAnalyticsDays?: number;
  stockTurnoverDays?: number;
  stockSizeAvailable?: boolean;
  orders?: number;
  buyouts?: number;
  cancels?: number;
  buyoutRate?: number;
  tax?: number;
};

type FinanceResponse = {
  rows: FinanceRow[];
};

type SliceRow = {
  type: string;
  name: string;
  count: number;
  revenue: number;
  profit: number;
};

type AbcBucket = 'A' | 'B' | 'C';

type AbcSkuRow = FinanceRow & {
  rank: number;
  bucket: AbcBucket;
  revenueShare: number;
  cumulativeShare: number;
  marginPct: number | null;
  action: string;
};

type SummaryMetrics = {
  revenue: number;
  profit: number;
  expenses: number;
  roi: number;
  buyoutRate: number;
  ads: number;
  adsCpo: number;
  orders: number;
  buyouts: number;
  stocks: number;
  lostOrders: number;
  lostOrdersSum: number;
};

type GroupSummary = SummaryMetrics & {
  id: string;
  name: string;
  memberCount: number;
  previous?: SummaryMetrics;
  delta?: SummaryMetrics;
  deltaPct?: Record<keyof SummaryMetrics, number | null>;
  comparisonPeriod?: {
    from: string;
    to: string;
    days: number;
  };
  flags: {
    negativeProfit: boolean;
    lowBuyout: boolean;
    highCpo: boolean;
    stockRisk: boolean;
  };
};

type GroupSummaryResponse = {
  data: GroupSummary[];
};

type TabKey = 'products' | 'compare' | 'problems' | 'abc' | 'segments';
type ProblemFilter = 'all' | 'negative' | 'ads' | 'lowBuyout' | 'stock' | 'lost' | 'margin';

type StockSizeCoverage = {
  total: number;
  covered: number;
  missing: number;
};

const PROBLEM_FILTERS: Array<{ key: ProblemFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'negative', label: 'Минус' },
  { key: 'ads', label: 'Реклама' },
  { key: 'lowBuyout', label: 'Выкуп' },
  { key: 'stock', label: 'Остатки' },
  { key: 'lost', label: 'Потери' },
  { key: 'margin', label: 'Маржа' },
];

function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

function getGroupSelectorLabel(name: string) {
  return normalizeGroupName(name) === 'весь магазин' ? 'Весь магазин (склейка)' : name;
}

export function ProductGroupContextBar({
  tenantId,
  groups,
  groupsLoading,
  groupsError,
  activeGroupId,
  onActiveGroupChange,
  dateFrom,
  dateTo,
}: {
  tenantId: string;
  groups: ProductGroup[];
  groupsLoading: boolean;
  groupsError: Error | null;
  activeGroupId: string | null;
  onActiveGroupChange: (groupId: string) => void;
  dateFrom: string;
  dateTo: string;
}) {
  const [tab, setTab] = useState<TabKey>(activeGroupId ? 'products' : 'compare');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [problemFilter, setProblemFilter] = useState<ProblemFilter>('all');

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  const groupsForSelector = useMemo(
    () => groups.map((group) => ({ ...group, selectorLabel: getGroupSelectorLabel(group.name) })),
    [groups],
  );
  const groupMembersQuery = useQuery<ProductGroupMember[], Error>({
    queryKey: ['productGroupMembers', activeGroupId],
    queryFn: () => getGroupMembers(activeGroupId!),
    enabled: Boolean(activeGroupId),
  });
  const productsQuery = useQuery<ProductsResponse, Error>({
    queryKey: ['allProducts', tenantId],
    queryFn: async () => {
      const response = await fetch('/api/views/products/options', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить товары');
      }
      return response.json() as Promise<ProductsResponse>;
    },
    enabled: Boolean(tenantId && activeGroupId && detailsOpen && tab === 'products'),
    staleTime: 60_000,
  });
  const summaryQuery = useQuery<GroupSummaryResponse, Error>({
    queryKey: ['productGroupsSummary', tenantId, dateFrom, dateTo],
    queryFn: async () => {
      const response = await fetch(`/api/views/product-groups/summary?from=${dateFrom}&to=${dateTo}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось собрать сравнение склеек');
      }
      return response.json() as Promise<GroupSummaryResponse>;
    },
    enabled: groups.length > 0 && (Boolean(activeGroupId) || detailsOpen),
    staleTime: 60_000,
  });
  const financeQuery = useQuery<FinanceResponse, Error>({
    queryKey: ['productGroupFinanceRows', activeGroupId, dateFrom, dateTo],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/kpi-drilldown?metric=finance&from=${dateFrom}&to=${dateTo}&groupId=${encodeURIComponent(activeGroupId!)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        throw new Error('Не удалось загрузить товары склейки');
      }
      return response.json() as Promise<FinanceResponse>;
    },
    enabled: Boolean(activeGroupId && detailsOpen && (tab === 'problems' || tab === 'abc' || tab === 'segments')),
    staleTime: 30_000,
  });

  const memberIds = useMemo(
    () => new Set((groupMembersQuery.data ?? []).map((member) => Number(member.nmId))),
    [groupMembersQuery.data],
  );
  const products = useMemo(() => productsQuery.data?.data ?? [], [productsQuery.data]);
  const productByNmId = useMemo(
    () => new Map(products.map((product) => [product.nmId, product])),
    [products],
  );
  const memberProducts = useMemo(
    () => [...memberIds]
      .map((nmId) => productByNmId.get(nmId) ?? {
        nmId,
        vendorCode: `WB ${nmId}`,
        photoUrl: getWbPhotoUrl(nmId),
        title: null,
      })
      .sort((left, right) => left.vendorCode.localeCompare(right.vendorCode, 'ru') || left.nmId - right.nmId),
    [memberIds, productByNmId],
  );

  const financeRows = useMemo(() => financeQuery.data?.rows ?? [], [financeQuery.data]);
  const activeSummary = summaryQuery.data?.data.find((item) => item.id === activeGroupId) ?? null;
  const activeProblemCount = activeSummary ? countFlags(activeSummary) : 0;
  const problemRows = useMemo(() => buildProblemRows(financeRows), [financeRows]);
  const visibleProblemRows = useMemo(() => getVisibleProblemRows(problemRows, problemFilter), [problemRows, problemFilter]);
  const sliceRows = useMemo(() => buildSliceRows(financeRows), [financeRows]);
  const abcRows = useMemo(() => buildAbcSkuRows(financeRows), [financeRows]);

  function selectGroup(groupId: string) {
    onActiveGroupChange(groupId);
    setTab(groupId ? 'products' : 'compare');
    setProblemFilter('all');
  }

  function openProblems() {
    if (!activeGroup || !activeSummary || activeProblemCount <= 0) {
      return;
    }

    setDetailsOpen(true);
    setTab('problems');
    window.setTimeout(() => {
      document.getElementById('product-group-problems')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  }

  const errorMessage = groupsError?.message
    ?? groupMembersQuery.error?.message
    ?? summaryQuery.error?.message
    ?? (detailsOpen ? productsQuery.error?.message : null)
    ?? (detailsOpen ? financeQuery.error?.message : null);

  return (
    <section className="w-full overflow-visible rounded-2xl border border-border bg-card shadow-[var(--shadow-xs)]">
      <div className="grid gap-4 border-b border-border px-4 py-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-cyan-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Контекст дашборда</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={activeGroupId ?? ''}
              onChange={(event) => selectGroup(event.target.value)}
              disabled={groupsLoading}
              className="h-11 min-w-[280px] max-w-full rounded-xl border border-border bg-background px-3 text-sm font-black text-foreground outline-none transition-colors hover:border-border-strong focus:border-cyan-400 disabled:opacity-60"
            >
              <option value="">Весь магазин</option>
              {groupsForSelector.map((group) => (
                <option key={group.id} value={group.id}>{group.selectorLabel}</option>
              ))}
            </select>
            {groupsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <ContextStat label="Склеек" value={groups.length.toLocaleString('ru-RU')} />
          <ContextStat label="Товаров в склейке" value={activeGroup ? memberProducts.length.toLocaleString('ru-RU') : 'весь магазин'} />
          <ContextStat label="Прибыль склейки" value={activeSummary ? formatRub(activeSummary.profit) : 'н/д'} tone={activeSummary && activeSummary.profit < 0 ? 'bad' : 'good'} />
          <ContextStat
            label="Проблем"
            value={activeSummary ? activeProblemCount.toString() : 'сравнение'}
            tone={activeSummary && activeProblemCount > 0 ? 'bad' : 'neutral'}
            hint={activeSummary && activeProblemCount > 0 ? 'открыть' : undefined}
            onClick={activeSummary && activeProblemCount > 0 ? openProblems : undefined}
          />
        </div>

        <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
          <button
            type="button"
            onClick={() => setDetailsOpen((current) => !current)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-black text-foreground transition-colors hover:border-cyan-400/60 hover:bg-cyan-500/10"
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {detailsOpen ? 'Свернуть' : 'Подробнее'}
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      {detailsOpen ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <TabButton active={tab === 'products'} disabled={!activeGroup} onClick={() => setTab('products')} label="Товары склейки" />
              <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} label="Сравнение склеек" />
              <TabButton active={tab === 'problems'} disabled={!activeGroup} onClick={() => setTab('problems')} label="Кто тянет вниз" />
              <TabButton active={tab === 'abc'} disabled={!activeGroup} onClick={() => setTab('abc')} label="ABC товаров" />
              <TabButton active={tab === 'segments'} disabled={!activeGroup} onClick={() => setTab('segments')} label="Бренды" />
            </div>
            <Link
              href="/dynamics"
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-black text-muted-foreground transition-colors hover:border-cyan-400/60 hover:bg-cyan-500/10 hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Управление в Динамике (РНП)
            </Link>
          </div>

          <div className="px-4 py-4">
            {activeSummary && activeGroup ? (
              <PeriodComparisonPanel row={activeSummary} dateFrom={dateFrom} dateTo={dateTo} />
            ) : null}

            {tab === 'products' ? (
              activeGroup ? (
                groupMembersQuery.isFetching ? (
                  <LoadingLine text="Загружаю товары склейки..." />
                ) : (
                  <ProductsTab
                    activeGroupName={activeGroup.name}
                    memberProducts={memberProducts}
                  />
                )
              ) : (
                <EmptyHint text="Выберите склейку, чтобы увидеть список артикулов." />
              )
            ) : null}

            {tab === 'compare' ? (
              <CompareTab rows={summaryQuery.data?.data ?? []} loading={summaryQuery.isFetching} onSelect={selectGroup} />
            ) : null}

            {tab === 'problems' ? (
              activeGroup ? (
                <ProblemsTab
                  rows={visibleProblemRows}
                  allRows={problemRows}
                  sourceRows={financeRows}
                  summary={activeSummary}
                  loading={financeQuery.isFetching}
                  filter={problemFilter}
                  onFilterChange={setProblemFilter}
                />
              ) : (
                <EmptyHint text="Выберите склейку, чтобы увидеть товары с худшей прибылью, высоким расходом рекламы и низкой отдачей." />
              )
            ) : null}

            {tab === 'abc' ? (
              activeGroup ? (
                <AbcTab rows={abcRows} loading={financeQuery.isFetching} />
              ) : (
                <EmptyHint text="Выберите склейку, чтобы увидеть ABC по SKU с фото и артикулами." />
              )
            ) : null}

            {tab === 'segments' ? (
              activeGroup ? (
                <SegmentsTab rows={sliceRows} loading={financeQuery.isFetching} />
              ) : (
                <EmptyHint text="Выберите склейку, чтобы посмотреть бренды и категории внутри неё." />
              )
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function ContextStat({
  label,
  value,
  tone = 'neutral',
  hint,
  onClick,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'neutral';
  hint?: string;
  onClick?: () => void;
}) {
  const toneClass = tone === 'good'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'bad'
      ? 'text-rose-700 dark:text-rose-300'
      : 'text-foreground';
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        {hint ? <span className="text-[10px] font-black uppercase tracking-[0.08em] text-cyan-600 dark:text-cyan-300">{hint}</span> : null}
      </div>
      <p className={`mt-1 truncate text-sm font-black ${toneClass}`}>{value}</p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:border-cyan-400/70 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        aria-label={`${label}: ${value}. Открыть детали`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      {content}
    </div>
  );
}

function TabButton({
  active,
  disabled = false,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center rounded-xl border px-3 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? 'border-cyan-500 bg-cyan-500 text-white'
          : 'border-border bg-background text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function ProductsTab({
  activeGroupName,
  memberProducts,
}: {
  activeGroupName: string;
  memberProducts: ProductOption[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-foreground">Артикулы в склейке: {activeGroupName}</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">Состав редактируется в динамике продаж склейки.</p>
        </div>
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-black text-foreground">
          {memberProducts.length} SKU
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {memberProducts.length ? memberProducts.map((product) => (
          <ProductMiniCard key={product.nmId} product={product} />
        )) : (
          <EmptyHint text="В этой склейке пока нет товаров." />
        )}
      </div>
    </div>
  );
}

function ProductMiniCard({ product }: { product: ProductOption }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3">
      <ProductThumb product={product} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black text-foreground">{product.vendorCode}</p>
        <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">WB {product.nmId}</p>
        <p className="mt-1 text-[10px] font-bold text-muted-foreground">
          Остаток: {formatNumber(product.currentStock)} · Цена: {formatRub(product.currentPrice)}
        </p>
      </div>
    </div>
  );
}

function PeriodComparisonPanel({ row, dateFrom, dateTo }: { row: GroupSummary; dateFrom: string; dateTo: string }) {
  if (!row.previous || !row.delta || !row.comparisonPeriod) {
    return null;
  }

  const metrics: Array<{
    key: keyof SummaryMetrics;
    label: string;
    format: 'rub' | 'number' | 'percent';
    deltaFormat: 'rub' | 'number' | 'pp';
    direction: 'up' | 'down' | 'neutral';
  }> = [
    { key: 'revenue', label: 'Выручка', format: 'rub', deltaFormat: 'rub', direction: 'up' },
    { key: 'profit', label: 'Прибыль', format: 'rub', deltaFormat: 'rub', direction: 'up' },
    { key: 'buyoutRate', label: 'Выкуп', format: 'percent', deltaFormat: 'pp', direction: 'up' },
    { key: 'ads', label: 'Реклама', format: 'rub', deltaFormat: 'rub', direction: 'down' },
    { key: 'stocks', label: 'Остатки', format: 'number', deltaFormat: 'number', direction: 'neutral' },
    { key: 'lostOrdersSum', label: 'Потери', format: 'rub', deltaFormat: 'rub', direction: 'down' },
  ];

  return (
    <div className="mb-4 rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-foreground">Сравнение периодов</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            Текущий: {dateFrom} — {dateTo}. Предыдущий: {row.comparisonPeriod.from} — {row.comparisonPeriod.to}.
          </p>
        </div>
        <span className="rounded-full border border-border bg-card px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground">
          {row.comparisonPeriod.days} дн.
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2">Метрика</th>
              <th className="px-3 py-2 text-right">Было</th>
              <th className="px-3 py-2 text-right">Стало</th>
              <th className="px-3 py-2 text-right">Изменение</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const previous = row.previous?.[metric.key] ?? 0;
              const current = row[metric.key] ?? 0;
              const delta = row.delta?.[metric.key] ?? 0;
              const deltaPct = row.deltaPct?.[metric.key] ?? null;
              return (
                <tr key={metric.key} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-2 font-black text-foreground">{metric.label}</td>
                  <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatMetricValue(previous, metric.format)}</td>
                  <td className="px-3 py-2 text-right font-black text-foreground">{formatMetricValue(current, metric.format)}</td>
                  <td className={`px-3 py-2 text-right font-black ${getComparisonTone(delta, metric.direction)}`}>
                    {formatMetricDelta(delta, metric.deltaFormat)}
                    {deltaPct !== null ? <span className="ml-1 text-[10px] font-bold opacity-80">({formatSignedPercent(deltaPct)})</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareTab({ rows, loading, onSelect }: { rows: GroupSummary[]; loading: boolean; onSelect: (groupId: string) => void }) {
  const sortedRows = [...rows].sort((left, right) => right.profit - left.profit);

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-foreground">Сравнение склеек</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">Выручка, прибыль, ROI, выкуп, реклама и остатки за выбранный период.</p>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2">Склейка</th>
              <th className="px-3 py-2 text-right">SKU</th>
              <th className="px-3 py-2 text-right">Выручка</th>
              <th className="px-3 py-2 text-right">Прибыль</th>
              <th className="px-3 py-2 text-right">ROI</th>
              <th className="px-3 py-2 text-right">Выкуп</th>
              <th className="px-3 py-2 text-right">Реклама</th>
              <th className="px-3 py-2 text-right">CPO</th>
              <th className="px-3 py-2 text-right">Остатки</th>
              <th className="px-3 py-2">Риски</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className="inline-flex max-w-[260px] items-center gap-2 truncate font-black text-foreground hover:text-cyan-600"
                  >
                    <Layers3 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{row.name}</span>
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatNumber(row.memberCount)}</td>
                <td className="px-3 py-2 text-right font-black text-foreground">{formatRub(row.revenue)}</td>
                <td className={`px-3 py-2 text-right font-black ${row.profit < 0 ? 'text-rose-600' : 'text-foreground'}`}>{formatRub(row.profit)}</td>
                <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatPercent(row.roi)}</td>
                <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatPercent(row.buyoutRate)}</td>
                <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatRub(row.ads)}</td>
                <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatRub(row.adsCpo)}</td>
                <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatNumber(row.stocks)}</td>
                <td className="px-3 py-2">
                  <RiskPills row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProblemsTab({
  rows,
  allRows,
  sourceRows,
  summary,
  loading,
  filter,
  onFilterChange,
}: {
  rows: FinanceRow[];
  allRows: FinanceRow[];
  sourceRows: FinanceRow[];
  summary: GroupSummary | null;
  loading: boolean;
  filter: ProblemFilter;
  onFilterChange: (filter: ProblemFilter) => void;
}) {
  if (loading) {
    return <LoadingLine text="Собираю проблемные товары..." />;
  }

  const stockSizeCoverage = getStockSizeCoverage(sourceRows);

  return (
    <div id="product-group-problems" className="rounded-2xl border border-border bg-background p-4 scroll-mt-28">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-foreground">Кто тянет склейку вниз</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">Фильтры показывают конкретную причину: минус, реклама, низкий выкуп, остатки, потери или слабая маржа.</p>
        </div>
        <AlertTriangle className="h-4 w-4 text-amber-500" />
      </div>
      <ProblemSummaryCards
        summary={summary}
        rows={allRows}
        stockSizeCoverage={stockSizeCoverage}
        onFilterChange={onFilterChange}
      />
      <ProblemFilterBar rows={allRows} active={filter} onChange={onFilterChange} />
      {summary?.flags.stockRisk && stockSizeCoverage.total > 0 && stockSizeCoverage.missing > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-800 dark:text-amber-200">
          {stockSizeCoverage.covered > 0
            ? `SKU-разбивка потерянных заказов неполная: WB вернул stock_sizes по ${formatNumber(stockSizeCoverage.covered)} из ${formatNumber(stockSizeCoverage.total)} SKU. По остальным показываю кандидатов по остаткам, дням и экономике.`
            : 'Точной SKU-разбивки потерянных заказов нет: WB не вернул stock_sizes по SKU этой склейки. Ниже показываю кандидатов по низкому остатку, дням остатка и слабой экономике.'}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyHint text={filter === 'all' ? 'По SKU нет явной просадки, но выше показаны проблемы на уровне склейки.' : 'В выбранном фильтре нет SKU. Переключите причину или смотрите проблему на уровне всей склейки.'} />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1480px] text-left text-xs">
            <thead className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2">Товар</th>
                <th className="px-3 py-2 text-right">Выручка</th>
                <th className="px-3 py-2 text-right">Прибыль</th>
                <th className="px-3 py-2 text-right">Маржа</th>
                <th className="px-3 py-2 text-right">Заказы / выкуп</th>
                <th className="px-3 py-2 text-right">Расходы</th>
                <th className="px-3 py-2 text-right">Реклама</th>
                <th className="px-3 py-2 text-right">Потери</th>
                <th className="px-3 py-2 text-right">Остаток</th>
                <th className="px-3 py-2 text-right">Дней</th>
                <th className="px-3 py-2 text-right">Себес.</th>
                <th className="px-3 py-2">Причина</th>
                <th className="px-3 py-2">Действие</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const reason = getProblemReason(row);
                const marginPct = getMarginPct(row);
                return (
                  <tr key={row.nmId} className="border-b border-border/70 last:border-0">
                    <td className="px-3 py-2">
                      <ProductIdentity row={row} />
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatRub(row.revenue)}</td>
                    <td className={`px-3 py-2 text-right font-black ${toNumber(row.profit) < 0 ? 'text-rose-600' : 'text-foreground'}`}>{formatRub(row.profit)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${marginPct != null && marginPct < 25 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{formatOptionalPercent(marginPct)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${isLowBuyoutRow(row) ? 'text-rose-600' : 'text-muted-foreground'}`}>{formatSkuBuyout(row)}</td>
                    <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatRub(row.expenses)}</td>
                    <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatRub(row.ads)}</td>
                    <td className={`px-3 py-2 text-right font-black ${getLossTone(row)}`}>
                      {formatLoss(row)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatNumber(row.currentStock)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${isLowStockDays(row) ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{formatStockDays(row)}</td>
                    <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatRub(row.costPrice || row.cogs)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${getProblemTone(row)}`}>
                        {reason}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex max-w-[220px] rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-black text-cyan-700 dark:text-cyan-300">
                        {getProblemAction(row)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProblemSummaryCards({
  summary,
  rows,
  stockSizeCoverage,
  onFilterChange,
}: {
  summary: GroupSummary | null;
  rows: FinanceRow[];
  stockSizeCoverage: StockSizeCoverage;
  onFilterChange: (filter: ProblemFilter) => void;
}) {
  const problems = summary ? buildGroupProblems(summary, rows, stockSizeCoverage) : [];

  if (!summary) {
    return null;
  }

  if (problems.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
        По сводным флагам проблем нет.
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-2 lg:grid-cols-2">
      {problems.map((problem) => (
        <button
          key={problem.key}
          type="button"
          onClick={() => onFilterChange(problem.filter)}
          className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-3 text-left transition-colors hover:border-rose-400/60 hover:bg-rose-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-black text-rose-700 dark:text-rose-300">{problem.title}</p>
              <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{problem.description}</p>
            </div>
            <span className="rounded-full border border-rose-400/30 bg-background px-2 py-1 text-[10px] font-black text-rose-700 dark:text-rose-300">
              {problem.value}
            </span>
          </div>
          <p className="mt-2 text-[11px] font-black text-foreground">{problem.action}</p>
        </button>
      ))}
    </div>
  );
}

function ProblemFilterBar({
  rows,
  active,
  onChange,
}: {
  rows: FinanceRow[];
  active: ProblemFilter;
  onChange: (filter: ProblemFilter) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="inline-flex h-8 items-center gap-1 rounded-xl border border-border bg-card px-2 text-[10px] font-black uppercase tracking-[0.1em] text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Причина
      </span>
      {PROBLEM_FILTERS.map((item) => {
        const count = item.key === 'all' ? rows.length : rows.filter((row) => rowMatchesProblemFilter(row, item.key)).length;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`inline-flex h-8 items-center gap-2 rounded-xl border px-3 text-xs font-black transition-colors ${
              active === item.key
                ? 'border-cyan-500 bg-cyan-500 text-white'
                : 'border-border bg-background text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground'
            }`}
          >
            {item.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active === item.key ? 'bg-white/20 text-white' : 'bg-card text-muted-foreground'}`}>
              {formatNumber(count)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AbcTab({ rows, loading }: { rows: AbcSkuRow[]; loading: boolean }) {
  if (loading) {
    return <LoadingLine text="Собираю ABC по товарам..." />;
  }

  if (rows.length === 0) {
    return <EmptyHint text="По выбранной склейке нет выручки для ABC за период." />;
  }

  const groups: Array<{ bucket: AbcBucket; title: string; note: string }> = [
    { bucket: 'A', title: 'A — топ', note: 'Основная выручка. Главное действие: держать наличие и не ломать цену.' },
    { bucket: 'B', title: 'B — середина', note: 'Товары для дотягивания: смотреть маржу, остатки и умеренный трафик.' },
    { bucket: 'C', title: 'C — хвост', note: 'Слабая отдача. Проверять рекламу, цену, остатки и необходимость докупки.' },
  ];

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const bucketRows = rows.filter((row) => row.bucket === group.bucket);
        const revenue = bucketRows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
        const profit = bucketRows.reduce((sum, row) => sum + toNumber(row.profit), 0);

        return (
          <div key={group.bucket} className="rounded-2xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-foreground">{group.title}</p>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">{group.note}</p>
              </div>
              <div className="grid min-w-[320px] grid-cols-3 gap-2">
                <ContextStat label="SKU" value={formatNumber(bucketRows.length)} />
                <ContextStat label="Выручка" value={formatRub(revenue)} />
                <ContextStat label="Прибыль" value={formatRub(profit)} tone={profit < 0 ? 'bad' : 'good'} />
              </div>
            </div>

            {bucketRows.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[1120px] text-left text-xs">
                  <thead className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2">Товар</th>
                      <th className="px-3 py-2 text-right">Выручка</th>
                      <th className="px-3 py-2 text-right">Доля</th>
                      <th className="px-3 py-2 text-right">Накоп.</th>
                      <th className="px-3 py-2 text-right">Прибыль</th>
                      <th className="px-3 py-2 text-right">Маржа</th>
                      <th className="px-3 py-2 text-right">Реклама</th>
                      <th className="px-3 py-2 text-right">Остаток</th>
                      <th className="px-3 py-2">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bucketRows.map((row) => (
                      <tr key={`${row.bucket}-${row.nmId}`} className="border-b border-border/70 last:border-0">
                        <td className="px-3 py-2">
                          <ProductIdentity row={row} />
                        </td>
                        <td className="px-3 py-2 text-right font-black text-foreground">{formatRub(row.revenue)}</td>
                        <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatOptionalPercent(row.revenueShare)}</td>
                        <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatOptionalPercent(row.cumulativeShare)}</td>
                        <td className={`px-3 py-2 text-right font-black ${toNumber(row.profit) < 0 ? 'text-rose-600' : 'text-foreground'}`}>{formatRub(row.profit)}</td>
                        <td className={`px-3 py-2 text-right font-bold ${row.marginPct != null && row.marginPct < 25 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{formatOptionalPercent(row.marginPct)}</td>
                        <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatRub(row.ads)}</td>
                        <td className="px-3 py-2 text-right font-bold text-muted-foreground">{formatNumber(row.currentStock)}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-black text-cyan-700 dark:text-cyan-300">
                            {row.action}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-card px-4 py-5 text-xs font-bold text-muted-foreground">
                В этой группе нет товаров.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SegmentsTab({ rows, loading }: { rows: SliceRow[]; loading: boolean }) {
  if (loading) {
    return <LoadingLine text="Собираю срезы по брендам..." />;
  }

  if (rows.length === 0) {
    return <EmptyHint text="По выбранной склейке нет данных для срезов за период." />;
  }

  const brandRows = rows.filter((row) => row.type === 'Бренд');
  const categoryRows = rows.filter((row) => row.type === 'Категория');
  const hasRealSplit = brandRows.length > 1 || categoryRows.length > 1;

  if (!hasRealSplit) {
    const brand = brandRows[0]?.name ?? 'не указан';
    const category = categoryRows[0]?.name ?? 'не указана';
    return (
      <EmptyHint text={`В этой склейке один бренд (${brand}) и одна категория (${category}). Отдельный брендовый срез сейчас не даёт полезного сравнения.`} />
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div>
        <p className="text-sm font-black text-foreground">Бренды и категории</p>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">Показываю только когда внутри склейки есть реальное разделение по брендам или категориям.</p>
      </div>
      <div className="mt-4 space-y-2">
        {rows.slice(0, 16).map((row) => (
          <div key={`${row.type}-${row.name}`} className="grid grid-cols-[1fr_110px_130px] gap-3 rounded-xl border border-border bg-card px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-black text-foreground">{row.name}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{row.type} · {row.count} SKU</p>
            </div>
            <p className="text-right font-bold text-muted-foreground">{formatRub(row.revenue)}</p>
            <p className={`text-right font-black ${row.profit < 0 ? 'text-rose-600' : 'text-foreground'}`}>{formatRub(row.profit)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductIdentity({ row }: { row: FinanceRow }) {
  return (
    <div className="flex min-w-[260px] items-center gap-3">
      <ProductThumb product={row} />
      <div className="min-w-0">
        <p className="truncate text-xs font-black text-foreground">{row.vendorCode || row.brand || `WB ${row.nmId}`}</p>
        <p className="mt-0.5 font-mono text-[10px] font-black text-muted-foreground">WB {row.nmId}</p>
        <p className="mt-0.5 truncate text-[10px] font-bold text-muted-foreground">{row.category || row.brand || 'категория не указана'}</p>
      </div>
    </div>
  );
}

function ProductThumb({ product }: { product: { nmId: number; photoUrl?: string | null; vendorCode?: string | null; title?: string | null } }) {
  const src = product.photoUrl?.trim() || getWbPhotoUrl(product.nmId);
  return (
    <span
      className="h-10 w-10 shrink-0 rounded-xl border border-border bg-white bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${src}")` }}
      aria-label={product.vendorCode ?? product.title ?? `WB ${product.nmId}`}
    />
  );
}

function RiskPills({ row }: { row: GroupSummary }) {
  const risks = [
    row.flags.negativeProfit ? 'минус' : null,
    row.flags.lowBuyout ? 'низкий выкуп' : null,
    row.flags.highCpo ? 'CPO' : null,
    row.flags.stockRisk ? 'остатки' : null,
  ].filter((item): item is string => Boolean(item));

  if (risks.length === 0) {
    return <span className="text-xs font-bold text-muted-foreground">нет явных</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {risks.map((risk) => (
        <span key={risk} className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-black text-rose-700 dark:text-rose-300">
          {risk}
        </span>
      ))}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-8 text-center text-sm font-bold text-muted-foreground">
      {text}
    </div>
  );
}

function LoadingLine({ text }: { text: string }) {
  return (
    <div className="flex min-h-[160px] items-center justify-center gap-3 rounded-2xl border border-border bg-background text-sm font-bold text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
      {text}
    </div>
  );
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatRub(value: unknown) {
  return `${Math.round(toNumber(value)).toLocaleString('ru-RU')} ₽`;
}

function formatSignedRub(value: unknown) {
  const numeric = Math.round(toNumber(value));
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${Math.abs(numeric).toLocaleString('ru-RU')} ₽`;
}

function formatNumber(value: unknown) {
  return Math.round(toNumber(value)).toLocaleString('ru-RU');
}

function formatSignedNumber(value: unknown) {
  const numeric = Math.round(toNumber(value));
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${Math.abs(numeric).toLocaleString('ru-RU')}`;
}

function formatPercent(value: unknown) {
  return `${toNumber(value).toFixed(1)}%`;
}

function formatSignedPercent(value: unknown) {
  const numeric = toNumber(value);
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${Math.abs(numeric).toFixed(1)}%`;
}

function formatOptionalPercent(value: number | null | undefined) {
  return value === null || value === undefined ? 'н/д' : `${value.toFixed(1)}%`;
}

function formatMetricValue(value: unknown, format: 'rub' | 'number' | 'percent') {
  if (format === 'rub') {
    return formatRub(value);
  }

  if (format === 'percent') {
    return formatPercent(value);
  }

  return formatNumber(value);
}

function formatMetricDelta(value: unknown, format: 'rub' | 'number' | 'pp') {
  if (format === 'rub') {
    return formatSignedRub(value);
  }

  if (format === 'pp') {
    const numeric = toNumber(value);
    const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    return `${sign}${Math.abs(numeric).toFixed(1)} п.п.`;
  }

  return formatSignedNumber(value);
}

function getComparisonTone(delta: unknown, direction: 'up' | 'down' | 'neutral') {
  const numeric = toNumber(delta);
  if (numeric === 0 || direction === 'neutral') {
    return 'text-muted-foreground';
  }

  const isGood = direction === 'up' ? numeric > 0 : numeric < 0;
  return isGood ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300';
}

function formatStockDays(row: FinanceRow) {
  const stockAnalyticsDays = toNumber(row.stockAnalyticsDays);
  const daysOfStock = toNumber(row.daysOfStock);
  const value = stockAnalyticsDays > 0 ? stockAnalyticsDays : daysOfStock;

  if (value <= 0 || value >= 999) {
    return 'н/д';
  }

  return `${Math.round(value).toLocaleString('ru-RU')} дн`;
}

function formatLoss(row: FinanceRow) {
  if (row.stockSizeAvailable === false) {
    return 'н/д';
  }

  const lostOrders = toNumber(row.lostOrders);
  const lostOrdersSum = toNumber(row.lostOrdersSum);

  if (lostOrders <= 0 && lostOrdersSum <= 0) {
    return '0';
  }

  return `${Math.round(lostOrders).toLocaleString('ru-RU')} / ${formatRub(lostOrdersSum)}`;
}

function getLossTone(row: FinanceRow) {
  if (row.stockSizeAvailable === false) {
    return 'text-amber-700 dark:text-amber-300';
  }

  return toNumber(row.lostOrdersSum) > 0 || toNumber(row.lostOrders) > 0
    ? 'text-rose-600'
    : 'text-muted-foreground';
}

function formatSkuBuyout(row: FinanceRow) {
  const orders = toNumber(row.orders);
  const buyouts = toNumber(row.buyouts);

  if (orders <= 0) {
    return 'н/д';
  }

  const buyoutRate = toNumber(row.buyoutRate) > 0 ? toNumber(row.buyoutRate) : (buyouts / orders) * 100;
  return `${formatNumber(buyouts)}/${formatNumber(orders)} · ${formatPercent(buyoutRate)}`;
}

function countFlags(row: GroupSummary) {
  return Object.values(row.flags).filter(Boolean).length;
}

function getStockSizeCoverage(rows: FinanceRow[]): StockSizeCoverage {
  const total = rows.filter((row) => toNumber(row.nmId) > 0).length;
  const covered = rows.filter((row) => row.stockSizeAvailable === true).length;
  return {
    total,
    covered,
    missing: Math.max(total - covered, 0),
  };
}

function buildGroupProblems(row: GroupSummary, rows: FinanceRow[], stockSizeCoverage: StockSizeCoverage) {
  const problems: Array<{ key: string; title: string; description: string; value: string; action: string; filter: ProblemFilter }> = [];
  const negativeRows = rows.filter((item) => toNumber(item.profit) < 0);
  const negativeLoss = negativeRows.reduce((sum, item) => sum + Math.abs(Math.min(toNumber(item.profit), 0)), 0);
  const lowBuyoutRows = rows.filter(isLowBuyoutRow);
  const adsRows = rows.filter(isAdsProblemRow);
  const adsSpend = adsRows.reduce((sum, item) => sum + toNumber(item.ads), 0);
  const stockRows = rows.filter(isStockProblemRow);
  const skuLostOrders = rows.reduce((sum, item) => sum + toNumber(item.lostOrders), 0);
  const skuLostOrdersSum = rows.reduce((sum, item) => sum + toNumber(item.lostOrdersSum), 0);

  if (row.flags.negativeProfit) {
    problems.push({
      key: 'negativeProfit',
      title: 'Минусовая прибыль склейки',
      description: negativeRows.length
        ? `SKU с минусом: ${formatNumber(negativeRows.length)}. Суммарный минус: ${formatRub(negativeLoss)}.`
        : 'Суммарная чистая прибыль по склейке ушла ниже нуля, но минус размазан по расходам уровня склейки.',
      value: formatRub(row.profit),
      action: 'Открыть SKU с минусом: сначала проверить цену, себестоимость и рекламный расход.',
      filter: 'negative',
    });
  }

  if (row.flags.lowBuyout) {
    problems.push({
      key: 'lowBuyout',
      title: 'Низкий выкуп',
      description: `Выкуп ниже 70%: заказано ${formatNumber(row.orders)}, выкуплено ${formatNumber(row.buyouts)}.`,
      value: formatPercent(row.buyoutRate),
      action: lowBuyoutRows.length
        ? `Открыть SKU с низким выкупом: найдено ${formatNumber(lowBuyoutRows.length)}.`
        : 'SKU-разбивки выкупа за этот период не вижу: нужен точный funnel по SKU.',
      filter: 'lowBuyout',
    });
  }

  if (row.flags.highCpo) {
    problems.push({
      key: 'highCpo',
      title: 'Высокий CPO рекламы',
      description: adsRows.length
        ? `SKU, где реклама съедает прибыль: ${formatNumber(adsRows.length)}. Их расход: ${formatRub(adsSpend)}.`
        : `Рекламный расход ${formatRub(row.ads)} при ${formatNumber(row.buyouts)} выкупах.`,
      value: formatRub(row.adsCpo),
      action: 'Открыть рекламные SKU: резать кампании, где реклама выше прибыли.',
      filter: 'ads',
    });
  }

  if (row.flags.stockRisk) {
    problems.push({
      key: 'stockRisk',
      title: 'Риск по остаткам',
      description: `Есть потерянные заказы: ${formatNumber(row.lostOrders)} шт. на ${formatRub(row.lostOrdersSum)}.`,
      value: formatNumber(row.stocks),
      action: skuLostOrders > 0 || skuLostOrdersSum > 0
        ? stockSizeCoverage.missing > 0
          ? `Ниже подняты SKU с потерями из покрытой части: ${formatNumber(skuLostOrders)} шт. на ${formatRub(skuLostOrdersSum)}. Без stock_sizes: ${formatNumber(stockSizeCoverage.missing)} SKU.`
          : `Ниже подняты SKU с потерями: ${formatNumber(skuLostOrders)} шт. на ${formatRub(skuLostOrdersSum)}.`
        : stockSizeCoverage.covered > 0 && stockSizeCoverage.missing > 0
          ? `WB дал stock_sizes по ${formatNumber(stockSizeCoverage.covered)} из ${formatNumber(stockSizeCoverage.total)} SKU; кандидатов по остаткам: ${formatNumber(stockRows.length)}.`
          : `Точной SKU-разбивки потерь нет в raw_api_stock_sizes; кандидатов по остаткам: ${formatNumber(stockRows.length)}.`,
      filter: skuLostOrders > 0 || skuLostOrdersSum > 0 ? 'lost' : 'stock',
    });
  }

  return problems;
}

function getMarginPct(row: FinanceRow) {
  const revenue = toNumber(row.revenue);
  if (revenue <= 0) {
    return null;
  }

  return (toNumber(row.profit) / revenue) * 100;
}

function getProblemReason(row: FinanceRow) {
  const profit = toNumber(row.profit);
  const ads = toNumber(row.ads);
  const marginPct = getMarginPct(row);

  if (profit < 0) {
    return 'минусовая прибыль';
  }

  if (toNumber(row.lostOrders) > 0 || toNumber(row.lostOrdersSum) > 0) {
    return 'потерянные заказы';
  }

  if (isLowBuyoutRow(row)) {
    return 'низкий выкуп';
  }

  if (ads > 0 && ads >= Math.max(profit, 1)) {
    return 'реклама съедает прибыль';
  }

  if (marginPct !== null && marginPct < 25) {
    return 'низкая маржа';
  }

  if (toNumber(row.quantity) > 0 && toNumber(row.currentStock) <= 0) {
    return 'нет остатка';
  }

  if (toNumber(row.quantity) > 0 && isLowStockDays(row)) {
    return 'остатка мало';
  }

  if (toNumber(row.currentStock) > 0 && toNumber(row.quantity) <= 0) {
    return 'остаток без продаж';
  }

  return 'низкая отдача';
}

function getProblemTone(row: FinanceRow) {
  const reason = getProblemReason(row);

  if (reason === 'минусовая прибыль' || reason === 'потерянные заказы') {
    return 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  }

  if (reason === 'реклама съедает прибыль' || reason === 'низкий выкуп') {
    return 'border-orange-400/30 bg-orange-500/10 text-orange-700 dark:text-orange-300';
  }

  return 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

function getProblemAction(row: FinanceRow) {
  const reason = getProblemReason(row);

  if (reason === 'минусовая прибыль') {
    return 'проверить цену, себес. и рекламу';
  }

  if (reason === 'потерянные заказы') {
    return 'пополнить остаток в приоритет';
  }

  if (reason === 'низкий выкуп') {
    return 'сверить ожидание/факт и размеры';
  }

  if (reason === 'реклама съедает прибыль') {
    return 'урезать или отделить кампанию';
  }

  if (reason === 'низкая маржа') {
    return 'пересчитать цену и скидку';
  }

  if (reason === 'нет остатка' || reason === 'остатка мало') {
    return 'проверить поставку на неделю';
  }

  if (reason === 'остаток без продаж') {
    return 'не докупать, проверить цену';
  }

  return 'сравнить с A-SKU склейки';
}

function buildProblemRows(rows: FinanceRow[]) {
  return [...rows]
    .filter((row) => toNumber(row.revenue) > 0 || toNumber(row.profit) < 0 || toNumber(row.ads) > 0 || isLowBuyoutRow(row) || hasLostOrders(row) || isStockProblemRow(row))
    .sort((left, right) => {
      const leftMargin = getMarginPct(left) ?? 999;
      const rightMargin = getMarginPct(right) ?? 999;
      return getProblemPriority(left) - getProblemPriority(right)
        || toNumber(right.lostOrdersSum) - toNumber(left.lostOrdersSum)
        || toNumber(right.lostOrders) - toNumber(left.lostOrders)
        || toNumber(left.profit) - toNumber(right.profit)
        || leftMargin - rightMargin
        || toNumber(right.ads) - toNumber(left.ads);
    });
}

function getVisibleProblemRows(rows: FinanceRow[], filter: ProblemFilter) {
  const filtered = filter === 'all'
    ? rows
    : rows.filter((row) => rowMatchesProblemFilter(row, filter));
  return filtered.slice(0, filter === 'all' ? 40 : 80);
}

function rowMatchesProblemFilter(row: FinanceRow, filter: ProblemFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'negative') {
    return toNumber(row.profit) < 0;
  }

  if (filter === 'ads') {
    return isAdsProblemRow(row);
  }

  if (filter === 'lowBuyout') {
    return isLowBuyoutRow(row);
  }

  if (filter === 'stock') {
    return isStockProblemRow(row);
  }

  if (filter === 'lost') {
    return hasLostOrders(row);
  }

  return isLowMarginRow(row);
}

function isAdsProblemRow(row: FinanceRow) {
  return toNumber(row.ads) > 0 && toNumber(row.ads) >= Math.max(toNumber(row.profit), 1);
}

function isLowBuyoutRow(row: FinanceRow) {
  const orders = toNumber(row.orders);
  const buyoutRate = toNumber(row.buyoutRate);
  return orders >= 3 && buyoutRate > 0 && buyoutRate < 70;
}

function isLowMarginRow(row: FinanceRow) {
  const marginPct = getMarginPct(row);
  return marginPct !== null && marginPct < 25;
}

function hasLostOrders(row: FinanceRow) {
  return toNumber(row.lostOrders) > 0 || toNumber(row.lostOrdersSum) > 0;
}

function getProblemPriority(row: FinanceRow) {
  if (toNumber(row.profit) < 0) {
    return 0;
  }

  if (hasLostOrders(row)) {
    return 1;
  }

  if (isLowBuyoutRow(row)) {
    return 2;
  }

  if (isAdsProblemRow(row)) {
    return 3;
  }

  if (isLowMarginRow(row)) {
    return 4;
  }

  if (isStockProblemRow(row)) {
    return 5;
  }

  return 6;
}

function isStockProblemRow(row: FinanceRow) {
  const quantity = toNumber(row.quantity);
  const currentStock = toNumber(row.currentStock);
  const stockAnalyticsDays = toNumber(row.stockAnalyticsDays);
  const daysOfStock = stockAnalyticsDays > 0 ? stockAnalyticsDays : toNumber(row.daysOfStock);

  return (quantity > 0 && (currentStock <= 0 || (daysOfStock > 0 && daysOfStock <= 7)))
    || (currentStock > 0 && quantity <= 0);
}

function isLowStockDays(row: FinanceRow) {
  const stockAnalyticsDays = toNumber(row.stockAnalyticsDays);
  const daysOfStock = toNumber(row.daysOfStock);
  const value = stockAnalyticsDays > 0 ? stockAnalyticsDays : daysOfStock;

  return value > 0 && value <= 7;
}

function getAbcAction(bucket: AbcBucket, row: FinanceRow) {
  const profit = toNumber(row.profit);
  const ads = toNumber(row.ads);
  const marginPct = getMarginPct(row);

  if (profit < 0) {
    return 'исправить минус';
  }

  if (ads > 0 && ads >= Math.max(profit, 1)) {
    return 'урезать рекламу';
  }

  if (marginPct !== null && marginPct < 25) {
    return 'проверить цену';
  }

  if (bucket === 'A') {
    return toNumber(row.currentStock) > 0 ? 'держать наличие' : 'пополнить';
  }

  if (bucket === 'B') {
    return 'дотянуть до A';
  }

  return toNumber(row.currentStock) > 0 ? 'не докупать' : 'оставить в хвосте';
}

function buildSliceRows(rows: FinanceRow[]): SliceRow[] {
  const result = new Map<string, { type: string; name: string; count: Set<number>; revenue: number; profit: number }>();

  for (const row of rows) {
    for (const [type, rawName] of [
      ['Бренд', row.brand],
      ['Категория', row.category],
    ] as const) {
      const name = rawName?.trim() || 'Не указано';
      const key = `${type}:${name}`;
      const current = result.get(key) ?? { type, name, count: new Set<number>(), revenue: 0, profit: 0 };
      current.count.add(row.nmId);
      current.revenue += toNumber(row.revenue);
      current.profit += toNumber(row.profit);
      result.set(key, current);
    }
  }

  return [...result.values()]
    .map((row) => ({ ...row, count: row.count.size }))
    .sort((left, right) => right.revenue - left.revenue || right.profit - left.profit);
}

function buildAbcSkuRows(rows: FinanceRow[]): AbcSkuRow[] {
  const sorted = [...rows]
    .filter((row) => toNumber(row.revenue) > 0)
    .sort((left, right) => toNumber(right.revenue) - toNumber(left.revenue));
  const totalRevenue = sorted.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  let cumulative = 0;

  return sorted.map((row, index) => {
    const revenueShare = totalRevenue > 0 ? (toNumber(row.revenue) / totalRevenue) * 100 : 0;
    const nextCumulative = cumulative + revenueShare;
    const bucket: AbcBucket = nextCumulative <= 80 || index === 0
      ? 'A'
      : nextCumulative <= 95
        ? 'B'
        : 'C';
    cumulative = nextCumulative;

    return {
      ...row,
      rank: index + 1,
      bucket,
      revenueShare,
      cumulativeShare: cumulative,
      marginPct: getMarginPct(row),
      action: getAbcAction(bucket, row),
    };
  });
}
