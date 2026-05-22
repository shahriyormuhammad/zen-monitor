import { addDays, subDays } from 'date-fns';
import { desc, eq, inArray, sql } from 'drizzle-orm';

import type { AgentReportId } from '@/lib/agent-api';
import { AppError } from '@/lib/errors';
import { db, withAdminContext, withTenantContext } from '@/lib/db';
import { redistributionRuns, syncRuns, tenants } from '@/lib/db/schema';
import { parseApiDateParam, toLocalDateParam } from '@/lib/date-range';
import { getFastNetProfitBreakdown } from '@/server/analytics/services/finance-breakdown-fast';
import {
  buildTenantCostBreakdownDetail,
  summarizeFreshnessCoverage,
} from '@/server/agent/cost-breakdown-detail';
import { buildAdvertisingByNmSummary } from '@/server/agent/advertising-by-nm-summary';
import { buildSalesFunnelSummary } from '@/server/agent/sales-funnel-summary';
import { loadDashboardPayload } from '@/server/analytics/dashboard-summary';
import { listObservedProductOptions } from '@/server/catalog/observed-products';
import {
  buildAdvertisingCampaignsReport,
  buildAdvertisingCampaignStatsReport,
  buildAbTestsSummaryReport,
  buildCardContentSummaryReport,
  buildCardGroupSummaryReport,
  buildCompetitorCardsSummaryReport,
  buildFinanceRealizationDetailReport,
  buildFulfillmentSummaryReport,
  buildNicheCategorySummaryReport,
  buildOosHistoryReport,
  buildOrdersSalesSummaryReport,
  buildPriceHistoryReport,
  buildReviewsQaSummaryReport,
  buildSearchPositionsSummaryReport,
  buildStockHistoryReport,
  buildStocksSummaryReport,
  buildTariffsRulesSummaryReport,
  buildWorkerArtifactsSummaryReport,
} from '@/server/agent/procifry-read-reports';
import { buildCostWarehouseDeliveryConfigReport } from '@/server/agent/procifry-warehouse-delivery';

export type AgentReportParams = {
  from?: string | null;
  to?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  days?: number;
  keyword?: string | null;
  keywords?: string[];
  testId?: string | null;
  competitorNmId?: number | null;
  nmId?: number | null;
  nmIds?: number[];
  limit?: number;
  offset?: number;
  skip?: number;
  cursor?: string | number | null;
  page?: number;
  afterId?: string | null;
  answerStatus?: 'answered' | 'not_answered' | 'all';
  tenantIds?: string[];
  multiTenant?: boolean;
  multi_tenant?: boolean;
  includeZeroSales?: boolean;
  includeInactive?: boolean;
  groupBy?: 'product';
};

export type AgentReportRequest = {
  tenantId?: string | null;
  report: AgentReportId;
  params?: AgentReportParams;
};

export type AgentReportResult = {
  report: AgentReportId;
  tenantId: string | null;
  tenantIds?: string[];
  generatedAt: string;
  summaryText: string;
  period?: {
    dateFrom: string;
    dateTo: string;
  };
  groupBy?: string;
  totals?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  range?: {
    from: string;
    to: string;
    days: number;
  };
  data: Record<string, unknown>;
};

type ResolvedRange = {
  from: Date;
  to: Date;
  fromLabel: string;
  toLabel: string;
  days: number;
};

type TenantLookupRow = {
  id: string;
  name: string;
};

type RealizationCoverage = {
  dateFrom: string | null;
  dateTo: string | null;
  saleDateTo: string | null;
  sourceUpdatedAt: string | null;
};

type RealizationCoverageStatus = 'fresh' | 'wb_lag' | 'sync_stale' | 'partial' | 'missing';

type RealizationSyncSourceStatus = {
  runId: string;
  runStatus: string;
  triggerSource: string;
  requestedAt: string | null;
  finishedAt: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sourceStatus: string | null;
  sourceRecords: number | null;
  errorMessage: string | null;
  sourceError: string | null;
  sourceMeta: Record<string, unknown> | null;
};

type RealizationSyncStatus = {
  latest: RealizationSyncSourceStatus | null;
  latestSuccessful: RealizationSyncSourceStatus | null;
  lastSuccessfulSyncAt: string | null;
  expectedNextSyncAt: string | null;
};

type StorageAttributionWeight = {
  nmId: number;
  stockVolumeWeight: number;
  stockUnitWeight: number;
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatRub(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value))} ₽`;
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function toIsoString(value: unknown) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toDateOnly(value: unknown) {
  const iso = toIsoString(value);
  return iso ? iso.slice(0, 10) : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function loadRealizationCoverage(tenantId: string): Promise<RealizationCoverage> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      MIN(date_from)::date AS "dateFrom",
      MAX(date_to)::date AS "dateTo",
      MAX(sale_dt)::date AS "saleDateTo",
      MAX(created_at) AS "sourceUpdatedAt"
    FROM raw_api_realization_reports
    WHERE tenant_id = ${tenantId}
  `));
  const row = (rows as unknown as Array<{
    dateFrom: Date | string | null;
    dateTo: Date | string | null;
    saleDateTo: Date | string | null;
    sourceUpdatedAt: Date | string | null;
  }>)[0];

  return {
    dateFrom: toDateOnly(row?.dateFrom),
    dateTo: toDateOnly(row?.dateTo),
    saleDateTo: toDateOnly(row?.saleDateTo),
    sourceUpdatedAt: toIsoString(row?.sourceUpdatedAt),
  };
}

function readRealizationSource(summary: unknown) {
  const parsed = typeof summary === 'string'
    ? (() => {
        try {
          return JSON.parse(summary) as unknown;
        } catch {
          return null;
        }
      })()
    : summary;

  if (!isPlainRecord(parsed) || !Array.isArray(parsed.sources)) {
    return null;
  }

  const source = parsed.sources.find((entry) =>
    isPlainRecord(entry) && entry.source === 'realization_reports',
  );

  return isPlainRecord(source) ? source : null;
}

