'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Columns3,
  DatabaseZap,
  FileText,
  Gauge,
  LayoutGrid,
  LineChart,
  Loader2,
  Megaphone,
  PackageSearch,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  Warehouse,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';

import { getGroups } from '@/app/(dashboard)/product-groups/actions';
import { getSyncRunsHistory } from '@/app/(dashboard)/settings/sync-action';
import { KPICards, type DashboardMetricKey } from '@/components/dashboard/KPICards';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { PnLChart } from '@/components/dashboard/PnLChart';
import { ProductGroupContextBar } from '@/components/dashboard/ProductGroupContextBar';
import { OPEN_KPI_DRILLDOWN_EVENT, type KpiDrilldownMetric } from '@/components/dashboard/expenseBreakdownEvents';
import { toLocalDateParam } from '@/lib/date-range';
import { useStore } from '@/store/useStore';

type DashboardProductHighlight = {
  nmId: number;
  photoUrl: string | null;
  brand: string | null;
  vendorCode: string | null;
  soldQuantity: number;
  grossRevenue: number;
  netProfit: number;
  adSpend: number;
};

type DashboardWarehouseRevenueRow = {
  warehouseName: string;
  revenue: number;
  salesCount: number;
  sharePct: number;
};

type ProductGroup = {
  id: string;
  name: string;
};

type DashboardResponse = {
  chart: Array<Record<string, unknown>>;
  chartComparison?: {
    period: {
      from: string;
      to: string;
    };
    rows: Array<Record<string, unknown>>;
  };
  kpi: Record<string, unknown> & {
    toplineSource?: 'exact_funnel' | 'finance_only';
  };
  salesPlan?: {
    planCount: number;
    plannedOrders: number;
    plannedRevenue: number;
    actualOrders: number;
    actualRevenue: number;
    progressPct: number;
    projectedOrders: number;
    remainingOrders: number;
    daysElapsedPct: number;
    paceStatus: 'ahead' | 'behind' | 'on_track' | 'not_started';
  } | null;
  products: {
    topSelling: DashboardProductHighlight[];
    leastSelling: DashboardProductHighlight[];
  };
  warehouseRevenue?: {
    rows: DashboardWarehouseRevenueRow[];
    totalRevenue: number;
    warehouseCount: number;
    source: 'raw_api_sales';
  };
  scope?: {
    type: 'all' | 'group';
    groupId: string | null;
    groupName?: string | null;
  };
};

const DASHBOARD_CLIENT_TIMEOUT_MS = 30_000;
const DASHBOARD_FALLBACK_REFRESH_MS = 5 * 60_000;
const DASHBOARD_REFRESH_JITTER_MS = 30_000;
const SYNC_STATUS_IDLE_POLL_MS = 60_000;
const SYNC_STATUS_RUNNING_POLL_MS = 15_000;
const SYNC_STATUS_POLL_JITTER_MS = 5_000;
const DEFERRED_OVERVIEW_SECTIONS_TIMEOUT_MS = 2_500;

const DeferredExpensesSection = dynamic(
  () => import('@/components/dashboard/ExpensesSection').then((mod) => mod.ExpensesSection),
  {
    ssr: false,
    loading: () => <DeferredOverviewSectionSkeleton label="Расходы" />,
  },
);

const DeferredProductSalesHighlights = dynamic(
  () => import('@/components/dashboard/ProductSalesHighlights').then((mod) => mod.ProductSalesHighlights),
  {
    ssr: false,
    loading: () => <DeferredOverviewSectionSkeleton label="Товары" compact />,
  },
);

type DashboardVariant = 'kpi-first' | 'cockpit' | 'matrix' | 'chart-top' | 'kpi-grid';

type DashboardSyncRun = {
  id: string;
  status: string;
  finishedAt: string | Date | null;
};

type KpiDrilldownRow = {
  nmId: number;
  brand?: string | null;
  vendorCode?: string | null;
  photoUrl?: string | null;
  quantity?: number;
  amount?: number;
  revenue?: number;
  expenses?: number;
  profit?: number;
  ads?: number;
  cogs?: number;
  spend?: number;
  orderSum?: number;
  orderCount?: number;
  drr?: number | null;
  storage?: number;
  stock?: number;
  inWay?: number;
  inWayToClient?: number;
  inWayFromClient?: number;
  warehouseCount?: number;
  sppPct?: number;
  sppRub?: number;
  sppBase?: number;
  views?: number;
  buyouts?: number;
  buyoutSum?: number;
  conversionPct?: number;
  sourceRows?: number;
  sourceDays?: number;
};

type KpiDrilldownResponse = {
  metric: KpiDrilldownMetric;
  title: string;
  period: { from: string; to: string };
  totals: Record<string, unknown>;
  rows: KpiDrilldownRow[];
};