function normalizeRealizationSyncRow(row: {
  runId: string;
  runStatus: string;
  triggerSource: string;
  requestedAt: Date | string | null;
  finishedAt: Date | string | null;
  dateFrom: Date | string | null;
  dateTo: Date | string | null;
  errorMessage: string | null;
  summary: unknown;
}): RealizationSyncSourceStatus | null {
  const source = readRealizationSource(row.summary);
  if (!source) {
    return null;
  }

  const sourceMeta = isPlainRecord(source.meta) ? source.meta : null;

  return {
    runId: row.runId,
    runStatus: row.runStatus,
    triggerSource: row.triggerSource,
    requestedAt: toIsoString(row.requestedAt),
    finishedAt: toIsoString(row.finishedAt),
    dateFrom: toDateOnly(row.dateFrom),
    dateTo: toDateOnly(row.dateTo),
    sourceStatus: typeof source.status === 'string' ? source.status : null,
    sourceRecords: Number.isFinite(Number(source.records)) ? Number(source.records) : null,
    errorMessage: row.errorMessage ?? null,
    sourceError: typeof source.error === 'string' ? source.error : null,
    sourceMeta,
  };
}

function addOneDayIso(value: string | null) {
  const iso = toIsoString(value);
  if (!iso) {
    return null;
  }

  const next = new Date(iso);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

async function loadRealizationSyncStatus(tenantId: string): Promise<RealizationSyncStatus> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      id::text AS "runId",
      status AS "runStatus",
      trigger_source AS "triggerSource",
      requested_at AS "requestedAt",
      finished_at AS "finishedAt",
      date_from AS "dateFrom",
      date_to AS "dateTo",
      error_message AS "errorMessage",
      summary
    FROM sync_runs
    WHERE tenant_id = ${tenantId}::uuid
      AND (
        summary::jsonb @> '{"requestedSources":["realization_reports"]}'::jsonb
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(summary::jsonb->'sources', '[]'::jsonb)) source
          WHERE source->>'source' = 'realization_reports'
        )
      )
    ORDER BY requested_at DESC
    LIMIT 25
  `));

  const normalized = (rows as unknown as Array<{
    runId: string;
    runStatus: string;
    triggerSource: string;
    requestedAt: Date | string | null;
    finishedAt: Date | string | null;
    dateFrom: Date | string | null;
    dateTo: Date | string | null;
    errorMessage: string | null;
    summary: unknown;
  }>)
    .map(normalizeRealizationSyncRow)
    .filter((row): row is RealizationSyncSourceStatus => Boolean(row));

  const latest = normalized[0] ?? null;
  const latestSuccessful = normalized.find((row) => row.sourceStatus === 'success') ?? null;
  const syncAnchor = latest?.finishedAt ?? latest?.requestedAt ?? null;

  return {
    latest,
    latestSuccessful,
    lastSuccessfulSyncAt: latestSuccessful?.finishedAt ?? latestSuccessful?.requestedAt ?? null,
    expectedNextSyncAt: addOneDayIso(syncAnchor),
  };
}

function resolveRealizationCoverageStatus(
  coverage: RealizationCoverage,
  syncStatus: RealizationSyncStatus,
  range: ResolvedRange,
): RealizationCoverageStatus {
  if (coverage.dateTo && coverage.dateTo >= range.toLabel) {
    return 'fresh';
  }
  if (!coverage.dateTo) {
    return 'missing';
  }

  const latest = syncStatus.latest;
  const latestSuccessful = syncStatus.latestSuccessful;
  const latestFinishedAt = latest?.finishedAt ?? latest?.requestedAt ?? null;
  const latestSuccessFinishedAt = latestSuccessful?.finishedAt ?? latestSuccessful?.requestedAt ?? null;

  if (
    latestSuccessful?.dateTo
    && (
      latestSuccessful.dateTo >= range.toLabel
      || latestSuccessful.dateTo > coverage.dateTo
    )
  ) {
    return 'wb_lag';
  }

  if (
    latest?.sourceStatus === 'error'
    && (!latestSuccessFinishedAt || !latestFinishedAt || latestFinishedAt >= latestSuccessFinishedAt)
  ) {
    return 'sync_stale';
  }

  return 'partial';
}

function buildRealizationCoverageReason(
  status: RealizationCoverageStatus,
  coverage: RealizationCoverage,
  syncStatus: RealizationSyncStatus,
  range: ResolvedRange,
) {
  if (status === 'fresh') {
    return `Coverage reaches requested date ${range.toLabel}.`;
  }
  if (status === 'missing') {
    return 'No raw_api_realization_reports rows found for tenant.';
  }
  if (status === 'sync_stale') {
    const latest = syncStatus.latest;
    return `Latest realization sync failed: ${latest?.sourceError ?? latest?.errorMessage ?? latest?.sourceMeta?.shortMessage ?? 'unknown error'}.`;
  }
  if (status === 'wb_lag') {
    return `Latest successful realization sync requested data through ${syncStatus.latestSuccessful?.dateTo}, but WB returned rows only through ${coverage.dateTo}.`;
  }

  return `Coverage reaches ${coverage.dateTo}, before requested date ${range.toLabel}.`;
}

function clampLimit(value: number | null | undefined, fallback: number) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(20, Math.max(1, Math.trunc(numeric)));
}

function resolveDateRange(params: AgentReportParams | undefined, fallbackDays = 7): ResolvedRange {
  const fromAlias = params?.from?.trim() || null;
  const toAlias = params?.to?.trim() || null;
  const dateFrom = params?.dateFrom?.trim() || null;
  const dateTo = params?.dateTo?.trim() || null;

  if (fromAlias && dateFrom && fromAlias !== dateFrom) {
    throw new AppError('from and dateFrom must match when both are provided', 400);
  }
  if (toAlias && dateTo && toAlias !== dateTo) {
    throw new AppError('to and dateTo must match when both are provided', 400);
  }

  const fromRaw = dateFrom || fromAlias;
  const toRaw = dateTo || toAlias;

  if ((fromRaw && !toRaw) || (!fromRaw && toRaw)) {
    throw new AppError('Both from and to are required together', 400);
  }

  if (fromRaw && toRaw) {
    const from = parseApiDateParam(fromRaw);
    const to = parseApiDateParam(toRaw);
    if (!from || !to) {
      throw new AppError('Invalid date parameters', 400);
    }
    if (from.getTime() > to.getTime()) {
      throw new AppError('from must be <= to', 400);
    }

    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    return {
      from,
      to,
      fromLabel: toLocalDateParam(from),
      toLabel: toLocalDateParam(to),
      days,
    };
  }

  const rawDays = Number(params?.days ?? fallbackDays);
  const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, Math.trunc(rawDays))) : fallbackDays;
  const today = parseApiDateParam(toLocalDateParam(new Date()));
  if (!today) {
    throw new AppError('Failed to resolve current date', 500);
  }

  const from = subDays(today, days - 1);
  return {
    from,
    to: today,
    fromLabel: toLocalDateParam(from),
    toLabel: toLocalDateParam(today),
    days,
  };
}

function getMetricValue(metric: unknown) {
  if (!metric || typeof metric !== 'object') {
    return 0;
  }
  return toNumber((metric as { value?: unknown }).value);
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function requireTenantId(tenantId: string | null | undefined) {
  if (!tenantId) {
    throw new AppError('tenantId is required', 400);
  }
  return tenantId;
}

function resolveRequestedTenantIds(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
) {
  const fromParams = params?.tenantIds?.filter(Boolean) ?? [];
  if (fromParams.length > 0) {
    return [...new Set(fromParams)];
  }
  return tenantId ? [tenantId] : [];
}

function normalizeNmIds(params: AgentReportParams | undefined) {
  return Array.from(new Set(
    (params?.nmIds ?? [])
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value)),
  ));
}

async function buildDashboardSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const requestedTenantIds = resolveRequestedTenantIds(tenantId, params);
  if (requestedTenantIds.length === 0) {
    throw new AppError('tenantId or params.tenantIds is required for dashboard_summary', 400);
  }

  const range = resolveDateRange(params);
  const limit = clampLimit(params?.limit, 5);
  const tenantRows = await withAdminContext(db, (tx) =>
    tx.select({
      id: tenants.id,
      name: tenants.name,
    })
      .from(tenants)
      .where(inArray(tenants.id, requestedTenantIds)),
  ) as TenantLookupRow[];

  if (tenantRows.length !== requestedTenantIds.length) {
    throw new AppError('Some tenantIds were not found', 404);
  }

  const tenantNameById = new Map(tenantRows.map((row) => [row.id, row.name]));
  const cabinetSummaries = await Promise.all(requestedTenantIds.map(async (requestedTenantId) => {
    const payload = await loadDashboardPayload(requestedTenantId, range.from.toISOString(), range.to.toISOString());
    const kpi = payload.kpi as Record<string, unknown>;

    const revenue = getMetricValue(kpi.revenue);
    const profit = getMetricValue(kpi.profit);
    const ads = getMetricValue(kpi.ads);
    const orders = getMetricValue(kpi.orders);
    const margin = getMetricValue(kpi.margin);
    const buyoutRate = getMetricValue(kpi.buyoutRate);

    const topSelling = payload.products.topSelling.slice(0, limit).map((item) => ({
      nmId: item.nmId,
      vendorCode: item.vendorCode,
      brand: item.brand,
      soldQuantity: item.soldQuantity,
      grossRevenue: item.grossRevenue,
      netProfit: item.netProfit,
      adSpend: item.adSpend,
    }));

    return {
      tenantId: requestedTenantId,
      tenantName: tenantNameById.get(requestedTenantId) ?? requestedTenantId,
      metrics: {
        revenue,
        profit,
        ads,
        orders,
        marginPct: margin,
        buyoutRatePct: buyoutRate,
      },
      topSelling,
    };
  }));

  const totals = cabinetSummaries.reduce((acc, cabinet) => {
    acc.revenue += cabinet.metrics.revenue;
    acc.profit += cabinet.metrics.profit;
    acc.ads += cabinet.metrics.ads;
    acc.orders += cabinet.metrics.orders;
    return acc;
  }, {
    revenue: 0,
    profit: 0,
    ads: 0,
    orders: 0,
    marginPct: 0,
  });
  totals.marginPct = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  const topSelling = cabinetSummaries
    .flatMap((cabinet) => cabinet.topSelling.map((item) => ({
      ...item,
      tenantId: cabinet.tenantId,
      tenantName: cabinet.tenantName,
    })))
    .sort((left, right) => right.soldQuantity - left.soldQuantity || right.grossRevenue - left.grossRevenue)
    .slice(0, limit);

  const periodLabel = range.days === 1
    ? range.fromLabel
    : `${range.fromLabel} — ${range.toLabel}`;
  const summaryPrefix = requestedTenantIds.length === 1
    ? `Сводка за ${periodLabel}`
    : `Сводка по ${requestedTenantIds.length} кабинетам за ${periodLabel}`;
  const summaryTotals = {
    ...totals,
    orders: Math.round(totals.orders),
    tenantCount: requestedTenantIds.length,
  };

  return {
    report: 'dashboard_summary',
    tenantId: requestedTenantIds[0] ?? null,
    tenantIds: requestedTenantIds,
    generatedAt: new Date().toISOString(),
    range: {
      from: range.fromLabel,
      to: range.toLabel,
      days: range.days,
    },
    summaryText:
      `${summaryPrefix}: ` +
      `выручка ${formatRub(totals.revenue)}, прибыль ${formatRub(totals.profit)}, ` +
      `реклама ${formatRub(totals.ads)}, заказов ${Math.round(totals.orders)}, ` +
      `маржа ${formatPct(totals.marginPct)}.`,
    totals: summaryTotals,
    items: cabinetSummaries.map((cabinet) => ({
      tenantId: cabinet.tenantId,
      tenantName: cabinet.tenantName,
      ...cabinet.metrics,
    })),
    data: {
      period: {
        dateFrom: range.fromLabel,
        dateTo: range.toLabel,
      },
      tenantCount: requestedTenantIds.length,
      metrics: summaryTotals,
      totals: summaryTotals,
      cabinets: cabinetSummaries,
      topSelling,
    },
  };
}

async function loadStorageAttributionWeights(
  tenantId: string,
  range: ResolvedRange,
): Promise<Map<number, StorageAttributionWeight>> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      ss.nm_id AS "nmId",
      COALESCE(SUM(
        GREATEST(ss.stock_count, 0)
        * COALESCE(NULLIF(p.wb_warehouse_volume_liters::numeric, 0), 1)
      ), 0)::numeric AS "stockVolumeWeight",
      COALESCE(SUM(GREATEST(ss.stock_count, 0)), 0)::numeric AS "stockUnitWeight"
    FROM raw_api_stock_sizes ss
    LEFT JOIN products p
      ON p.tenant_id = ss.tenant_id
     AND p.nm_id = ss.nm_id
    WHERE ss.tenant_id = ${tenantId}
      AND ss.nm_id > 0
      AND ss.stock_type = 'wb'
      AND ss.snapshot_date::date >= ${range.fromLabel}::date
      AND ss.snapshot_date::date <= ${range.toLabel}::date
    GROUP BY ss.nm_id
  `));

  return new Map((rows as unknown as Array<{
    nmId: number | string;
    stockVolumeWeight: number | string | null;
    stockUnitWeight: number | string | null;
  }>).map((row) => [
    Number(row.nmId),
    {
      nmId: Number(row.nmId),
      stockVolumeWeight: toNumber(row.stockVolumeWeight),
      stockUnitWeight: toNumber(row.stockUnitWeight),
    },
  ]));
}

function applyNm0CostAttribution<T extends {
  nmId: number;
  soldQuantity: number;
  grossRevenue: number;
  storageCost: number;
  otherFees: number;
  profitBeforeTax: number;
  netProfit: number;
}>(
  items: T[],
  weights: Map<number, StorageAttributionWeight>,
) {
  const zeroItem = items.find((item) => item.nmId === 0);
  const targets = items.filter((item) => item.nmId > 0);
  if (!zeroItem || targets.length === 0) {
    return {
      items,
      attribution: null,
    };
  }

  const storageToAllocate = toNumber(zeroItem.storageCost);
  const otherFeesToAllocate = toNumber(zeroItem.otherFees);
  const totalToAllocate = storageToAllocate + otherFeesToAllocate;
  if (Math.abs(totalToAllocate) <= 0.0001) {
    return {
      items: items.filter((item) => item.nmId !== 0),
      attribution: {
        sourceNmId: 0,
        method: 'none_zero_amount',
        storageCost: storageToAllocate,
        otherFees: otherFeesToAllocate,
        allocatedTotal: 0,
        targetCount: targets.length,
      },
    };
  }

  const volumeWeights = targets.map((item) => weights.get(item.nmId)?.stockVolumeWeight ?? 0);
  const unitWeights = targets.map((item) => weights.get(item.nmId)?.stockUnitWeight ?? 0);
  const soldWeights = targets.map((item) => Math.max(0, toNumber(item.soldQuantity)));
  const revenueWeights = targets.map((item) => Math.max(0, toNumber(item.grossRevenue)));
  const pickWeights = volumeWeights.some((value) => value > 0)
    ? { method: 'stock_volume_days', values: volumeWeights, confidence: 'partial' }
    : unitWeights.some((value) => value > 0)
      ? { method: 'stock_unit_days', values: unitWeights, confidence: 'partial' }
      : soldWeights.some((value) => value > 0)
        ? { method: 'sold_quantity', values: soldWeights, confidence: 'partial' }
        : revenueWeights.some((value) => value > 0)
          ? { method: 'gross_revenue', values: revenueWeights, confidence: 'partial' }
          : { method: 'equal_split', values: targets.map(() => 1), confidence: 'missing' };
  const weightTotal = pickWeights.values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const allocatedItems = targets.map((item, index) => {
    const share = weightTotal > 0 ? Math.max(0, pickWeights.values[index] ?? 0) / weightTotal : 1 / targets.length;
    const storageShare = storageToAllocate * share;
    const otherFeesShare = otherFeesToAllocate * share;
    const allocated = storageShare + otherFeesShare;
    return {
      ...item,
      storageCost: item.storageCost + storageShare,
      otherFees: item.otherFees + otherFeesShare,
      profitBeforeTax: item.profitBeforeTax - allocated,
      netProfit: item.netProfit - allocated,
      nm0Attribution: {
        storageCost: storageShare,
        otherFees: otherFeesShare,
        method: pickWeights.method,
        confidence: pickWeights.confidence,
      },
    };
  });

  return {
    items: allocatedItems,
    attribution: {
      sourceNmId: 0,
      method: pickWeights.method,
      confidence: pickWeights.confidence,
      storageCost: storageToAllocate,
      otherFees: otherFeesToAllocate,
      allocatedTotal: totalToAllocate,
      targetCount: targets.length,
      note: 'nmId=0 storage/other fees redistributed inside Agent API output; source raw rows remain unchanged.',
    },
  };
}