export function OverviewPageClient({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const { dateFrom, dateTo } = useStore();
  const [selectedMetric, setSelectedMetric] = useState<DashboardMetricKey>('revenue');
  const [dashboardVariant, setDashboardVariant] = useState<DashboardVariant>('matrix');
  const [drilldownMetric, setDrilldownMetric] = useState<KpiDrilldownMetric | null>(null);
  const [drilldown, setDrilldown] = useState<KpiDrilldownResponse | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const showDeferredSections = useDeferredOverviewSections();
  const dateFromParam = toLocalDateParam(dateFrom);
  const dateToParam = toLocalDateParam(dateTo);

  const groupsQuery = useQuery<ProductGroup[], Error>({
    queryKey: ['productGroups', tenantId],
    queryFn: () => getGroups(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const activeGroupId = selectedGroup?.id ?? null;
  const scopeQuery = activeGroupId ? `&groupId=${encodeURIComponent(activeGroupId)}` : '';
  const profitReportHref = `/api/views/profit-report?from=${dateFromParam}&to=${dateToParam}&format=csv${scopeQuery}`;
  const dashboardQueryKey = useMemo(
    () => ['dashboard-clean', tenantId, dateFromParam, dateToParam, activeGroupId ?? 'all'] as const,
    [tenantId, dateFromParam, dateToParam, activeGroupId],
  );
  const dashboardFallbackRefreshMs = useMemo(
    () => DASHBOARD_FALLBACK_REFRESH_MS + Math.floor(Math.random() * DASHBOARD_REFRESH_JITTER_MS),
    [],
  );
  const syncStatusPollJitterMs = useMemo(
    () => Math.floor(Math.random() * SYNC_STATUS_POLL_JITTER_MS),
    [],
  );
  const handledSyncRunKeyRef = useRef<string | null>(null);
  const latestSyncInitializedRef = useRef(false);

  useEffect(() => {
    if (!selectedGroupId || groupsQuery.isLoading) {
      return;
    }

    if (!groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId('');
    }
  }, [groups, groupsQuery.isLoading, selectedGroupId]);

  useEffect(() => {
    function onOpen(event: Event) {
      const metric = (event as CustomEvent<{ metric?: KpiDrilldownMetric }>).detail?.metric;
      if (
        metric !== 'finance'
        && metric !== 'orders'
        && metric !== 'buyouts'
        && metric !== 'ads'
        && metric !== 'storage'
        && metric !== 'stocks'
        && metric !== 'spp'
        && metric !== 'conversion'
      ) {
        return;
      }

      setDrilldownMetric(metric);
      setDrilldown(null);
      setDrilldownError(null);
      setDrilldownLoading(true);
    }

    window.addEventListener(OPEN_KPI_DRILLDOWN_EVENT, onOpen);
    return () => {
      window.removeEventListener(OPEN_KPI_DRILLDOWN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!drilldownMetric) {
      return;
    }

    let cancelled = false;
    fetch(`/api/views/kpi-drilldown?metric=${drilldownMetric}&from=${dateFromParam}&to=${dateToParam}${scopeQuery}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Не удалось загрузить детализацию');
        }
        return (await response.json()) as KpiDrilldownResponse;
      })
      .then((payload) => {
        if (!cancelled) {
          setDrilldown(payload);
          setDrilldownLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDrilldownError(error instanceof Error ? error.message : 'Не удалось загрузить детализацию');
          setDrilldownLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [drilldownMetric, dateFromParam, dateToParam, scopeQuery]);

  const { data, isLoading, error, refetch, isFetching } = useQuery<DashboardResponse | null, Error>({
    queryKey: dashboardQueryKey,
    enabled: Boolean(tenantId),
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(new DOMException('timeout', 'TimeoutError')),
        DASHBOARD_CLIENT_TIMEOUT_MS,
      );
      const onParentAbort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', onParentAbort, { once: true });

      try {
        const res = await fetch(
          `/api/views/dashboard?from=${dateFromParam}&to=${dateToParam}${scopeQuery}`,
          { signal: controller.signal, cache: 'no-store' },
        );

        if (!res.ok) {
          throw new Error('Ошибка при загрузке данных');
        }

        return (await res.json()) as DashboardResponse;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'TimeoutError') {
          throw new Error('Сервер дашборда отвечает дольше 30 секунд. Повторите попытку или сузьте диапазон дат.');
        }
        throw err;
      } finally {
        window.clearTimeout(timeoutId);
        signal.removeEventListener('abort', onParentAbort);
      }
    },
    staleTime: 30_000,
    refetchInterval: dashboardFallbackRefreshMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  const latestSyncQuery = useQuery<DashboardSyncRun[]>({
    queryKey: ['dashboard-latest-sync-run', tenantId],
    queryFn: () => (tenantId ? getSyncRunsHistory(tenantId, 1) as Promise<DashboardSyncRun[]> : Promise.resolve([])),
    enabled: Boolean(tenantId) && showDeferredSections,
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return latest?.status === 'pending' || latest?.status === 'running'
        ? SYNC_STATUS_RUNNING_POLL_MS + syncStatusPollJitterMs
        : SYNC_STATUS_IDLE_POLL_MS + syncStatusPollJitterMs;
    },
  });

  useEffect(() => {
    const latest = latestSyncQuery.data?.[0];
    const isTerminalSyncRun = Boolean(
      latest?.finishedAt && latest.status !== 'pending' && latest.status !== 'running',
    );
    const finishedAt = isTerminalSyncRun
      ? latest!.finishedAt instanceof Date
        ? latest!.finishedAt.toISOString()
        : latest!.finishedAt
      : null;
    const syncRunKey = isTerminalSyncRun && finishedAt
      ? `${latest!.id}:${latest!.status}:${finishedAt}`
      : null;

    if (!latestSyncInitializedRef.current) {
      if (!latestSyncQuery.isFetched) {
        return;
      }

      latestSyncInitializedRef.current = true;
      handledSyncRunKeyRef.current = syncRunKey;
      return;
    }

    if (!syncRunKey || handledSyncRunKeyRef.current === syncRunKey) {
      return;
    }

    handledSyncRunKeyRef.current = syncRunKey;
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKey });
  }, [dashboardQueryKey, latestSyncQuery.data, latestSyncQuery.isFetched, queryClient]);

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="dashboard-card flex min-h-[54vh] flex-col items-center justify-center gap-4 text-cyan-500">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="text-sm font-semibold text-muted-foreground">Собираем операционные метрики...</p>
      </div>
    );
  } else if (error) {
    content = (
      <OperatorState
        icon={DatabaseZap}
        tone="danger"
        title="Не удалось собрать дашборд"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  } else if (!data) {
    content = (
      <OperatorState
        icon={DatabaseZap}
        tone="warning"
        title="Нет данных для дашборда"
        description="Скорее всего, синхронизация ещё не запускалась или выбранный диапазон пустой."
        actionLabel="Перейти в настройки"
        actionHref="/settings"
      />
    );
  } else {
    const financeWarning = data.kpi.toplineSource === 'finance_only' ? (
      <div className="rounded-2xl border border-amber-300/60 bg-amber-100/70 px-4 py-3 text-sm text-amber-950 shadow-[var(--shadow-xs)] dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Для выбранного диапазона нет точного snapshot воронки WB. Финансовые KPI показаны корректно,
            а конверсия останется `н/д`, пока не появится точная funnel-выгрузка.
          </p>
        </div>
      </div>
    ) : null;

    const kpiCards = (
      <KPICards
        kpi={data.kpi}
        profitAtRisk={0}
        selectedMetric={selectedMetric}
        onSelectMetric={setSelectedMetric}
        layout={
          dashboardVariant === 'cockpit'
            ? 'compact'
            : dashboardVariant === 'matrix'
              ? 'matrix'
              : dashboardVariant === 'chart-top' || dashboardVariant === 'kpi-grid'
                ? 'dense'
                : 'priority'
        }
      />
    );
    const kpiSummary = buildOverviewKpiViewModel(data.kpi);

    content = (
      <div className="space-y-5">
        {financeWarning}

        {dashboardVariant === 'kpi-first' ? (
          <ExecutiveCockpitVariant
            chart={data.chart ?? []}
            chartComparison={data.chartComparison}
            kpi={kpiSummary}
            selectedMetric={selectedMetric}
            onSelectMetric={setSelectedMetric}
          />
        ) : dashboardVariant === 'cockpit' ? (
          <MoneyFirstVariant
            chart={data.chart ?? []}
            chartComparison={data.chartComparison}
            kpi={kpiSummary}
            selectedMetric={selectedMetric}
          />
        ) : dashboardVariant === 'matrix' ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_500px] 2xl:grid-cols-[minmax(0,1fr)_560px]">
            <div>{kpiCards}</div>
            <PnLChart
              data={data.chart ?? []}
              comparisonData={data.chartComparison?.rows ?? []}
              comparisonPeriod={data.chartComparison?.period ?? null}
              metric={selectedMetric}
              density="compact"
              className="xl:sticky xl:top-28 xl:self-start"
            />
          </div>
        ) : dashboardVariant === 'kpi-grid' ? (
          <AnalystDenseVariant
            chart={data.chart ?? []}
            chartComparison={data.chartComparison}
            kpi={kpiSummary}
            selectedMetric={selectedMetric}
            onSelectMetric={setSelectedMetric}
          />
        ) : (
          <FlowChainVariant
            chart={data.chart ?? []}
            chartComparison={data.chartComparison}
            kpi={kpiSummary}
            selectedMetric={selectedMetric}
            onSelectMetric={setSelectedMetric}
          />
        )}

        <WarehouseRevenueSection data={data.warehouseRevenue} />

        {showDeferredSections ? (
          <DeferredExpensesSection
            kpi={data.kpi}
            chart={data.chart ?? []}
            dateFrom={dateFromParam}
            dateTo={dateToParam}
            groupId={activeGroupId}
          />
        ) : (
          <DeferredOverviewSectionSkeleton label="Расходы" />
        )}

        {data.salesPlan ? <SalesPlanSummaryCard plan={data.salesPlan} /> : null}

        {showDeferredSections ? (
          <DeferredProductSalesHighlights
            topSelling={data.products?.topSelling ?? []}
            leastSelling={data.products?.leastSelling ?? []}
          />
        ) : (
          <DeferredOverviewSectionSkeleton label="Товары" compact />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <VariantButton
              active={dashboardVariant === 'kpi-first'}
              icon={Gauge}
              label="Вариант 1"
              description="Cockpit"
              onClick={() => setDashboardVariant('kpi-first')}
            />
            <VariantButton
              active={dashboardVariant === 'cockpit'}
              icon={ReceiptText}
              label="Вариант 2"
              description="P&L"
              onClick={() => setDashboardVariant('cockpit')}
            />
            <VariantButton
              active={dashboardVariant === 'matrix'}
              icon={Columns3}
              label="Вариант 3"
              description="Сетка"
              onClick={() => setDashboardVariant('matrix')}
            />
            <VariantButton
              active={dashboardVariant === 'chart-top'}
              icon={LineChart}
              label="Вариант 4"
              description="Цепочка"
              onClick={() => setDashboardVariant('chart-top')}
            />
            <VariantButton
              active={dashboardVariant === 'kpi-grid'}
              icon={LayoutGrid}
              label="Вариант 5"
              description="Analyst"
              onClick={() => setDashboardVariant('kpi-grid')}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={profitReportHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent sm:w-auto"
            >
              <FileText className="h-4 w-4" />
              Отчёт CSV
            </a>
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Обновить дашборд
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusChip label="Финансы" value="данные WB" />
          <StatusChip label="За выбранный период" value={`${dateFromParam} — ${dateToParam}`} icon />
          <StatusChip label="Остатки" value="последний snapshot" />
          <StatusChip label="Сегодня" value="данные обновляются" />
        </div>

        <ProductGroupContextBar
          tenantId={tenantId}
          groups={groups}
          groupsLoading={groupsQuery.isLoading || groupsQuery.isFetching}
          groupsError={groupsQuery.error ?? null}
          activeGroupId={activeGroupId}
          onActiveGroupChange={setSelectedGroupId}
          dateFrom={dateFromParam}
          dateTo={dateToParam}
        />
      </section>

      {content}
      {drilldownMetric ? (
        <KpiDrilldownModal
          metric={drilldownMetric}
          data={drilldown}
          loading={drilldownLoading}
          error={drilldownError}
          onClose={() => setDrilldownMetric(null)}
        />
      ) : null}
    </div>
  );
}

type OverviewKpiViewModel = {
  revenue: number;
  revenueDelta: number;
  profit: number;
  profitDelta: number;
  totalExpenses: number;
  totalExpensesDelta: number;
  roi: number;
  orders: number;
  ordersDelta: number;
  orderSum: number;
  ordersAvailable: boolean;
  orderSumAvailable: boolean;
  avgCheck: number;
  avgCheckAvailable: boolean;
  buyouts: number;
  buyoutsDelta: number;
  buyoutSum: number;
  buyoutSumAvailable: boolean;
  buyoutRate: number;
  buyoutRateDelta: number;
  buyoutRateAvailable: boolean;
  profitPerBuyout: number;
  profitPerBuyoutAvailable: boolean;
  grossMargin: number;
  grossMarginDelta: number;
  margin: number;
  marginDelta: number;
  ads: number;
  adsShare: number;
  adsShareDelta: number;
  adsCpo: number;
  adsCpoAvailable: boolean;
  logistics: number;
  storage: number;
  storageShare: number;
  storageShareDelta: number;
  stocks: number;
  stocksAvailable: boolean;
  stockDays: number;
  stockTurnoverDays: number;
  stockAnalyticsAvailable: boolean;
  lostOrders: number;
  lostOrdersSum: number;
  conversion: number;
  conversionDelta: number;
  conversionAvailable: boolean;
  localization: number;
  localizationAvailable: boolean;
  spp: number;
  sppDelta: number;
  sppAvailable: boolean;
  toplineSource: string;
};

function useDeferredOverviewSections() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: Window['requestIdleCallback'];
      cancelIdleCallback?: Window['cancelIdleCallback'];
    };

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idleId = idleWindow.requestIdleCallback(() => setReady(true), {
        timeout: DEFERRED_OVERVIEW_SECTIONS_TIMEOUT_MS,
      });

      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = globalThis.setTimeout(() => setReady(true), DEFERRED_OVERVIEW_SECTIONS_TIMEOUT_MS);
    return () => globalThis.clearTimeout(timeoutId);
  }, [ready]);

  return ready;
}

function DeferredOverviewSectionSkeleton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`dashboard-card animate-pulse p-5 ${compact ? 'min-h-[180px]' : 'min-h-[300px]'}`}>
      <div className="h-3 w-28 rounded-full bg-muted" />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="h-20 rounded-xl bg-muted/70" />
        <div className="h-20 rounded-xl bg-muted/70" />
        <div className="h-20 rounded-xl bg-muted/70" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function WarehouseRevenueSection({ data }: { data?: DashboardResponse['warehouseRevenue'] }) {
  const rows = data?.rows ?? [];
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 1);

  if (!rows.length) {
    return null;
  }

  return (
    <section className="dashboard-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <Warehouse className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-black tracking-tight text-foreground">Выручка по складам</h2>
              <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-700 dark:text-emerald-200">
                {data?.warehouseCount ?? rows.length}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              WB может относить продажу к офису обработки, поэтому лидер здесь не всегда совпадает с главным складом.
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Всего</p>
          <p className="mt-1 text-lg font-black text-foreground">{formatRub(data?.totalRevenue ?? 0)}</p>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {rows.map((row) => (
          <div key={row.warehouseName} className="grid gap-2 md:grid-cols-[260px_minmax(0,1fr)_150px] md:items-center">
            <div className="min-w-0 text-sm font-bold text-muted-foreground md:text-right">
              <span className="block truncate">{row.warehouseName}</span>
            </div>
            <div className="h-7 overflow-hidden rounded-r-xl rounded-l-md bg-subtle">
              <div
                className="flex h-full min-w-[3px] items-center justify-end rounded-r-xl rounded-l-md bg-gradient-to-r from-emerald-500 via-cyan-500 to-violet-500 px-2 shadow-[0_6px_18px_rgba(6,182,212,0.20)]"
                style={{ width: `${Math.max(1, (row.revenue / maxRevenue) * 100)}%` }}
              >
                <span className="hidden text-[10px] font-black text-white/90 md:inline">{formatPercent(row.sharePct, 1)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm md:block md:text-right">
              <span className="font-mono font-black text-foreground">{formatRub(row.revenue)}</span>
              <span className="text-xs font-semibold text-muted-foreground md:mt-0.5 md:block">{formatUnits(row.salesCount)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildOverviewKpiViewModel(kpi: DashboardResponse['kpi']): OverviewKpiViewModel {
  const revenue = getKpiMetric(kpi, 'revenue');
  const profit = getKpiMetric(kpi, 'profit');
  const orders = getKpiMetric(kpi, 'orders');
  const orderSum = getKpiMetric(kpi, 'orderSum');
  const avgCheck = getKpiMetric(kpi, 'avgCheck');
  const buyouts = getKpiMetric(kpi, 'buyouts');
  const buyoutSum = getKpiMetric(kpi, 'buyoutSum');
  const buyoutRate = getKpiMetric(kpi, 'buyoutRate');
  const profitPerBuyout = getKpiMetric(kpi, 'profitPerBuyout');
  const grossMargin = getKpiMetric(kpi, 'grossMargin');
  const margin = getKpiMetric(kpi, 'margin');
  const ads = getKpiMetric(kpi, 'ads');
  const adsShare = getKpiMetric(kpi, 'acos');
  const adsCpo = getKpiMetric(kpi, 'adsCpo');
  const logistics = getKpiMetric(kpi, 'logistics');
  const storage = getKpiMetric(kpi, 'storage');
  const storageShare = getKpiMetric(kpi, 'storageShare');
  const stocks = getKpiMetric(kpi, 'stocks');
  const stockDays = getKpiMetric(kpi, 'stockDays');
  const stockTurnoverDays = getKpiMetric(kpi, 'stockTurnoverDays');
  const lostOrders = getKpiMetric(kpi, 'lostOrders');
  const lostOrdersSum = getKpiMetric(kpi, 'lostOrdersSum');
  const conversion = getKpiMetric(kpi, 'conversion');
  const localization = getKpiMetric(kpi, 'localization');
  const spp = getKpiMetric(kpi, 'spp');
  const realizedRevenue = getKpiMetric(kpi, 'realizedRevenue');
  const cogs = getKpiMetric(kpi, 'cogs');
  const previousRealizedRevenue = previousFromDeltaValue(realizedRevenue.value, realizedRevenue.delta);
  const previousProfit = previousFromDeltaValue(profit.value, profit.delta);
  // Расходы = реализация после СПП − прибыль (СПП финансирует WB, в расходы продавца не входит).
  const totalExpenses = Math.max(realizedRevenue.value - profit.value, ads.value + storage.value + logistics.value, 0);
  const previousExpenses = Math.max(previousRealizedRevenue - previousProfit, 0);

  return {
    revenue: revenue.value,
    revenueDelta: revenue.delta,
    profit: profit.value,
    profitDelta: profit.delta,
    totalExpenses,
    totalExpensesDelta: calcDeltaValue(totalExpenses, previousExpenses),
    roi: cogs.value > 0 ? (profit.value / cogs.value) * 100 : 0,
    orders: orders.value,
    ordersDelta: orders.delta,
    orderSum: orderSum.value,
    ordersAvailable: getKpiBoolean(kpi, 'ordersAvailable', true),
    orderSumAvailable: getKpiBoolean(kpi, 'orderSumAvailable', false),
    avgCheck: avgCheck.value,
    avgCheckAvailable: getKpiBoolean(kpi, 'avgCheckAvailable', false),
    buyouts: buyouts.value,
    buyoutsDelta: buyouts.delta,
    buyoutSum: buyoutSum.value,
    buyoutSumAvailable: getKpiBoolean(kpi, 'buyoutSumAvailable', false),
    buyoutRate: buyoutRate.value,
    buyoutRateDelta: buyoutRate.delta,
    buyoutRateAvailable: getKpiBoolean(kpi, 'buyoutRateAvailable', false),
    profitPerBuyout: profitPerBuyout.value,
    profitPerBuyoutAvailable: getKpiBoolean(kpi, 'profitPerBuyoutAvailable', false),
    grossMargin: grossMargin.value,
    grossMarginDelta: grossMargin.delta,
    margin: margin.value,
    marginDelta: margin.delta,
    ads: ads.value,
    adsShare: adsShare.value,
    adsShareDelta: adsShare.delta,
    adsCpo: adsCpo.value,
    adsCpoAvailable: getKpiBoolean(kpi, 'adsCpoAvailable', false),
    logistics: logistics.value,
    storage: storage.value,
    storageShare: storageShare.value,
    storageShareDelta: storageShare.delta,
    stocks: stocks.value,
    stocksAvailable: getKpiBoolean(kpi, 'stocksAvailable', false),
    stockDays: stockDays.value,
    stockTurnoverDays: stockTurnoverDays.value,
    stockAnalyticsAvailable: getKpiBoolean(kpi, 'stockAnalyticsAvailable', false),
    lostOrders: lostOrders.value,
    lostOrdersSum: lostOrdersSum.value,
    conversion: conversion.value,
    conversionDelta: conversion.delta,
    conversionAvailable: getKpiBoolean(kpi, 'conversionAvailable', true),
    localization: localization.value,
    localizationAvailable: getKpiBoolean(kpi, 'localizationAvailable', false),
    spp: spp.value,
    sppDelta: spp.delta,
    sppAvailable: getKpiBoolean(kpi, 'sppAvailable', false),
    toplineSource: String(kpi.toplineSource ?? 'exact_funnel'),
  };
}

function getKpiMetric(kpi: DashboardResponse['kpi'], key: string) {
  const metric = kpi[key];
  if (!metric || typeof metric !== 'object') {
    return { value: 0, delta: 0 };
  }

  const record = metric as { value?: unknown; delta?: unknown };
  return {
    value: toNumber(record.value),
    delta: toNumber(record.delta),
  };
}

function getKpiBoolean(kpi: DashboardResponse['kpi'], key: string, fallback: boolean) {
  const value = kpi[key];
  return typeof value === 'boolean' ? value : fallback;
}

function calcDeltaValue(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function previousFromDeltaValue(current: number, delta: number) {
  if (!Number.isFinite(current) || !Number.isFinite(delta)) return 0;
  const ratio = 1 + delta / 100;
  return Math.abs(ratio) < 0.0001 ? 0 : current / ratio;
}

function ExecutiveCockpitVariant({
  chart,
  chartComparison,
  kpi,
  selectedMetric,
  onSelectMetric,
}: {
  chart: DashboardResponse['chart'];
  chartComparison?: DashboardResponse['chartComparison'];
  kpi: OverviewKpiViewModel;
  selectedMetric: DashboardMetricKey;
  onSelectMetric: (metric: DashboardMetricKey) => void;
}) {
  const profitTone = kpi.profit >= 0 ? 'emerald' : 'rose';

  return (
    <section className="space-y-5">
      <div className="dashboard-panel overflow-hidden p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-300">
              Вариант 1 · Cockpit
            </p>
            <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-2xl font-black tracking-tight text-foreground">
                  Сводка для быстрого решения
                </h3>
                <p className="mt-1 max-w-2xl text-sm font-semibold text-muted-foreground">
                  Цвет показывает роль метрики: спрос, деньги, утечки и операционные риски.
                </p>
              </div>
              <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${profitTone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200'}`}>
                {profitTone === 'emerald' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {profitTone === 'emerald' ? 'экономика в плюсе' : 'экономика требует разбора'}
              </span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              <ExecutiveScoreCard
                active={selectedMetric === 'revenue'}
                icon={WalletCards}
                label="Выручка"
                value={formatRub(kpi.revenue)}
                caption={formatSignedPercent(kpi.revenueDelta)}
                tone="emerald"
                onClick={() => onSelectMetric('revenue')}
              />
              <ExecutiveScoreCard
                active={selectedMetric === 'profit'}
                icon={ReceiptText}
                label="Чистая прибыль"
                value={formatRub(kpi.profit)}
                caption={formatSignedPercent(kpi.profitDelta)}
                tone={kpi.profit >= 0 ? 'blue' : 'rose'}
                onClick={() => onSelectMetric('profit')}
              />
              <ExecutiveScoreCard
                active={selectedMetric === 'margin'}
                icon={Gauge}
                label="Рентабельность"
                value={formatPercent(kpi.margin)}
                caption={formatSignedPoint(kpi.marginDelta)}
                tone={kpi.margin >= 0 ? 'blue' : 'rose'}
                onClick={() => onSelectMetric('margin')}
              />
              <ExecutiveScoreCard
                active={selectedMetric === 'ads'}
                icon={Megaphone}
                label="Реклама"
                value={formatRub(kpi.ads)}
                caption={`ДРР ${formatPercent(kpi.adsShare)}`}
                tone="violet"
                onClick={() => onSelectMetric('ads')}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-[var(--shadow-xs)]">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground">
              Фокус дня
            </p>
            <div className="mt-3 space-y-3">
              <FocusLine label="Деньги" value={`${formatRub(kpi.revenue)} → ${formatRub(kpi.profit)}`} />
              <FocusLine label="Утечки" value={`${formatRub(kpi.totalExpenses)} расходов`} />
              <FocusLine label="Операции" value={`${formatPlainNumber(kpi.stocks)} на складе · ${formatPercent(kpi.buyoutRate)} выкуп`} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_500px]">
        <div className="grid gap-4 md:grid-cols-3">
          <CompactSignalCard title="Спрос" value={formatUnits(kpi.orders)} caption={kpi.orderSumAvailable ? formatRub(kpi.orderSum) : 'сумма н/д'} tone="violet" />
          <CompactSignalCard title="Монетизация" value={formatPercent(kpi.grossMargin)} caption="маржа до налога" tone="amber" />
          <CompactSignalCard title="Запас" value={kpi.stockAnalyticsAvailable ? `${kpi.stockDays.toFixed(1)} дн.` : 'н/д'} caption="остатки / оборот" tone="sky" />
        </div>
        <PnLChart
          data={chart}
          comparisonData={chartComparison?.rows ?? []}
          comparisonPeriod={chartComparison?.period ?? null}
          metric={selectedMetric}
          density="compact"
          className="xl:row-span-2 xl:self-start"
        />
      </div>
    </section>
  );
}

function MoneyFirstVariant({
  chart,
  chartComparison,
  kpi,
  selectedMetric,
}: {
  chart: DashboardResponse['chart'];
  chartComparison?: DashboardResponse['chartComparison'];
  kpi: OverviewKpiViewModel;
  selectedMetric: DashboardMetricKey;
}) {
  const expenseBase = Math.max(kpi.totalExpenses, 1);

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="dashboard-card overflow-hidden p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-600 dark:text-emerald-300">
          Вариант 2 · P&L
        </p>
        <h3 className="mt-1 text-2xl font-black tracking-tight text-foreground">
          Куда ушли деньги
        </h3>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">
          Этот вид раскрашивает экономику: зелёный — деньги пришли, красный — итог, жёлтый — места утечек.
        </p>

        <div className="mt-5 space-y-3">
          <MoneyFlowRow label="Выручка" value={formatRub(kpi.revenue)} tone="positive" widthPct={100} />
          <MoneyFlowRow label="Расходы и удержания" value={`−${formatRub(kpi.totalExpenses)}`} tone="negative" widthPct={Math.min(100, (kpi.totalExpenses / Math.max(kpi.revenue, 1)) * 100)} />
          <MoneyFlowRow label="Чистая прибыль" value={formatRub(kpi.profit)} tone={kpi.profit >= 0 ? 'positive' : 'negative'} widthPct={Math.min(100, (Math.abs(kpi.profit) / Math.max(kpi.revenue, 1)) * 100)} />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <LeakCard label="Реклама" value={formatRub(kpi.ads)} caption={`${formatPercent(kpi.adsShare)} от базы`} share={(kpi.ads / expenseBase) * 100} tone="violet" />
          <LeakCard label="Хранение" value={formatRub(kpi.storage)} caption={`${formatPercent(kpi.storageShare)} от выручки`} share={(kpi.storage / expenseBase) * 100} tone="amber" />
          <LeakCard label="ROI" value={formatPercent(kpi.roi)} caption="прибыль / себестоимость" share={Math.min(100, Math.abs(kpi.roi))} tone={kpi.roi >= 0 ? 'emerald' : 'rose'} />
        </div>
      </div>

      <div className="space-y-5">
        <PnLChart
          data={chart}
          comparisonData={chartComparison?.rows ?? []}
          comparisonPeriod={chartComparison?.period ?? null}
          metric={selectedMetric}
          density="compact"
          className="xl:sticky xl:top-28 xl:self-start"
        />
        <div className="dashboard-card p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground">Проверить первым</p>
          <div className="mt-3 space-y-3">
            <FocusLine label="Хранение" value={`${formatRub(kpi.storage)} · ${formatPercent(kpi.storageShare)}`} />
            <FocusLine label="Реклама" value={`${formatRub(kpi.ads)} · ДРР ${formatPercent(kpi.adsShare)}`} />
            <FocusLine label="Выкуп" value={kpi.buyoutRateAvailable ? formatPercent(kpi.buyoutRate) : 'н/д'} />
          </div>
        </div>
      </div>
    </section>
  );
}

function FlowChainVariant({
  chart,
  chartComparison,
  kpi,
  selectedMetric,
  onSelectMetric,
}: {
  chart: DashboardResponse['chart'];
  chartComparison?: DashboardResponse['chartComparison'];
  kpi: OverviewKpiViewModel;
  selectedMetric: DashboardMetricKey;
  onSelectMetric: (metric: DashboardMetricKey) => void;
}) {
  return (
    <section className="space-y-5">
      <div className="dashboard-card p-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">
              Вариант 4 · Цепочка
            </p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-foreground">
              Заказы → выкупы → деньги → прибыль
            </h3>
          </div>
          <p className="max-w-xl text-sm font-semibold text-muted-foreground">
            Каждый этап имеет свой цвет: фиолетовый спрос, голубой выкуп, зелёная выручка, красная/синяя прибыль.
          </p>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1.1fr)]">
          <FlowStep active={selectedMetric === 'orders'} icon={ClipboardList} label="Заказы" value={kpi.ordersAvailable ? formatUnits(kpi.orders) : 'н/д'} caption={kpi.orderSumAvailable ? formatRub(kpi.orderSum) : 'сумма н/д'} tone="violet" onClick={() => onSelectMetric('orders')} />
          <FlowArrow />
          <FlowStep active={selectedMetric === 'buyouts'} icon={ShoppingBag} label="Выкупы" value={formatUnits(kpi.buyouts)} caption={kpi.buyoutRateAvailable ? `выкуп ${formatPercent(kpi.buyoutRate)}` : 'выкуп н/д'} tone="cyan" onClick={() => onSelectMetric('buyouts')} />
          <FlowArrow />
          <FlowStep active={selectedMetric === 'revenue'} icon={WalletCards} label="Выручка" value={formatRub(kpi.revenue)} caption="финансы WB" tone="emerald" onClick={() => onSelectMetric('revenue')} />
          <FlowArrow />
          <FlowStep active={selectedMetric === 'profit'} icon={ReceiptText} label="Чистая прибыль" value={formatRub(kpi.profit)} caption={`ROI ${formatPercent(kpi.roi)}`} tone={kpi.profit >= 0 ? 'blue' : 'rose'} onClick={() => onSelectMetric('profit')} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="grid gap-4 md:grid-cols-2">
          <FlowGroupCard title="Спрос" icon={BarChart3} tone="violet" items={[['Средний чек', kpi.avgCheckAvailable ? formatRub(kpi.avgCheck) : 'н/д'], ['SPP', kpi.sppAvailable ? formatPercent(kpi.spp) : 'н/д']]} />
          <FlowGroupCard title="Расходы" icon={ReceiptText} tone="amber" items={[['Реклама', formatRub(kpi.ads)], ['Хранение', formatRub(kpi.storage)]]} />
          <FlowGroupCard title="Остатки" icon={PackageSearch} tone="sky" items={[['На складе', kpi.stocksAvailable ? formatPlainNumber(kpi.stocks) : 'н/д'], ['Потери', kpi.stockAnalyticsAvailable ? `${formatUnits(kpi.lostOrders)} / ${formatRub(kpi.lostOrdersSum)}` : 'н/д']]} />
          <FlowGroupCard title="Диагностика" icon={Gauge} tone="rose" items={[['Конверсия', kpi.conversionAvailable ? formatPercent(kpi.conversion) : 'н/д'], ['Локализация', kpi.localizationAvailable ? formatPercent(kpi.localization) : 'н/д']]} />
        </div>
        <PnLChart
          data={chart}
          comparisonData={chartComparison?.rows ?? []}
          comparisonPeriod={chartComparison?.period ?? null}
          metric={selectedMetric}
          density="compact"
          className="xl:sticky xl:top-28 xl:self-start"
        />
      </div>
    </section>
  );
}

function AnalystDenseVariant({
  chart,
  chartComparison,
  kpi,
  selectedMetric,
  onSelectMetric,
}: {
  chart: DashboardResponse['chart'];
  chartComparison?: DashboardResponse['chartComparison'];
  kpi: OverviewKpiViewModel;
  selectedMetric: DashboardMetricKey;
  onSelectMetric: (metric: DashboardMetricKey) => void;
}) {
  const rows: Array<{
    metric: DashboardMetricKey;
    group: string;
    label: string;
    value: string;
    delta: string;
    status: string;
    tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue' | 'slate';
  }> = [
    { metric: 'revenue', group: 'Деньги', label: 'Выручка', value: formatRub(kpi.revenue), delta: formatSignedPercent(kpi.revenueDelta), status: kpi.toplineSource === 'finance_only' ? 'finance only' : 'точно WB', tone: 'emerald' },
    { metric: 'profit', group: 'Деньги', label: 'Чистая прибыль', value: formatRub(kpi.profit), delta: formatSignedPercent(kpi.profitDelta), status: kpi.profit >= 0 ? 'ок' : 'минус', tone: kpi.profit >= 0 ? 'blue' : 'rose' },
    { metric: 'orders', group: 'Воронка', label: 'Заказы', value: kpi.ordersAvailable ? formatUnits(kpi.orders) : 'н/д', delta: formatSignedPercent(kpi.ordersDelta), status: kpi.ordersAvailable ? 'есть данные' : 'нет данных', tone: 'violet' },
    { metric: 'buyouts', group: 'Воронка', label: 'Выкупы', value: formatUnits(kpi.buyouts), delta: kpi.buyoutRateAvailable ? formatSignedPoint(kpi.buyoutRateDelta) : 'н/д', status: kpi.buyoutRateAvailable ? `выкуп ${formatPercent(kpi.buyoutRate)}` : 'нет %', tone: 'sky' },
    { metric: 'ads', group: 'Расходы', label: 'Реклама', value: formatRub(kpi.ads), delta: formatSignedPoint(kpi.adsShareDelta), status: `ДРР ${formatPercent(kpi.adsShare)}`, tone: 'violet' },
    { metric: 'storage', group: 'Расходы', label: 'Хранение', value: formatRub(kpi.storage), delta: formatSignedPoint(kpi.storageShareDelta), status: `${formatPercent(kpi.storageShare)} от выручки`, tone: 'amber' },
    { metric: 'stocks', group: 'Операции', label: 'Остатки WB', value: kpi.stocksAvailable ? formatPlainNumber(kpi.stocks) : 'н/д', delta: 'snapshot', status: kpi.stockAnalyticsAvailable ? `${kpi.stockDays.toFixed(1)} дн.` : 'без оборота', tone: 'sky' },
    { metric: 'conversion', group: 'Операции', label: 'Конверсия', value: kpi.conversionAvailable ? formatPercent(kpi.conversion) : 'н/д', delta: kpi.conversionAvailable ? formatSignedPoint(kpi.conversionDelta) : 'н/д', status: kpi.localizationAvailable ? `лок. ${formatPercent(kpi.localization)}` : 'лок. н/д', tone: 'rose' },
  ];

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="dashboard-card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-300">
            Вариант 5 · Analyst
          </p>
          <h3 className="mt-1 text-2xl font-black tracking-tight text-foreground">
            Плотная таблица метрик
          </h3>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            Для тех, кто сравнивает значения, источник и статус без больших карточек.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-subtle/70 text-left text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Группа</th>
                <th className="px-5 py-3">Метрика</th>
                <th className="px-5 py-3 text-right">Значение</th>
                <th className="px-5 py-3 text-right">Динамика</th>
                <th className="px-5 py-3">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.metric} className={`border-t border-border/70 transition-colors hover:bg-accent/60 ${selectedMetric === row.metric ? 'bg-cyan-500/8' : ''}`}>
                  <td className="px-5 py-3 font-bold text-muted-foreground">{row.group}</td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => onSelectMetric(row.metric)}
                      className="inline-flex items-center gap-2 font-black text-foreground hover:text-cyan-600 dark:hover:text-cyan-300"
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${metricToneDotClass(row.tone)}`} />
                      {row.label}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right text-base font-black text-foreground">{row.value}</td>
                  <td className="px-5 py-3 text-right font-black text-muted-foreground">{row.delta}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${metricToneSoftClass(row.tone)}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-5">
        <PnLChart
          data={chart}
          comparisonData={chartComparison?.rows ?? []}
          comparisonPeriod={chartComparison?.period ?? null}
          metric={selectedMetric}
          density="compact"
          className="xl:sticky xl:top-28 xl:self-start"
        />
        <div className="dashboard-card p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground">Итог</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <FocusLine label="P&L" value={`${formatRub(kpi.revenue)} → ${formatRub(kpi.profit)}`} />
            <FocusLine label="ROI" value={formatPercent(kpi.roi)} />
            <FocusLine label="Расходы" value={formatRub(kpi.totalExpenses)} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ExecutiveScoreCard({
  active,
  icon: Icon,
  label,
  value,
  caption,
  tone,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  value: string;
  caption: string;
  tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[134px] rounded-2xl border p-4 text-left shadow-[var(--shadow-xs)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] ${metricToneSoftClass(tone)} ${active ? 'ring-2 ring-cyan-400/40' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card/70">
          <Icon className="h-5 w-5" />
        </span>
        <span className="rounded-full bg-card/70 px-2 py-1 text-[11px] font-black">{caption}</span>
      </div>
      <p className="mt-4 text-sm font-black text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-2xl font-black tracking-tight text-foreground">{value}</p>
    </button>
  );
}

function CompactSignalCard({
  title,
  value,
  caption,
  tone,
}: {
  title: string;
  value: string;
  caption: string;
  tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue';
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-[var(--shadow-xs)] ${metricToneSoftClass(tone)}`}>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      <p className="mt-2 text-2xl font-black text-foreground">{value}</p>
      <p className="mt-1 text-xs font-bold text-muted-foreground">{caption}</p>
    </div>
  );
}