async function buildUnitEconomicsSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = requireTenantId(tenantId);
  const range = resolveDateRange(params);
  const limit = clampLimit(params?.limit, 5);
  const nmId = Number.isFinite(Number(params?.nmId)) && Number(params?.nmId) > 0
    ? Math.trunc(Number(params?.nmId))
    : null;

  let breakdown: Awaited<ReturnType<typeof getFastNetProfitBreakdown>>;
  try {
    breakdown = await getFastNetProfitBreakdown(
      resolvedTenantId,
      range.from,
      range.to,
      nmId,
      { calculationMode: 'FACT_WB' },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      report: 'unit_economics_summary',
      tenantId: resolvedTenantId,
      generatedAt: new Date().toISOString(),
      range: {
        from: range.fromLabel,
        to: range.toLabel,
        days: range.days,
      },
      period: {
        dateFrom: range.fromLabel,
        dateTo: range.toLabel,
      },
      summaryText: `Юнит-экономика за ${range.days} дн. недоступна: расчетный engine вернул ошибку. Агент не должен подменять это локальной оценкой без явной пометки partial.`,
      totals: {
        itemCount: 0,
        sourceStatus: 'calculation_error',
      },
      items: [],
      data: {
        available: false,
        sourceStatus: 'calculation_error',
        confidence: 'missing',
        error: {
          message,
          status: error instanceof AppError ? error.status : 500,
        },
        filter: {
          nmId,
        },
        totals: {
          grossRevenue: 0,
          netProfit: 0,
          adSpend: 0,
          soldQuantity: 0,
          unitsSold: 0,
          marginPct: 0,
        },
        itemCount: 0,
        items: [],
        focusItem: null,
        topProfitItems: [],
        worstProfitItems: [],
      },
    };
  }
  const [realizationCoverage, realizationSyncStatus] = await Promise.all([
    loadRealizationCoverage(resolvedTenantId),
    loadRealizationSyncStatus(resolvedTenantId),
  ]);
  const realizationCoverageStatus = resolveRealizationCoverageStatus(realizationCoverage, realizationSyncStatus, range);
  const requestedRangeCoverage = realizationCoverageStatus === 'fresh'
    ? 'fresh'
    : realizationCoverageStatus === 'missing'
      ? 'missing'
      : 'partial';
  const unconfirmedFrom = realizationCoverage.dateTo
    ? toLocalDateParam(addDays(parseApiDateParam(realizationCoverage.dateTo) ?? range.from, 1))
    : range.fromLabel;
  const realizationCoverageNote = realizationCoverageStatus === 'fresh'
    ? `WB realization покрывает выбранный период до ${range.toLabel}.`
    : realizationCoverageStatus === 'wb_lag'
      ? `Последний sync realization прошел, но WB вернул финальные реализации только до ${realizationCoverage.dateTo}; даты ${unconfirmedFrom} — ${range.toLabel} пока считаются provisional.`
      : realizationCoverageStatus === 'sync_stale'
        ? `Последний sync realization завершился ошибкой; подтверждено до ${realizationCoverage.dateTo ?? 'н/д'}, даты ${unconfirmedFrom} — ${range.toLabel} требуют повторного sync.`
        : realizationCoverage.dateTo
          ? `WB realization подтвержден до ${realizationCoverage.dateTo}; даты ${unconfirmedFrom} — ${range.toLabel} могут не иметь финальных комиссий, логистики и удержаний WB.`
          : 'WB realization не найден для кабинета; финальные комиссии, логистика и удержания WB не подтверждены.';
  const realizationCoverageReason = buildRealizationCoverageReason(
    realizationCoverageStatus,
    realizationCoverage,
    realizationSyncStatus,
    range,
  );

  const totals = breakdown.totals;
  const rawItems = breakdown.items.map((item) => ({
    nmId: item.nmId,
    vendorCode: item.vendorCode,
    brand: item.brand,
    barcode: item.barcode,
    category: item.category,
    photoUrl: item.photoUrl,
    soldQuantity: toNumber((item as { soldQuantity?: unknown; unitsSold?: unknown }).soldQuantity ?? (item as { unitsSold?: unknown }).unitsSold),
    unitsSold: toNumber((item as { unitsSold?: unknown; soldQuantity?: unknown }).unitsSold ?? (item as { soldQuantity?: unknown }).soldQuantity),
    grossRevenue: item.grossRevenue,
    commission: item.commission,
    logistics: item.logistics,
    otherFees: item.otherFees,
    costTotal: item.costTotal,
    storageCost: item.storageCost,
    adSpend: item.adSpend,
    purchasePrice: toNullableNumber((item as { purchasePrice?: unknown }).purchasePrice),
    costPerUnit: toNullableNumber((item as { costPerUnit?: unknown }).costPerUnit),
    fullCostPerUnit: toNullableNumber((item as { fullCostPerUnit?: unknown }).fullCostPerUnit),
    profitBeforeTax: item.profitBeforeTax,
    taxAmount: item.taxAmount,
    netProfit: item.netProfit,
  }));
  const reportedTotalUnits = toNumber((totals as { soldQuantity?: unknown; unitsSold?: unknown }).soldQuantity
    ?? (totals as { unitsSold?: unknown }).unitsSold);
  const totalUnits = reportedTotalUnits > 0
    ? reportedTotalUnits
    : rawItems.reduce((sum, item) => sum + item.soldQuantity, 0);
  const storageWeights = await loadStorageAttributionWeights(resolvedTenantId, range);
  const { items, attribution: nm0Attribution } = applyNm0CostAttribution(rawItems, storageWeights);
  const marginPct = totals.grossRevenue > 0 ? (totals.netProfit / totals.grossRevenue) * 100 : 0;
  const topProfitItems = [...items]
    .sort((left, right) => right.netProfit - left.netProfit || right.grossRevenue - left.grossRevenue)
    .slice(0, limit);
  const worstProfitItems = [...items]
    .sort((left, right) => left.netProfit - right.netProfit || right.adSpend - left.adSpend)
    .slice(0, limit);
  const focusItem = nmId
    ? items.find((item) => item.nmId === nmId) ?? null
    : null;

  const summaryText = focusItem
    ? `Юнит-экономика по NM ${focusItem.nmId} за ${range.days} дн.: ` +
      `продано ${Math.round(focusItem.unitsSold)} шт, выручка ${formatRub(focusItem.grossRevenue)}, ` +
      `прибыль ${formatRub(focusItem.netProfit)}, полная себестоимость/шт ` +
      `${focusItem.fullCostPerUnit === null ? 'н/д' : formatRub(focusItem.fullCostPerUnit)}. ` +
      realizationCoverageNote
    : `Юнит-экономика за ${range.days} дн. (${range.fromLabel} — ${range.toLabel}): ` +
      `выручка ${formatRub(totals.grossRevenue)}, прибыль ${formatRub(totals.netProfit)}, ` +
      `реклама ${formatRub(totals.adSpend)}, маржа ${formatPct(marginPct)}, ` +
      `артикулов ${items.length}, продано ${Math.round(totalUnits)} шт. ` +
      realizationCoverageNote;

  return {
    report: 'unit_economics_summary',
    tenantId: resolvedTenantId,
    generatedAt: new Date().toISOString(),
    range: {
      from: range.fromLabel,
      to: range.toLabel,
      days: range.days,
    },
    summaryText,
    data: {
      filter: {
        nmId,
      },
      tax: {
        taxType: breakdown.taxType,
        taxRatePercent: breakdown.taxRatePercent,
      },
      totals: {
        ...totals,
        soldQuantity: totalUnits,
        unitsSold: totalUnits,
        marginPct,
      },
      dataFreshness: {
        realizationReports: {
          source: 'raw_api_realization_reports',
          dateCoverage: {
            from: realizationCoverage.dateFrom,
            to: realizationCoverage.dateTo,
          },
          saleDateTo: realizationCoverage.saleDateTo,
          sourceUpdatedAt: realizationCoverage.sourceUpdatedAt,
          requestedRangeCoverage,
          coverageStatus: realizationCoverageStatus,
          reason: realizationCoverageReason,
          lastSuccessfulSyncAt: realizationSyncStatus.lastSuccessfulSyncAt,
          expectedNextSyncAt: realizationSyncStatus.expectedNextSyncAt,
          latestSync: realizationSyncStatus.latest,
          latestSuccessfulSync: realizationSyncStatus.latestSuccessful,
          note: realizationCoverageNote,
        },
      },
      attribution: {
        nm0: nm0Attribution,
      },
      itemCount: items.length,
      items,
      focusItem,
      topProfitItems,
      worstProfitItems,
    },
  };
}

async function buildCostSnapshotReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const requestedTenantIds = resolveRequestedTenantIds(tenantId, params);
  if (requestedTenantIds.length === 0) {
    throw new AppError('tenantId or params.tenantIds is required for cost_snapshot', 400);
  }

  const range = resolveDateRange({
    ...params,
    days: params?.days ?? 30,
  }, 30);

  const tenantRows = await withAdminContext(db, (tx) =>
    tx.select({
      id: tenants.id,
      name: tenants.name,
    })
      .from(tenants)
      .where(inArray(tenants.id, requestedTenantIds)),
  ) as TenantLookupRow[];

  if (tenantRows.length !== requestedTenantIds.length) {
    throw new AppError('Some tenantIds were not found', 404);
  }

  const tenantNameById = new Map(tenantRows.map((row) => [row.id, row.name]));
  const tenantItems = await Promise.all(requestedTenantIds.map(async (requestedTenantId) => {
    const [catalogRows, breakdownResult] = await Promise.allSettled([
      listObservedProductOptions(requestedTenantId),
      getFastNetProfitBreakdown(
        requestedTenantId,
        range.from,
        range.to,
        null,
        { calculationMode: 'FACT_WB' },
      ),
    ]);
    if (catalogRows.status === 'rejected') {
      throw catalogRows.reason;
    }

    const breakdown = breakdownResult.status === 'fulfilled' ? breakdownResult.value : null;

    const fullCostByNmId = new Map(
      (breakdown?.items ?? []).map((item) => [
        item.nmId,
        toNullableNumber((item as { fullCostPerUnit?: unknown }).fullCostPerUnit),
      ]),
    );

    return catalogRows.value.map((row) => ({
      tenantId: requestedTenantId,
      tenantName: tenantNameById.get(requestedTenantId) ?? requestedTenantId,
      nmId: row.nmId,
      vendorCode: row.vendorCode,
      name: row.title?.trim() || row.vendorCode || `WB ${row.nmId}`,
      purchasePrice: row.costPrice,
      lastFullCostPerUnit: fullCostByNmId.get(row.nmId) ?? null,
      updatedAt: row.costPriceUpdatedAt,
      calculationStatus: breakdown ? 'ok' : 'calculation_error',
      calculationError: breakdownResult.status === 'rejected'
        ? (breakdownResult.reason instanceof Error ? breakdownResult.reason.message : String(breakdownResult.reason))
        : null,
    }));
  }));

  const items = tenantItems
    .flat()
    .sort((left, right) =>
      left.tenantName.localeCompare(right.tenantName, 'ru', { sensitivity: 'base' })
      || left.vendorCode.localeCompare(right.vendorCode, 'ru', { sensitivity: 'base' })
      || left.nmId - right.nmId,
    );
  const calculationErrors = Array.from(new Map(
    items
      .filter((item) => item.calculationStatus === 'calculation_error')
      .map((item) => [
        item.tenantId,
        {
          tenantId: item.tenantId,
          tenantName: item.tenantName,
          error: item.calculationError,
        },
      ]),
  ).values());

  return {
    report: 'cost_snapshot',
    tenantId: requestedTenantIds[0] ?? null,
    tenantIds: requestedTenantIds,
    generatedAt: new Date().toISOString(),
    range: {
      from: range.fromLabel,
      to: range.toLabel,
      days: range.days,
    },
    summaryText:
      `Слепок себестоимости по ${requestedTenantIds.length} кабинетам: ` +
      `${items.length} SKU, полная себестоимость/шт рассчитана по периоду ` +
      `${range.fromLabel} — ${range.toLabel}.`,
    data: {
      itemCount: items.length,
      tenantCount: requestedTenantIds.length,
      calculationErrors,
      items,
    },
  };
}

async function buildCostBreakdownDetailReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const requestedTenantIds = resolveRequestedTenantIds(tenantId, params);
  if (requestedTenantIds.length === 0) {
    throw new AppError('tenantId or params.tenantIds is required for cost_breakdown_detail', 400);
  }

  const hasExplicitRange = Boolean(
    params?.dateFrom?.trim()
    || params?.dateTo?.trim()
    || params?.from?.trim()
    || params?.to?.trim(),
  );
  if (!hasExplicitRange) {
    throw new AppError('dateFrom and dateTo are required for cost_breakdown_detail', 400);
  }

  const range = resolveDateRange(params);
  const nmIds = normalizeNmIds(params);
  const includeZeroSales = Boolean(params?.includeZeroSales);
  const includeInactive = Boolean(params?.includeInactive);

  const tenantRows = await withAdminContext(db, (tx) =>
    tx.select({
      id: tenants.id,
      name: tenants.name,
    })
      .from(tenants)
      .where(inArray(tenants.id, requestedTenantIds)),
  ) as TenantLookupRow[];

  if (tenantRows.length !== requestedTenantIds.length) {
    throw new AppError('Some tenantIds were not found', 404);
  }

  const tenantNameById = new Map(tenantRows.map((row) => [row.id, row.name]));
  const tenantResults = await Promise.all(requestedTenantIds.map((requestedTenantId) =>
    buildTenantCostBreakdownDetail({
      tenantId: requestedTenantId,
      tenantName: tenantNameById.get(requestedTenantId) ?? requestedTenantId,
      from: range.from,
      to: range.to,
      nmIds,
      includeZeroSales,
      includeInactive,
    }),
  ));

  const items = tenantResults
    .flatMap((result) => result.items)
    .sort((left, right) =>
      left.tenantName.localeCompare(right.tenantName, 'ru', { sensitivity: 'base' })
      || left.vendorCode.localeCompare(right.vendorCode, 'ru', { sensitivity: 'base' })
      || left.nmId - right.nmId,
    );

  const freshness = tenantResults.map((result) => result.dataFreshness);
  const dataFreshness = summarizeFreshnessCoverage(freshness, range.to);

  return {
    report: 'cost_breakdown_detail',
    tenantId: requestedTenantIds[0] ?? null,
    tenantIds: requestedTenantIds,
    generatedAt: new Date().toISOString(),
    range: {
      from: range.fromLabel,
      to: range.toLabel,
      days: range.days,
    },
    summaryText:
      `Детализация себестоимости за ${range.days} дн. (${range.fromLabel} — ${range.toLabel}): `
      + `${items.length} SKU по ${requestedTenantIds.length} кабинетам. `
      + `fullCostPerUnit в ответе равен сумме components.`,
    data: {
      tenantCount: requestedTenantIds.length,
      itemCount: items.length,
      filters: {
        tenantIds: requestedTenantIds,
        nmIds,
        includeZeroSales,
        includeInactive,
      },
      items,
      dataFreshness,
      data_freshness: dataFreshness,
    },
  };
}