function MoneyFlowRow({
  label,
  value,
  tone,
  widthPct,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'negative';
  widthPct: number;
}) {
  const width = Math.max(8, Math.min(100, widthPct));
  const color = tone === 'positive' ? 'bg-emerald-500' : 'bg-rose-500';

  return (
    <div className="rounded-2xl border border-border bg-subtle/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-black text-foreground">{label}</span>
        <span className={`text-lg font-black ${tone === 'positive' ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-700 dark:text-rose-200'}`}>
          {value}
        </span>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-background">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function LeakCard({
  label,
  value,
  caption,
  share,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  share: number;
  tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue';
}) {
  const width = Math.max(8, Math.min(100, share));

  return (
    <div className={`rounded-2xl border p-4 ${metricToneSoftClass(tone)}`}>
      <p className="text-xs font-black text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-black text-foreground">{value}</p>
      <p className="mt-1 text-xs font-bold text-muted-foreground">{caption}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-card/80">
        <div className={`h-full rounded-full ${metricToneDotClass(tone)}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function FlowStep({
  active,
  icon: Icon,
  label,
  value,
  caption,
  tone,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  value: string;
  caption: string;
  tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue' | 'cyan';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[150px] rounded-2xl border p-4 text-left shadow-[var(--shadow-xs)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] ${metricToneSoftClass(tone)} ${active ? 'ring-2 ring-cyan-400/40' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card/70">
          <Icon className="h-5 w-5" />
        </span>
        <span className={`h-2.5 w-2.5 rounded-full ${metricToneDotClass(tone)}`} />
      </div>
      <p className="mt-4 text-sm font-black text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-3xl font-black tracking-tight text-foreground">{value}</p>
      <p className="mt-2 text-xs font-bold text-muted-foreground">{caption}</p>
    </button>
  );
}

function FlowArrow() {
  return (
    <div className="hidden items-center justify-center text-muted-foreground lg:flex">
      <ArrowRight className="h-6 w-6" />
    </div>
  );
}

function FlowGroupCard({
  title,
  icon: Icon,
  tone,
  items,
}: {
  title: string;
  icon: LucideIcon;
  tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue';
  items: Array<[string, string]>;
}) {
  return (
    <div className={`rounded-2xl border p-4 shadow-[var(--shadow-xs)] ${metricToneSoftClass(tone)}`}>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card/70">
          <Icon className="h-4 w-4" />
        </span>
        <h4 className="font-black text-foreground">{title}</h4>
      </div>
      <div className="mt-4 space-y-2">
        {items.map(([label, value]) => (
          <FocusLine key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}

function metricToneDotClass(tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue' | 'cyan' | 'slate') {
  if (tone === 'emerald') return 'bg-emerald-500';
  if (tone === 'rose') return 'bg-rose-500';
  if (tone === 'amber') return 'bg-amber-500';
  if (tone === 'violet') return 'bg-violet-500';
  if (tone === 'sky') return 'bg-sky-500';
  if (tone === 'blue') return 'bg-blue-500';
  if (tone === 'cyan') return 'bg-cyan-500';
  return 'bg-slate-500';
}

function metricToneSoftClass(tone: 'emerald' | 'rose' | 'amber' | 'violet' | 'sky' | 'blue' | 'cyan' | 'slate') {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200';
  if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200';
  if (tone === 'violet') return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-200';
  if (tone === 'sky') return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200';
  if (tone === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-200';
  if (tone === 'cyan') return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-200';
  return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-200';
}

function StatusChip({
  label,
  value,
  icon = false,
}: {
  label: string;
  value: string;
  icon?: boolean;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-subtle/70 px-3 py-2 text-xs font-bold leading-tight text-foreground">
      {icon ? <CalendarDays className="h-3.5 w-3.5 text-cyan-500" /> : null}
      <span className="text-muted-foreground">{label}:</span>
      <span className="min-w-0 break-words">{value}</span>
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

function formatUnits(value: unknown) {
  return `${Math.round(toNumber(value)).toLocaleString('ru-RU')} шт`;
}

function formatPlainNumber(value: unknown) {
  return Math.round(toNumber(value)).toLocaleString('ru-RU');
}

function formatPercent(value: unknown, digits = 1) {
  return `${toNumber(value).toFixed(digits)}%`;
}

function formatSignedPercent(value: unknown, digits = 1) {
  const numeric = toNumber(value);
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(digits)}%`;
}

function formatSignedPoint(value: unknown, digits = 1) {
  const numeric = toNumber(value);
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(digits)} п.п.`;
}

function salesPlanPaceLabel(status: NonNullable<DashboardResponse['salesPlan']>['paceStatus']) {
  if (status === 'ahead') return 'идём быстрее плана';
  if (status === 'behind') return 'отстаём от плана';
  if (status === 'on_track') return 'идём по плану';
  return 'план ещё не стартовал';
}

function salesPlanPaceClass(status: NonNullable<DashboardResponse['salesPlan']>['paceStatus']) {
  if (status === 'ahead') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200';
  if (status === 'behind') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200';
  if (status === 'on_track') return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-200';
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function SalesPlanSummaryCard({ plan }: { plan: NonNullable<DashboardResponse['salesPlan']> }) {
  const progress = Math.max(0, Math.min(100, plan.progressPct));

  return (
    <section className="dashboard-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/12 text-cyan-600 dark:text-cyan-300">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-500 dark:text-cyan-300">
              План продаж
            </p>
            <h3 className="mt-1 text-lg font-black tracking-tight text-foreground">
              {formatUnits(plan.actualOrders)} из {formatUnits(plan.plannedOrders)}
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${salesPlanPaceClass(plan.paceStatus)}`}>
            {salesPlanPaceLabel(plan.paceStatus)}
          </span>
          <Link
            href="/sales-plan"
            className="inline-flex h-8 items-center justify-center rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground transition-colors hover:bg-accent"
          >
            Открыть
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PlanFactMetric label="Выполнение" value={formatPercent(plan.progressPct)} />
        <PlanFactMetric label="Темп периода" value={formatPercent(plan.daysElapsedPct)} />
        <PlanFactMetric label="Прогноз" value={formatUnits(plan.projectedOrders)} />
        <PlanFactMetric label="Осталось" value={formatUnits(plan.remainingOrders)} />
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
        <span className="rounded-xl border border-border bg-subtle px-2.5 py-1">
          План выручки: {formatRub(plan.plannedRevenue)}
        </span>
        <span className="rounded-xl border border-border bg-subtle px-2.5 py-1">
          Факт выручки: {formatRub(plan.actualRevenue)}
        </span>
        <span className="rounded-xl border border-border bg-subtle px-2.5 py-1">
          Активных планов: {formatPlainNumber(plan.planCount)}
        </span>
      </div>
    </section>
  );
}

function PlanFactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-subtle/60 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black text-foreground">{value}</p>
    </div>
  );
}

function metricTitle(metric: KpiDrilldownMetric) {
  if (metric === 'orders') return 'Заказы';
  if (metric === 'buyouts') return 'Выкупы';
  if (metric === 'ads') return 'Реклама';
  if (metric === 'storage') return 'Хранение';
  if (metric === 'stocks') return 'Остатки WB';
  if (metric === 'spp') return 'SPP WB';
  if (metric === 'conversion') return 'Диагностика';
  return 'Финансы';
}

function KpiDrilldownModal({
  metric,
  data,
  loading,
  error,
  onClose,
}: {
  metric: KpiDrilldownMetric;
  data: KpiDrilldownResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const rows = data?.rows ?? [];
  const topRows = rows.slice(0, 40);

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-foreground/35 px-3 py-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_30px_100px_rgba(15,23,42,0.32)] dark:bg-[#0d0f14]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-500 dark:text-cyan-300">
              Провал в показатель
            </p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-foreground">
              {data?.title ?? metricTitle(metric)}
            </h3>
            {data?.period ? (
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {data.period.from} — {data.period.to}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm font-bold text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
              Загружаю детализацию...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-300/60 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
              {error}
            </div>
          ) : data ? (
            <div className="space-y-5">
              <KpiDrilldownTotals metric={metric} totals={data.totals} />
              <KpiDrilldownTable metric={metric} rows={topRows} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KpiDrilldownTotals({
  metric,
  totals,
}: {
  metric: KpiDrilldownMetric;
  totals: Record<string, unknown>;
}) {
  const items = (() => {
    if (metric === 'orders') {
      return [
        ['Заказано', formatUnits(totals.quantity)],
        ['Сумма заказов', formatRub(totals.amount)],
        ['Источник', formatDrilldownSource(totals.source)],
      ];
    }
    if (metric === 'buyouts') {
      return [
        ['Выкуплено', formatUnits(totals.quantity)],
        ['Сумма выкупов', formatRub(totals.amount)],
        ['Процент выкупа', formatPercent(totals.buyoutRate)],
      ];
    }
    if (metric === 'ads') {
      return [
        ['Расход рекламы', formatRub(totals.spend)],
        ['Доля выручки / ДРР', formatPercent(totals.drr)],
        ['Источник', formatDrilldownSource(totals.source)],
      ];
    }
    if (metric === 'storage') {
      return [
        ['Расход хранения', formatRub(totals.storage)],
        ['Доля выручки', formatPercent(totals.share)],
        ['Источник', formatDrilldownSource(totals.source)],
      ];
    }
    if (metric === 'stocks') {
      return [
        ['На складе', formatUnits(totals.stock)],
        ['В пути', formatUnits(totals.inWay)],
        ['Источник', formatDrilldownSource(totals.source)],
      ];
    }
    if (metric === 'spp') {
      return [
        ['Средний SPP', formatPercent(totals.spp)],
        ['Источник', formatDrilldownSource(totals.source)],
        ['Режим', formatDrilldownSource(totals.mode)],
      ];
    }
    if (metric === 'conversion') {
      return [
        ['Конверсия', formatPercent(totals.conversion)],
        ['Заказы', formatUnits(totals.orders)],
        ['Источник', formatDrilldownSource(totals.source)],
      ];
    }
    return [
      ['Выручка', formatRub(totals.revenue)],
      ['Чистая прибыль', formatRub(totals.profit)],
      ['Все затраты', formatRub(totals.expenses)],
      ['Реклама', formatRub(totals.ads)],
      ['Себестоимость', formatRub(totals.cogs)],
      ['Налог', formatRub(totals.tax)],
    ];
  })();

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map(([label, value], index) => (
        <div
          key={label}
          className={`rounded-2xl border p-4 shadow-[var(--shadow-xs)] ${
            index === 0 ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-border bg-card'
          }`}
        >
          <p className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
          <p className="mt-2 text-xl font-black tracking-tight text-foreground">{value}</p>
        </div>
      ))}
    </div>
  );
}

function formatDrilldownSource(value: unknown) {
  const source = typeof value === 'string' ? value : '';
  const labels: Record<string, string> = {
    exact_funnel: 'точная воронка WB',
    raw_orders: 'сырые заказы WB',
    finance: 'финальный отчет WB',
    finance_only: 'финансовый контур WB',
    hybrid_daily_sales: 'финансы + свежие продажи',
    hybrid_funnel: 'финансы + свежая воронка',
    hybrid_funnel_estimated: 'финансы + оценка по воронке',
    paid_storage: 'отчет WB paid_storage',
    hybrid_paid_storage: 'финансы + paid_storage',
    wb_attributed: 'атрибуция WB Ads',
    revenue_proxy: 'расчет от выручки',
    clusters_proxy: 'кластеры рекламы WB',
    ad_costs: 'расходы рекламы WB',
    ad_clusters: 'кластеры рекламы WB',
    prices_snapshot: 'срез цен WB',
    day: 'за день',
    avg: 'среднее за период',
    none: 'нет данных',
  };
  return labels[source] ?? (source ? source.replaceAll('_', ' ') : 'н/д');
}

function ProductSkuCell({ row }: { row: KpiDrilldownRow }) {
  return (
    <div className="flex min-w-[190px] items-center gap-2">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
        {row.photoUrl ? (
          <Image
            src={row.photoUrl}
            alt=""
            width={40}
            height={40}
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
        {row.brand ? (
          <div className="truncate text-[10px] font-semibold text-muted-foreground">{row.brand}</div>
        ) : null}
      </div>
    </div>
  );
}

function KpiDrilldownTable({ metric, rows }: { metric: KpiDrilldownMetric; rows: KpiDrilldownRow[] }) {
  const isOrders = metric === 'orders';
  const isBuyouts = metric === 'buyouts';
  const isFinance = metric === 'finance';

  const tableSpec = (() => {
    if (isOrders) {
      return {
        minWidth: 'min-w-[860px]',
        headers: ['Товар', 'Артикул', 'Заказано', 'Сумма заказов'],
        cells: (row: KpiDrilldownRow) => [
          formatUnits(row.quantity),
          formatRub(row.amount),
        ],
      };
    }
    if (isBuyouts) {
      return {
        minWidth: 'min-w-[940px]',
        headers: ['Товар', 'Артикул', 'Выкуплено', 'Сумма выкупов', 'Расходы', 'Реклама', 'Себестоимость'],
        cells: (row: KpiDrilldownRow) => [
          formatUnits(row.quantity),
          formatRub(row.revenue),
          formatRub(row.expenses),
          formatRub(row.ads),
          formatRub(row.cogs),
        ],
      };
    }
    if (metric === 'ads') {
      return {
        minWidth: 'min-w-[940px]',
        headers: ['Товар', 'Артикул', 'Расход', 'ДРР WB', 'Заказы WB', 'Сумма заказов WB'],
        cells: (row: KpiDrilldownRow) => [
          formatRub(row.amount),
          row.drr == null ? 'н/д' : formatPercent(row.drr),
          formatPlainNumber(row.orderCount),
          formatRub(row.orderSum),
        ],
      };
    }
    if (metric === 'storage') {
      return {
        minWidth: 'min-w-[840px]',
        headers: ['Товар', 'Артикул', 'Расход хранения', 'Строк в фин. срезе'],
        cells: (row: KpiDrilldownRow) => [
          formatRub(row.storage),
          formatPlainNumber(row.sourceRows),
        ],
      };
    }
    if (metric === 'stocks') {
      return {
        minWidth: 'min-w-[940px]',
        headers: ['Товар', 'Артикул', 'На складе', 'К клиенту', 'От клиента', 'Складов'],
        cells: (row: KpiDrilldownRow) => [
          formatUnits(row.stock),
          formatUnits(row.inWayToClient),
          formatUnits(row.inWayFromClient),
          formatPlainNumber(row.warehouseCount),
        ],
      };
    }
    if (metric === 'spp') {
      return {
        minWidth: 'min-w-[900px]',
        headers: ['Товар', 'Артикул', 'SPP', 'Скидка WB ₽', 'База до SPP'],
        cells: (row: KpiDrilldownRow) => [
          formatPercent(row.sppPct),
          formatRub(row.sppRub),
          formatRub(row.sppBase),
        ],
      };
    }
    if (metric === 'conversion') {
      return {
        minWidth: 'min-w-[1000px]',
        headers: ['Товар', 'Артикул', 'Просмотр → заказ', 'Просмотры', 'Заказы', 'Сумма заказов', 'Выкупы'],
        cells: (row: KpiDrilldownRow) => [
          formatPercent(row.conversionPct),
          formatPlainNumber(row.views),
          formatUnits(row.quantity),
          formatRub(row.amount),
          formatUnits(row.buyouts),
        ],
      };
    }
    return {
      minWidth: 'min-w-[860px]',
      headers: ['Товар', 'Артикул', 'Выручка', 'Прибыль', 'Расходы', 'Реклама', 'Себестоимость'],
      cells: (row: KpiDrilldownRow) => [
        formatRub(row.revenue),
        formatRub(row.profit),
        formatRub(row.expenses),
        formatRub(row.ads),
        formatRub(row.cogs),
      ],
    };
  })();

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
      <div>
        <p className="text-sm font-black text-foreground">Детализация по SKU</p>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          Показываем первые {rows.length} строк, отсортированные по главной сумме показателя.
        </p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className={`w-full ${tableSpec.minWidth} text-left text-xs`}>
          <thead className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
            <tr className="border-b border-border">
              {tableSpec.headers.map((header, index) => (
                <th key={header} className={`px-3 py-2 ${index >= 2 ? 'text-right' : ''}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.nmId} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-2">
                  <ProductSkuCell row={row} />
                </td>
                <td className="max-w-[240px] truncate px-3 py-2 font-bold text-muted-foreground">
                  {row.vendorCode || row.brand || 'н/д'}
                </td>
                {tableSpec.cells(row).map((cell, index) => (
                  <td
                    key={`${row.nmId}-${index}`}
                    className={`px-3 py-2 text-right ${index === 0 && !isFinance ? 'font-black text-foreground' : 'font-semibold text-muted-foreground'}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VariantButton({
  active,
  icon: Icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-black transition-colors ${
        active
          ? 'border-cyan-500 bg-cyan-500 text-white shadow-[0_12px_28px_-20px_rgba(6,182,212,0.9)]'
          : 'border-border bg-card text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground'
      }`}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      <span className="font-semibold opacity-70">{description}</span>
    </button>
  );
}

function FocusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-subtle/60 px-3 py-2">
      <span className="font-black text-foreground">{label}</span>
      <span className="text-right font-semibold text-muted-foreground">{value}</span>
    </div>
  );
}