async function buildSalesFunnelSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = requireTenantId(tenantId);
  const hasExplicitRange = Boolean(
    params?.dateFrom?.trim()
    || params?.dateTo?.trim()
    || params?.from?.trim()
    || params?.to?.trim(),
  );
  if (!hasExplicitRange) {
    throw new AppError('dateFrom and dateTo are required for sales_funnel_summary', 400);
  }

  const range = resolveDateRange(params);
  const nmIds = normalizeNmIds(params);
  const groupBy = params?.groupBy ?? 'product';

  const { totals, items } = await buildSalesFunnelSummary({
    tenantId: resolvedTenantId,
    dateFrom: range.fromLabel,
    dateTo: range.toLabel,
    nmIds,
  });

  const hasData = items.length > 0;
  const summaryText = hasData
    ? `Воронка продаж за ${range.days} дн. (${range.fromLabel} — ${range.toLabel}): `
      + `карточки ${Math.round(totals.openCardCount)}, в корзину ${Math.round(totals.addToCartCount)} `
      + `(${formatPct(totals.cartConversionPct)}), заказов ${Math.round(totals.ordersCount)} `
      + `на ${formatRub(totals.ordersSumRub)}, выкупов ${Math.round(totals.buyoutsCount)} `
      + `на ${formatRub(totals.buyoutsSumRub)}, выкуп ${formatPct(totals.buyoutPct)}.`
    : `Воронка продаж за ${range.days} дн. (${range.fromLabel} — ${range.toLabel}): данных нет.`;

  return {
    report: 'sales_funnel_summary',
    tenantId: resolvedTenantId,
    generatedAt: new Date().toISOString(),
    range: {
      from: range.fromLabel,
      to: range.toLabel,
      days: range.days,
    },
    period: {
      dateFrom: range.fromLabel,
      dateTo: range.toLabel,
    },
    groupBy,
    summaryText,
    totals,
    items,
    data: {
      period: {
        dateFrom: range.fromLabel,
        dateTo: range.toLabel,
      },
      groupBy,
      filter: {
        nmIds,
      },
      totals,
      itemCount: items.length,
      items,
    },
  };
}

async function buildAdvertisingByNmSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = requireTenantId(tenantId);
  const hasExplicitRange = Boolean(
    params?.dateFrom?.trim()
    || params?.dateTo?.trim()
    || params?.from?.trim()
    || params?.to?.trim(),
  );
  if (!hasExplicitRange) {
    throw new AppError('dateFrom and dateTo are required for advertising_by_nm_summary', 400);
  }

  const range = resolveDateRange(params);
  const nmIds = normalizeNmIds(params);
  const { totals, items } = await buildAdvertisingByNmSummary({
    tenantId: resolvedTenantId,
    dateFrom: range.fromLabel,
    dateTo: range.toLabel,
    nmIds,
  });

  const summaryText = items.length > 0
    ? `Реклама по артикулам за ${range.days} дн. (${range.fromLabel} — ${range.toLabel}): `
      + `${formatRub(totals.adSpend)} по ${totals.nmCount} артикулам, кампаний ${totals.campaignCount}.`
    : `Реклама по артикулам за ${range.days} дн. (${range.fromLabel} — ${range.toLabel}): данных нет.`;

  return {
    report: 'advertising_by_nm_summary',
    tenantId: resolvedTenantId,
    generatedAt: new Date().toISOString(),
    range: {
      from: range.fromLabel,
      to: range.toLabel,
      days: range.days,
    },
    period: {
      dateFrom: range.fromLabel,
      dateTo: range.toLabel,
    },
    summaryText,
    totals,
    items,
    data: {
      period: {
        dateFrom: range.fromLabel,
        dateTo: range.toLabel,
      },
      filter: {
        nmIds,
      },
      totals,
      itemCount: items.length,
      diagnostics: {
        spendSource: totals.spendSource,
        rawCostSpend: totals.rawCostSpend,
        clusterSpend: totals.clusterSpend,
        note: 'adSpend выбирается по SKU из raw_api_ad_clusters.amount, если fullstats/cluster spend materially выше raw_api_ad_costs; иначе используется raw_api_ad_costs.',
      },
      items,
    },
  };
}

async function buildSyncStatusReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = requireTenantId(tenantId);
  const limit = clampLimit(params?.limit, 5);
  const [recentSyncRuns, recentRedistributionRuns] = await withTenantContext(db, resolvedTenantId, async (tx) =>
    Promise.all([
      tx.select({
        id: syncRuns.id,
        status: syncRuns.status,
        triggerSource: syncRuns.triggerSource,
        requestedAt: syncRuns.requestedAt,
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        errorMessage: syncRuns.errorMessage,
      })
        .from(syncRuns)
        .where(eq(syncRuns.tenantId, resolvedTenantId))
        .orderBy(desc(syncRuns.requestedAt))
        .limit(limit),
      tx.select({
        id: redistributionRuns.id,
        status: redistributionRuns.status,
        triggerSource: redistributionRuns.triggerSource,
        createdAt: redistributionRuns.createdAt,
        updatedAt: redistributionRuns.updatedAt,
        recommendationCount: redistributionRuns.recommendationCount,
        estimatedSavingsRub: redistributionRuns.estimatedSavingsRub,
        errorMessage: redistributionRuns.errorMessage,
      })
        .from(redistributionRuns)
        .where(eq(redistributionRuns.tenantId, resolvedTenantId))
        .orderBy(desc(redistributionRuns.createdAt))
        .limit(limit),
    ]),
  );

  const syncSummary = recentSyncRuns.reduce((acc, run) => {
    acc.total += 1;
    if (run.status === 'completed') acc.completed += 1;
    else if (run.status === 'failed') acc.failed += 1;
    else acc.active += 1;
    return acc;
  }, { total: 0, completed: 0, failed: 0, active: 0 });

  const latestSync = recentSyncRuns[0] ?? null;
  const latestRedistribution = recentRedistributionRuns[0] ?? null;

  return {
    report: 'sync_status',
    tenantId: resolvedTenantId,
    generatedAt: new Date().toISOString(),
    summaryText:
      `Последние sync-запуски: всего ${syncSummary.total}, ` +
      `успешно ${syncSummary.completed}, с ошибкой ${syncSummary.failed}, активных ${syncSummary.active}. ` +
      `Последний sync: ${latestSync?.status ?? 'нет данных'}.`,
    data: {
      syncRuns: {
        summary: syncSummary,
        latest: latestSync
          ? {
              ...latestSync,
              requestedAt: latestSync.requestedAt?.toISOString() ?? null,
              startedAt: latestSync.startedAt?.toISOString() ?? null,
              finishedAt: latestSync.finishedAt?.toISOString() ?? null,
            }
          : null,
        recent: recentSyncRuns.map((run) => ({
          ...run,
          requestedAt: run.requestedAt?.toISOString() ?? null,
          startedAt: run.startedAt?.toISOString() ?? null,
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
      },
      redistributionRuns: {
        latest: latestRedistribution
          ? {
              ...latestRedistribution,
              createdAt: latestRedistribution.createdAt?.toISOString() ?? null,
              updatedAt: latestRedistribution.updatedAt?.toISOString() ?? null,
              estimatedSavingsRub: toNumber(latestRedistribution.estimatedSavingsRub),
            }
          : null,
        recent: recentRedistributionRuns.map((run) => ({
          ...run,
          createdAt: run.createdAt?.toISOString() ?? null,
          updatedAt: run.updatedAt?.toISOString() ?? null,
          estimatedSavingsRub: toNumber(run.estimatedSavingsRub),
        })),
      },
    },
  };
}

export async function buildAgentReport(
  request: AgentReportRequest,
): Promise<AgentReportResult> {
  switch (request.report) {
    case 'dashboard_summary':
      return buildDashboardSummaryReport(request.tenantId, request.params);
    case 'unit_economics_summary':
      return buildUnitEconomicsSummaryReport(request.tenantId, request.params);
    case 'cost_snapshot':
      return buildCostSnapshotReport(request.tenantId, request.params);
    case 'cost_breakdown_detail':
      return buildCostBreakdownDetailReport(request.tenantId, request.params);
    case 'cost_warehouse_delivery_config':
      return buildCostWarehouseDeliveryConfigReport(request.tenantId, request.params);
    case 'sales_funnel_summary':
      return buildSalesFunnelSummaryReport(request.tenantId, request.params);
    case 'advertising_by_nm_summary':
      return buildAdvertisingByNmSummaryReport(request.tenantId, request.params);
    case 'sync_status':
      return buildSyncStatusReport(request.tenantId, request.params);
    case 'stocks_summary':
      return buildStocksSummaryReport(request.tenantId, request.params);
    case 'stock_history':
      return buildStockHistoryReport(request.tenantId, request.params);
    case 'oos_history':
      return buildOosHistoryReport(request.tenantId, request.params);
    case 'reviews_summary':
      return buildReviewsQaSummaryReport('reviews_summary', request.tenantId, request.params);
    case 'questions_summary':
      return buildReviewsQaSummaryReport('questions_summary', request.tenantId, request.params);
    case 'card_content_summary':
      return buildCardContentSummaryReport(request.tenantId, request.params);
    case 'card_group_summary':
      return buildCardGroupSummaryReport(request.tenantId, request.params);
    case 'price_history':
      return buildPriceHistoryReport(request.tenantId, request.params);
    case 'advertising_campaigns':
      return buildAdvertisingCampaignsReport(request.tenantId, request.params);
    case 'advertising_campaign_stats':
      return buildAdvertisingCampaignStatsReport(request.tenantId, request.params);
    case 'search_positions_summary':
      return buildSearchPositionsSummaryReport(request.tenantId, request.params);
    case 'competitor_cards_summary':
      return buildCompetitorCardsSummaryReport(request.tenantId, request.params);
    case 'ab_tests_summary':
      return buildAbTestsSummaryReport(request.tenantId, request.params);
    case 'finance_realization_detail':
      return buildFinanceRealizationDetailReport(request.tenantId, request.params);
    case 'orders_sales_summary':
      return buildOrdersSalesSummaryReport(request.tenantId, request.params);
    case 'fulfillment_summary':
      return buildFulfillmentSummaryReport(request.tenantId, request.params);
    case 'tariffs_rules_summary':
      return buildTariffsRulesSummaryReport(request.tenantId, request.params);
    case 'worker_artifacts_summary':
      return buildWorkerArtifactsSummaryReport(request.tenantId, request.params);
    case 'niche_category_summary':
      return buildNicheCategorySummaryReport(request.tenantId, request.params);
    default: {
      const exhaustiveCheck: never = request.report;
      throw new AppError(`Unsupported report: ${String(exhaustiveCheck)}`, 400);
    }
  }
}
