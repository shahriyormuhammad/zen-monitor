import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { syncRuns, unitEconomicsManualInputs } from '@/lib/db/schema';
import { listObservedProductOptions, type ProductOptionRow } from '@/server/catalog/observed-products';
import { buildWbDeductionExpenseSql } from '@/server/analytics/services/economics';

const MONEY_PRECISION = 4;
const SALES_STALE_TOLERANCE_MS = 36 * 60 * 60 * 1000;
const STOCKS_STALE_TOLERANCE_MS = 48 * 60 * 60 * 1000;
const COSTS_STALE_TOLERANCE_MS = 30 * 24 * 60 * 60 * 1000;

type ManualInputRow = {
  nmId: number;
  manualFields: Record<string, unknown>;
  updatedAt: Date | null;
};

type CostAggregateRow = {
  nmId: number;
  soldQuantity: number | string | null;
  grossRevenueTotal: number | string | null;
  commissionTotal: number | string | null;
  wbLogisticsTotal: number | string | null;
  returnsTotal: number | string | null;
  storageTotal: number | string | null;
  acceptanceTotal: number | string | null;
  acquiringTotal: number | string | null;
  penaltiesTotal: number | string | null;
  otherTotal: number | string | null;
  advertisingTotal: number | string | null;
  adSource: string | null;
  latestSalesAt: Date | string | null;
  latestAdvertisingAt: Date | string | null;
  latestStorageAt: Date | string | null;
  latestStockAt: Date | string | null;
  usedProvisionalTail: boolean | null;
};

type FreshnessAggregateRow = {
  realizationMaxAt: Date | string | null;
  provisionalSalesMaxAt: Date | string | null;
  adCostsMaxAt: Date | string | null;
  adClustersMaxAt: Date | string | null;
  paidStorageMaxAt: Date | string | null;
  stocksMaxAt: Date | string | null;
  costConfigMaxAt: Date | string | null;
  manualInputsMaxAt: Date | string | null;
};

type ParsedManualFields = {
  costPrice: number | null;
  deliveryToFf: number;
  packagingMaterial: number;
  fulfillment: number;
  purchaseQtyTotal: number | null;
  marketingInternal: number;
  marketingExternal: number;
  contentCost: number;
  otherCosts: number;
  selectedWarehouses: string[];
  warehouseCosts: Record<string, number>;
};

type LatestUsableSync = {
  id: string;
  status: string;
  requestedAt: string | null;
  finishedAt: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  errorMessage: string | null;
};

type ComponentKey =
  | 'purchase'
  | 'deliveryFromChina'
  | 'packaging'
  | 'fulfillment'
  | 'deliveryToWb'
  | 'wbLogistics'
  | 'returns'
  | 'storage'
  | 'acceptance'
  | 'commission'
  | 'acquiring'
  | 'advertising'
  | 'penalties'
  | 'other';

export type CostBreakdownDetailItem = {
  tenantId: string;
  tenantName: string;
  nmId: number;
  vendorCode: string;
  name: string;
  sales: {
    unitsSold: number;
    grossRevenue: number;
  };
  unitsSold: number;
  purchasePrice: number | null;
  fullCostPerUnit: number;
  components: Record<ComponentKey, number>;
  componentsTotal: number;
  sources: Record<ComponentKey, string>;
  updatedAt: string | null;
  warnings: string[];
  isArchived: boolean;
  isObservedOnly: boolean;
};

export type DataFreshnessSource = {
  status: 'fresh' | 'stale' | 'missing';
  lastAvailableAt: string | null;
  comparedTo: string;
  deltaHours: number | null;
  source: string;
};

export type CostBreakdownDataFreshness = {
  tenantId: string;
  tenantName: string;
  latestUsableSync: LatestUsableSync | null;
  latestUsableSyncCoverage: 'fresh' | 'stale' | 'missing';
  latestUsableSyncCoverageComparedTo: string;
  sales: DataFreshnessSource;
  advertising: DataFreshnessSource;
  storage: DataFreshnessSource;
  stocks: DataFreshnessSource;
  costs: DataFreshnessSource;
};

export type CostBreakdownTenantResult = {
  items: CostBreakdownDetailItem[];
  dataFreshness: CostBreakdownDataFreshness;
};

export type BuildCostBreakdownDetailOptions = {
  tenantId: string;
  tenantName: string;
  from: Date;
  to: Date;
  nmIds?: number[];
  includeZeroSales?: boolean;
  includeInactive?: boolean;
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value: number) {
  const factor = 10 ** MONEY_PRECISION;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

function inListSql(values: number[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

function andInFilter(column: SQL, values: number[]) {
  return values.length > 0 ? sql`AND ${column} IN (${inListSql(values)})` : sql``;
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pickLatestIso(...values: Array<Date | string | null | undefined>) {
  let latest: string | null = null;
  let latestTimestamp = -1;

  for (const value of values) {
    const iso = toIsoString(value);
    if (!iso) {
      continue;
    }

    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latest = iso;
    }
  }

  return latest;
}

function parseStringNumber(input: unknown) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  if (typeof input === 'string') {
    const normalized = input.trim().replace(',', '.');
    if (!normalized) {
      return null;
    }

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function parseManualFields(value: unknown): ParsedManualFields {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const rawSelectedWarehouses = Array.isArray(payload.selectedWarehouses)
    ? payload.selectedWarehouses.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const rawWarehouseCosts = payload.warehouseCosts && typeof payload.warehouseCosts === 'object' && !Array.isArray(payload.warehouseCosts)
    ? payload.warehouseCosts as Record<string, unknown>
    : {};

  const warehouseCosts: Record<string, number> = {};
  for (const [warehouseId, rawValue] of Object.entries(rawWarehouseCosts)) {
    const parsed = parseStringNumber(rawValue);
    if (parsed !== null) {
      warehouseCosts[warehouseId] = parsed;
    }
  }

  return {
    costPrice: parseStringNumber(payload.costPrice),
    deliveryToFf: parseStringNumber(payload.deliveryToFf) ?? 0,
    packagingMaterial: parseStringNumber(payload.packagingMaterial) ?? 0,
    fulfillment: parseStringNumber(payload.fulfillment) ?? 0,
    purchaseQtyTotal: parseStringNumber(payload.purchaseQtyTotal),
    marketingInternal: parseStringNumber(payload.marketingInternal) ?? 0,
    marketingExternal: parseStringNumber(payload.marketingExternal) ?? 0,
    contentCost: parseStringNumber(payload.contentCost) ?? 0,
    otherCosts: parseStringNumber(payload.otherCosts) ?? 0,
    selectedWarehouses: rawSelectedWarehouses,
    warehouseCosts,
  };
}

function computeDeliveryToWb(manualFields: ParsedManualFields) {
  const selectedCosts = manualFields.selectedWarehouses
    .map((warehouseId) => manualFields.warehouseCosts[warehouseId] ?? 0)
    .filter((value) => value > 0);

  if (selectedCosts.length === 0) {
    return 0;
  }

  return selectedCosts.reduce((sum, value) => sum + value, 0) / selectedCosts.length;
}

function resolveManualBatchDivisor(
  manualFields: ParsedManualFields,
  unitsSold: number,
) {
  const purchaseQtyTotal = manualFields.purchaseQtyTotal !== null && manualFields.purchaseQtyTotal > 0
    ? manualFields.purchaseQtyTotal
    : null;

  if (purchaseQtyTotal) {
    return {
      divisor: purchaseQtyTotal,
      mode: 'purchase_qty_total',
    } as const;
  }

  if (unitsSold > 0) {
    return {
      divisor: unitsSold,
      mode: 'sold_quantity_fallback',
    } as const;
  }

  return {
    divisor: null,
    mode: 'missing',
  } as const;
}

function buildFreshnessSource(
  lastAvailableAt: Date | string | null | undefined,
  comparedToTimestamp: number,
  staleToleranceMs: number,
  source: string,
  comparedTo: string,
): DataFreshnessSource {
  const iso = toIsoString(lastAvailableAt);
  if (!iso) {
    return {
      status: 'missing',
      lastAvailableAt: null,
      comparedTo,
      deltaHours: null,
      source,
    };
  }

  const timestamp = Date.parse(iso);
  const deltaMs = comparedToTimestamp - timestamp;
  const deltaHours = roundMoney(deltaMs / (60 * 60 * 1000));

  return {
    status: deltaMs <= staleToleranceMs ? 'fresh' : 'stale',
    lastAvailableAt: iso,
    comparedTo,
    deltaHours,
    source,
  };
}

function latestUsableSyncCoverageStatus(sync: LatestUsableSync | null, requestedTo: Date) {
  if (!sync?.dateTo) {
    return 'missing';
  }

  const coverageTo = Date.parse(sync.dateTo);
  if (!Number.isFinite(coverageTo)) {
    return 'stale';
  }

  return coverageTo >= requestedTo.getTime() ? 'fresh' : 'stale';
}

async function loadManualInputs(
  tenantId: string,
  nmIds: number[],
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const conditions = [eq(unitEconomicsManualInputs.tenantId, tenantId)];
    if (nmIds.length > 0) {
      conditions.push(inArray(unitEconomicsManualInputs.nmId, nmIds));
    }

    return tx.select({
      nmId: unitEconomicsManualInputs.nmId,
      manualFields: unitEconomicsManualInputs.manualFields,
      updatedAt: unitEconomicsManualInputs.updatedAt,
    })
      .from(unitEconomicsManualInputs)
      .where(and(...conditions));
  }) as Promise<ManualInputRow[]>;
}

async function loadCostAggregates(
  tenantId: string,
  from: Date,
  to: Date,
  nmIds: number[],
) {
  const fromIso = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())).toISOString();
  const toExclusiveIso = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1)).toISOString();

  const realizationNmFilter = andInFilter(sql`r.nm_id`, nmIds);
  const salesNmFilter = andInFilter(sql`s.nm_id`, nmIds);
  const adCostsNmFilter = andInFilter(sql`a.nm_id`, nmIds);
  const adClustersNmFilter = andInFilter(sql`a.nm_id`, nmIds);
  const stocksNmFilter = andInFilter(sql`st.nm_id`, nmIds);
  const storageNmFilter = andInFilter(sql`st.nm_id`, nmIds);

  const rows = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql<CostAggregateRow>`
    WITH reconciliation_cutoff AS (
      SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) AS cutoff
      FROM raw_api_realization_reports
      WHERE tenant_id = ${tenantId}
    ),
    realization_agg AS (
      SELECT
        r.nm_id AS "nmId",
        COALESCE(SUM(CASE
          WHEN COALESCE(r.retail_amount, 0) <> 0 OR COALESCE(r.ppvz_for_pay, 0) <> 0
            THEN r.quantity
          ELSE 0
        END), 0)::int AS "soldQuantity",
        COALESCE(SUM(r.retail_amount), 0)::numeric AS "grossRevenueTotal",
        COALESCE(SUM(r.commission_amount), 0)::numeric AS "commissionTotal",
        COALESCE(SUM(r.delivery_rub), 0)::numeric AS "wbLogisticsTotal",
        COALESCE(SUM(r.return_amount), 0)::numeric AS "returnsTotal",
        0::numeric AS "storageTotal",
        COALESCE(SUM(r.acceptance), 0)::numeric AS "acceptanceTotal",
        COALESCE(SUM(r.acquiring_fee), 0)::numeric AS "acquiringTotal",
        COALESCE(SUM(r.penalty_rub), 0)::numeric AS "penaltiesTotal",
        COALESCE(SUM(r.payment_schedule_rub + (${sql.raw(buildWbDeductionExpenseSql("r"))}) - COALESCE(r.additional_payment, 0)), 0)::numeric AS "otherTotal",
        MAX(COALESCE(r.sale_dt, r.date_to)) AS "latestSalesAt",
        false AS "usedProvisionalTail"
      FROM raw_api_realization_reports r
      LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
      WHERE r.tenant_id = ${tenantId}
        AND COALESCE(r.sale_dt, r.date_from) >= ${fromIso}::timestamp
        AND COALESCE(r.sale_dt, r.date_from) < ${toExclusiveIso}::timestamp
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${realizationNmFilter}
      GROUP BY r.nm_id
    ),
    provisional_sales_agg AS (
      SELECT
        s.nm_id AS "nmId",
        COUNT(*)::int AS "soldQuantity",
        COALESCE(SUM(s.price_with_discount), 0)::numeric AS "grossRevenueTotal",
        COALESCE(SUM(s.price_with_discount * 0.15), 0)::numeric AS "commissionTotal",
        COALESCE(SUM(50), 0)::numeric AS "wbLogisticsTotal",
        0::numeric AS "returnsTotal",
        0::numeric AS "storageTotal",
        0::numeric AS "acceptanceTotal",
        0::numeric AS "acquiringTotal",
        0::numeric AS "penaltiesTotal",
        0::numeric AS "otherTotal",
        MAX(s.date) AS "latestSalesAt",
        true AS "usedProvisionalTail"
      FROM raw_api_sales s
      CROSS JOIN reconciliation_cutoff rc
      LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
      WHERE s.tenant_id = ${tenantId}
        AND s.date > rc.cutoff
        AND s.date >= ${fromIso}::timestamp
        AND s.date < ${toExclusiveIso}::timestamp
        AND s.is_storno = false
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${salesNmFilter}
      GROUP BY s.nm_id
    ),
    sales_union AS (
      SELECT * FROM realization_agg
      UNION ALL
      SELECT * FROM provisional_sales_agg
    ),
    sales_agg AS (
      SELECT
        "nmId",
        COALESCE(SUM("soldQuantity"), 0)::int AS "soldQuantity",
        COALESCE(SUM("grossRevenueTotal"), 0)::numeric AS "grossRevenueTotal",
        COALESCE(SUM("commissionTotal"), 0)::numeric AS "commissionTotal",
        COALESCE(SUM("wbLogisticsTotal"), 0)::numeric AS "wbLogisticsTotal",
        COALESCE(SUM("returnsTotal"), 0)::numeric AS "returnsTotal",
        COALESCE(SUM("storageTotal"), 0)::numeric AS "storageTotal",
        COALESCE(SUM("acceptanceTotal"), 0)::numeric AS "acceptanceTotal",
        COALESCE(SUM("acquiringTotal"), 0)::numeric AS "acquiringTotal",
        COALESCE(SUM("penaltiesTotal"), 0)::numeric AS "penaltiesTotal",
        COALESCE(SUM("otherTotal"), 0)::numeric AS "otherTotal",
        MAX("latestSalesAt") AS "latestSalesAt",
        BOOL_OR("usedProvisionalTail") AS "usedProvisionalTail"
      FROM sales_union
      GROUP BY "nmId"
    ),
    storage_agg AS (
      SELECT
        st.nm_id AS "nmId",
        COALESCE(SUM(st.storage_amount), 0)::numeric AS "storageTotal",
        MAX(st.date) AS "latestStorageAt"
      FROM raw_api_paid_storage st
      LEFT JOIN products p ON p.tenant_id = st.tenant_id AND p.nm_id = st.nm_id
      WHERE st.tenant_id = ${tenantId}
        AND st.date >= ${fromIso}::timestamp
        AND st.date < ${toExclusiveIso}::timestamp
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${storageNmFilter}
      GROUP BY st.nm_id
    ),
    ad_costs AS (
      SELECT
        a.nm_id AS "nmId",
        COALESCE(SUM(a.amount), 0)::numeric AS "advertisingTotal",
        MAX(a.date) AS "latestAdvertisingAt"
      FROM raw_api_ad_costs a
      LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${fromIso}::timestamp
        AND a.date < ${toExclusiveIso}::timestamp
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${adCostsNmFilter}
      GROUP BY a.nm_id
    ),
    ad_clusters AS (
      SELECT
        a.nm_id AS "nmId",
        COALESCE(SUM(a.amount), 0)::numeric AS "advertisingTotal",
        MAX(a.date) AS "latestAdvertisingAt"
      FROM raw_api_ad_clusters a
      LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${fromIso}::timestamp
        AND a.date < ${toExclusiveIso}::timestamp
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${adClustersNmFilter}
      GROUP BY a.nm_id
    ),
    ad_agg AS (
      SELECT
        COALESCE(c."nmId", cl."nmId") AS "nmId",
        CASE
          WHEN c."nmId" IS NOT NULL THEN COALESCE(c."advertisingTotal", 0)
          ELSE COALESCE(cl."advertisingTotal", 0)
        END::numeric AS "advertisingTotal",
        CASE
          WHEN c."nmId" IS NOT NULL THEN 'raw_api_ad_costs'
          WHEN cl."nmId" IS NOT NULL THEN 'raw_api_ad_clusters'
          ELSE NULL
        END::text AS "adSource",
        CASE
          WHEN c."nmId" IS NOT NULL THEN c."latestAdvertisingAt"
          ELSE cl."latestAdvertisingAt"
        END AS "latestAdvertisingAt"
      FROM ad_costs c
      FULL OUTER JOIN ad_clusters cl ON cl."nmId" = c."nmId"
    ),
    stock_agg AS (
      SELECT
        st.nm_id AS "nmId",
        MAX(st.date) AS "latestStockAt"
      FROM raw_api_stocks st
      LEFT JOIN products p ON p.tenant_id = st.tenant_id AND p.nm_id = st.nm_id
      WHERE st.tenant_id = ${tenantId}
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${stocksNmFilter}
      GROUP BY st.nm_id
    ),
    sku_pool AS (
      SELECT "nmId" FROM sales_agg
      UNION
      SELECT "nmId" FROM ad_agg
      UNION
      SELECT "nmId" FROM storage_agg
      UNION
      SELECT "nmId" FROM stock_agg
    )
    SELECT
      s."nmId",
      COALESCE(sa."soldQuantity", 0)::int AS "soldQuantity",
      COALESCE(sa."grossRevenueTotal", 0)::numeric AS "grossRevenueTotal",
      COALESCE(sa."commissionTotal", 0)::numeric AS "commissionTotal",
      COALESCE(sa."wbLogisticsTotal", 0)::numeric AS "wbLogisticsTotal",
      COALESCE(sa."returnsTotal", 0)::numeric AS "returnsTotal",
      COALESCE(sto."storageTotal", 0)::numeric AS "storageTotal",
      COALESCE(sa."acceptanceTotal", 0)::numeric AS "acceptanceTotal",
      COALESCE(sa."acquiringTotal", 0)::numeric AS "acquiringTotal",
      COALESCE(sa."penaltiesTotal", 0)::numeric AS "penaltiesTotal",
      COALESCE(sa."otherTotal", 0)::numeric AS "otherTotal",
      COALESCE(ad."advertisingTotal", 0)::numeric AS "advertisingTotal",
      ad."adSource" AS "adSource",
      sa."latestSalesAt" AS "latestSalesAt",
      ad."latestAdvertisingAt" AS "latestAdvertisingAt",
      sto."latestStorageAt" AS "latestStorageAt",
      st."latestStockAt" AS "latestStockAt",
      COALESCE(sa."usedProvisionalTail", false) AS "usedProvisionalTail"
    FROM sku_pool s
    LEFT JOIN sales_agg sa ON sa."nmId" = s."nmId"
    LEFT JOIN ad_agg ad ON ad."nmId" = s."nmId"
    LEFT JOIN storage_agg sto ON sto."nmId" = s."nmId"
    LEFT JOIN stock_agg st ON st."nmId" = s."nmId"
  `));

  return rows as unknown as CostAggregateRow[];
}

async function loadFreshnessAggregates(
  tenantId: string,
  nmIds: number[],
) {
  const realizationNmFilter = andInFilter(sql`r.nm_id`, nmIds);
  const salesNmFilter = andInFilter(sql`s.nm_id`, nmIds);
  const adCostsNmFilter = andInFilter(sql`a.nm_id`, nmIds);
  const adClustersNmFilter = andInFilter(sql`a.nm_id`, nmIds);
  const stocksNmFilter = andInFilter(sql`st.nm_id`, nmIds);
  const storageNmFilter = andInFilter(sql`ps.nm_id`, nmIds);
  const costNmFilter = andInFilter(sql`c.nm_id`, nmIds);
  const manualNmFilter = andInFilter(sql`mi.nm_id`, nmIds);

  const rows = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql<FreshnessAggregateRow>`
    SELECT
      (
        SELECT MAX(r.date_to)
        FROM raw_api_realization_reports r
        WHERE r.tenant_id = ${tenantId}
        ${realizationNmFilter}
      ) AS "realizationMaxAt",
      (
        SELECT MAX(s.date)
        FROM raw_api_sales s
        WHERE s.tenant_id = ${tenantId}
          AND s.is_storno = false
        ${salesNmFilter}
      ) AS "provisionalSalesMaxAt",
      (
        SELECT MAX(a.date)
        FROM raw_api_ad_costs a
        WHERE a.tenant_id = ${tenantId}
        ${adCostsNmFilter}
      ) AS "adCostsMaxAt",
      (
        SELECT MAX(a.date)
        FROM raw_api_ad_clusters a
        WHERE a.tenant_id = ${tenantId}
        ${adClustersNmFilter}
      ) AS "adClustersMaxAt",
      (
        SELECT MAX(ps.date)
        FROM raw_api_paid_storage ps
        WHERE ps.tenant_id = ${tenantId}
        ${storageNmFilter}
      ) AS "paidStorageMaxAt",
      (
        SELECT MAX(st.date)
        FROM raw_api_stocks st
        WHERE st.tenant_id = ${tenantId}
        ${stocksNmFilter}
      ) AS "stocksMaxAt",
      (
        SELECT MAX(c.effective_from)
        FROM unit_economics_configs c
        WHERE c.tenant_id = ${tenantId}
        ${costNmFilter}
      ) AS "costConfigMaxAt",
      (
        SELECT MAX(mi.updated_at)
        FROM unit_economics_manual_inputs mi
        WHERE mi.tenant_id = ${tenantId}
        ${manualNmFilter}
      ) AS "manualInputsMaxAt"
  `));

  return (rows[0] ?? null) as FreshnessAggregateRow | null;
}

async function loadLatestUsableSync(tenantId: string) {
  const rows = await withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      id: syncRuns.id,
      status: syncRuns.status,
      requestedAt: syncRuns.requestedAt,
      finishedAt: syncRuns.finishedAt,
      dateFrom: syncRuns.dateFrom,
      dateTo: syncRuns.dateTo,
      errorMessage: syncRuns.errorMessage,
    })
      .from(syncRuns)
      .where(and(
        eq(syncRuns.tenantId, tenantId),
        inArray(syncRuns.status, ['completed', 'completed_with_errors']),
      ))
      .orderBy(desc(syncRuns.finishedAt), desc(syncRuns.requestedAt))
      .limit(1),
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: row.status,
    requestedAt: toIsoString(row.requestedAt),
    finishedAt: toIsoString(row.finishedAt),
    dateFrom: toIsoString(row.dateFrom),
    dateTo: toIsoString(row.dateTo),
    errorMessage: row.errorMessage ?? null,
  } satisfies LatestUsableSync;
}

function buildComponentSources(
  manualFields: ParsedManualFields,
  catalogRow: ProductOptionRow,
  usedProvisionalTail: boolean,
  adSource: string | null,
) {
  const purchaseSource = manualFields.costPrice !== null && manualFields.costPrice > 0
    ? 'unit_economics_manual_inputs.manualFields.costPrice'
    : catalogRow.costPrice !== null
      ? 'unit_economics_configs.cost_price'
      : 'missing';

  const deliveryToWbSource = manualFields.selectedWarehouses.length > 0
    ? 'unit_economics_manual_inputs.manualFields.warehouseCosts'
    : 'missing';

  const advertisingSources = [
    adSource === 'raw_api_ad_costs'
      ? 'raw_api_ad_costs.amount'
      : adSource === 'raw_api_ad_clusters'
        ? 'raw_api_ad_clusters.amount'
        : null,
    manualFields.marketingInternal > 0 ? 'unit_economics_manual_inputs.manualFields.marketingInternal' : null,
    manualFields.marketingExternal > 0 ? 'unit_economics_manual_inputs.manualFields.marketingExternal' : null,
  ].filter(Boolean);

  const otherSources = [
    'raw_api_realization_reports.payment_schedule_rub + deduction(без тела кредита) - additional_payment',
    manualFields.contentCost > 0 ? 'unit_economics_manual_inputs.manualFields.contentCost' : null,
    manualFields.otherCosts > 0 ? 'unit_economics_manual_inputs.manualFields.otherCosts' : null,
  ].filter(Boolean);

  return {
    purchase: purchaseSource,
    deliveryFromChina: manualFields.deliveryToFf > 0 ? 'unit_economics_manual_inputs.manualFields.deliveryToFf' : 'missing',
    packaging: manualFields.packagingMaterial > 0 ? 'unit_economics_manual_inputs.manualFields.packagingMaterial' : 'missing',
    fulfillment: manualFields.fulfillment > 0 ? 'unit_economics_manual_inputs.manualFields.fulfillment' : 'missing',
    deliveryToWb: deliveryToWbSource,
    wbLogistics: usedProvisionalTail
      ? 'raw_api_realization_reports.delivery_rub + raw_api_sales fallback 50 ₽/sale'
      : 'raw_api_realization_reports.delivery_rub',
    returns: 'raw_api_realization_reports.return_amount',
    storage: 'raw_api_paid_storage.storage_amount',
    acceptance: 'raw_api_realization_reports.acceptance',
    commission: usedProvisionalTail
      ? 'raw_api_realization_reports.commission_amount + raw_api_sales fallback 15%'
      : 'raw_api_realization_reports.commission_amount',
    acquiring: 'raw_api_realization_reports.acquiring_fee',
    advertising: advertisingSources.length > 0 ? advertisingSources.join(' + ') : 'missing',
    penalties: 'raw_api_realization_reports.penalty_rub',
    other: otherSources.join(' + '),
  } satisfies Record<ComponentKey, string>;
}

function buildWarnings(
  input: {
    unitsSold: number;
    purchasePrice: number | null;
    manualFields: ParsedManualFields;
    manualBatchDivisorMode: 'purchase_qty_total' | 'sold_quantity_fallback' | 'missing';
    usedProvisionalTail: boolean;
    adSource: string | null;
    adTotal: number;
    isArchived: boolean;
    includeInactive: boolean;
  },
) {
  const warnings: string[] = [];

  if (input.unitsSold <= 0) {
    warnings.push('Нет продаж за период: WB-компоненты на единицу обнулены, total отражает только закупку и отгрузку.');
  }

  if (input.purchasePrice === null || input.purchasePrice <= 0) {
    warnings.push('Закупочная цена не заполнена: компонент purchase принят равным 0.');
  }

  if (input.manualFields.selectedWarehouses.length === 0) {
    warnings.push('Не выбраны склады для отгрузки: deliveryToWb рассчитан как 0.');
  }

  if (input.usedProvisionalTail) {
    warnings.push('В период попал provisional tail: часть продаж рассчитана по raw_api_sales с fallback 15% комиссии и 50 ₽ логистики на продажу.');
  }

  if (
    (input.manualFields.marketingInternal > 0
      || input.manualFields.marketingExternal > 0
      || input.manualFields.contentCost > 0
      || input.manualFields.otherCosts > 0)
    && input.manualBatchDivisorMode === 'sold_quantity_fallback'
  ) {
    warnings.push('Часть batch-расходов из manual fields распределена по soldQuantity, потому что purchaseQtyTotal не заполнен.');
  }

  if (
    (input.manualFields.marketingInternal > 0
      || input.manualFields.marketingExternal > 0
      || input.manualFields.contentCost > 0
      || input.manualFields.otherCosts > 0)
    && input.manualBatchDivisorMode === 'missing'
  ) {
    warnings.push('Есть batch-расходы в manual fields, но нет purchaseQtyTotal и продаж за период: advertising/other по ним не распределены.');
  }

  if (input.adSource === 'raw_api_ad_clusters') {
    warnings.push('Реклама взята из raw_api_ad_clusters, потому что raw_api_ad_costs за период пусты.');
  }

  if (input.adTotal > 0 && input.unitsSold <= 0) {
    warnings.push('Есть рекламные расходы без продаж: advertising на единицу не распределён.');
  }

  if (input.isArchived && input.includeInactive) {
    warnings.push('SKU сейчас помечен как archived, но включён в отчёт по флагу includeInactive.');
  }

  return warnings;
}

export async function buildTenantCostBreakdownDetail(
  options: BuildCostBreakdownDetailOptions,
): Promise<CostBreakdownTenantResult> {
  const requestedNmIds = Array.isArray(options.nmIds)
    ? Array.from(new Set(options.nmIds.filter((value) => Number.isFinite(value) && value > 0).map((value) => Math.trunc(value))))
    : [];

  const [catalogRows, aggregateRows, manualInputRows, freshnessRow, latestUsableSync] = await Promise.all([
    listObservedProductOptions(options.tenantId),
    loadCostAggregates(options.tenantId, options.from, options.to, requestedNmIds),
    loadManualInputs(options.tenantId, requestedNmIds),
    loadFreshnessAggregates(options.tenantId, requestedNmIds),
    loadLatestUsableSync(options.tenantId),
  ]);

  const aggregateByNmId = new Map(aggregateRows.map((row) => [Number(row.nmId), row]));
  const manualByNmId = new Map(
    manualInputRows.map((row) => [Number(row.nmId), { manualFields: parseManualFields(row.manualFields), updatedAt: row.updatedAt }]),
  );

  const candidateNmIds = requestedNmIds.length > 0
    ? requestedNmIds
    : Array.from(new Set([
        ...catalogRows.map((row) => row.nmId),
        ...aggregateRows.map((row) => Number(row.nmId)),
      ]));

  const catalogByNmId = new Map(catalogRows.map((row) => [row.nmId, row]));

  const items: CostBreakdownDetailItem[] = [];

  for (const nmId of candidateNmIds) {
    const catalogRow = catalogByNmId.get(nmId);
    const aggregate = aggregateByNmId.get(nmId);
    const manual = manualByNmId.get(nmId) ?? {
      manualFields: parseManualFields(null),
      updatedAt: null,
    };

    if (!catalogRow && !aggregate) {
      continue;
    }

    const unitsSold = toNumber(aggregate?.soldQuantity);
    if (!options.includeZeroSales && unitsSold <= 0) {
      continue;
    }

    const isArchived = catalogRow?.isArchived ?? false;
    if (!options.includeInactive && isArchived && unitsSold <= 0) {
      continue;
    }

    const purchasePrice = manual.manualFields.costPrice && manual.manualFields.costPrice > 0
      ? roundMoney(manual.manualFields.costPrice)
      : catalogRow?.costPrice !== null && catalogRow?.costPrice !== undefined
        ? roundMoney(catalogRow.costPrice)
        : null;

    const deliveryFromChina = roundMoney(manual.manualFields.deliveryToFf);
    const packaging = roundMoney(manual.manualFields.packagingMaterial);
    const fulfillment = roundMoney(manual.manualFields.fulfillment);
    const deliveryToWb = roundMoney(computeDeliveryToWb(manual.manualFields));
    const grossRevenue = roundMoney(toNumber(aggregate?.grossRevenueTotal));

    const divisor = unitsSold > 0 ? unitsSold : 1;
    const manualBatchDivisor = resolveManualBatchDivisor(manual.manualFields, unitsSold);
    const manualAdvertising = manualBatchDivisor.divisor && manualBatchDivisor.divisor > 0
      ? roundMoney((manual.manualFields.marketingInternal + manual.manualFields.marketingExternal) / manualBatchDivisor.divisor)
      : 0;
    const manualOther = manualBatchDivisor.divisor && manualBatchDivisor.divisor > 0
      ? roundMoney((manual.manualFields.contentCost + manual.manualFields.otherCosts) / manualBatchDivisor.divisor)
      : 0;
    const advertisingTotal = toNumber(aggregate?.advertisingTotal);
    const components = {
      purchase: roundMoney(purchasePrice ?? 0),
      deliveryFromChina,
      packaging,
      fulfillment,
      deliveryToWb,
      wbLogistics: unitsSold > 0 ? roundMoney(toNumber(aggregate?.wbLogisticsTotal) / divisor) : 0,
      returns: unitsSold > 0 ? roundMoney(toNumber(aggregate?.returnsTotal) / divisor) : 0,
      storage: unitsSold > 0 ? roundMoney(toNumber(aggregate?.storageTotal) / divisor) : 0,
      acceptance: unitsSold > 0 ? roundMoney(toNumber(aggregate?.acceptanceTotal) / divisor) : 0,
      commission: unitsSold > 0 ? roundMoney(toNumber(aggregate?.commissionTotal) / divisor) : 0,
      acquiring: unitsSold > 0 ? roundMoney(toNumber(aggregate?.acquiringTotal) / divisor) : 0,
      advertising: roundMoney((unitsSold > 0 ? advertisingTotal / divisor : 0) + manualAdvertising),
      penalties: unitsSold > 0 ? roundMoney(toNumber(aggregate?.penaltiesTotal) / divisor) : 0,
      other: roundMoney((unitsSold > 0 ? toNumber(aggregate?.otherTotal) / divisor : 0) + manualOther),
    } satisfies Record<ComponentKey, number>;

    const componentsTotal = roundMoney(Object.values(components).reduce((sum, value) => sum + value, 0));
    const updatedAt = pickLatestIso(
      catalogRow?.costPriceUpdatedAt,
      manual.updatedAt,
      aggregate?.latestSalesAt,
      aggregate?.latestAdvertisingAt,
      aggregate?.latestStorageAt,
      aggregate?.latestStockAt,
    );

    items.push({
      tenantId: options.tenantId,
      tenantName: options.tenantName,
      nmId,
      vendorCode: catalogRow?.vendorCode ?? `WB ${nmId}`,
      name: catalogRow?.title?.trim() || catalogRow?.vendorCode || `WB ${nmId}`,
      sales: {
        unitsSold,
        grossRevenue,
      },
      unitsSold,
      purchasePrice,
      fullCostPerUnit: componentsTotal,
      components,
      componentsTotal,
      sources: buildComponentSources(
        manual.manualFields,
        catalogRow ?? {
          nmId,
          vendorCode: `WB ${nmId}`,
          photoUrl: null,
          title: null,
          photosCount: null,
          hasVideo: null,
          currentPrice: null,
          currentDiscount: null,
          currentSpp: null,
          currentStock: null,
          activeWarehouses: null,
          currentInWayToClient: null,
          currentInWayFromClient: null,
          costPrice: null,
          costPriceUpdatedAt: null,
          isArchived: false,
          isObservedOnly: true,
        },
        Boolean(aggregate?.usedProvisionalTail),
        aggregate?.adSource ?? null,
      ),
      updatedAt,
      warnings: buildWarnings({
        unitsSold,
        purchasePrice,
        manualFields: manual.manualFields,
        manualBatchDivisorMode: manualBatchDivisor.mode,
        usedProvisionalTail: Boolean(aggregate?.usedProvisionalTail),
        adSource: aggregate?.adSource ?? null,
        adTotal: advertisingTotal,
        isArchived,
        includeInactive: Boolean(options.includeInactive),
      }),
      isArchived,
      isObservedOnly: catalogRow?.isObservedOnly ?? false,
    });
  }

  items.sort((left, right) =>
    left.tenantName.localeCompare(right.tenantName, 'ru', { sensitivity: 'base' })
    || left.vendorCode.localeCompare(right.vendorCode, 'ru', { sensitivity: 'base' })
    || left.nmId - right.nmId,
  );

  const freshness = freshnessRow ?? {
    realizationMaxAt: null,
    provisionalSalesMaxAt: null,
    adCostsMaxAt: null,
    adClustersMaxAt: null,
    paidStorageMaxAt: null,
    stocksMaxAt: null,
    costConfigMaxAt: null,
    manualInputsMaxAt: null,
  };

  const latestSalesAt = pickLatestIso(freshness.realizationMaxAt, freshness.provisionalSalesMaxAt);
  const latestAdvertisingAt = pickLatestIso(freshness.adCostsMaxAt, freshness.adClustersMaxAt);
  const latestStorageAt = pickLatestIso(freshness.paidStorageMaxAt);
  const latestCostsAt = pickLatestIso(freshness.costConfigMaxAt, freshness.manualInputsMaxAt);
  const requestedToTimestamp = options.to.getTime();
  const nowTimestamp = Date.now();

  return {
    items,
    dataFreshness: {
      tenantId: options.tenantId,
      tenantName: options.tenantName,
      latestUsableSync,
      latestUsableSyncCoverage: latestUsableSyncCoverageStatus(latestUsableSync, options.to),
      latestUsableSyncCoverageComparedTo: options.to.toISOString(),
      sales: buildFreshnessSource(
        latestSalesAt,
        requestedToTimestamp,
        SALES_STALE_TOLERANCE_MS,
        latestUsableSync?.status === 'completed_with_errors'
          ? 'raw_api_realization_reports + raw_api_sales, latest usable sync completed_with_errors'
          : 'raw_api_realization_reports + raw_api_sales',
        'requested_to',
      ),
      advertising: buildFreshnessSource(
        latestAdvertisingAt,
        requestedToTimestamp,
        SALES_STALE_TOLERANCE_MS,
        freshness.adCostsMaxAt
          ? 'raw_api_ad_costs'
          : freshness.adClustersMaxAt
            ? 'raw_api_ad_clusters'
            : 'missing',
        'requested_to',
      ),
      storage: buildFreshnessSource(
        latestStorageAt,
        requestedToTimestamp,
        SALES_STALE_TOLERANCE_MS,
        'raw_api_paid_storage',
        'requested_to',
      ),
      stocks: buildFreshnessSource(
        freshness.stocksMaxAt,
        nowTimestamp,
        STOCKS_STALE_TOLERANCE_MS,
        'raw_api_stocks',
        'now',
      ),
      costs: buildFreshnessSource(
        latestCostsAt,
        nowTimestamp,
        COSTS_STALE_TOLERANCE_MS,
        freshness.manualInputsMaxAt
          ? 'unit_economics_manual_inputs + unit_economics_configs'
          : 'unit_economics_configs',
        'now',
      ),
    },
  };
}

export function summarizeFreshnessCoverage(
  freshness: CostBreakdownDataFreshness[],
  requestedTo: Date,
) {
  return freshness.map((item) => ({
    tenantId: item.tenantId,
    tenantName: item.tenantName,
    latestUsableSyncStatus: item.latestUsableSync?.status ?? 'missing',
    latestUsableSyncAt: item.latestUsableSync?.finishedAt ?? item.latestUsableSync?.requestedAt ?? null,
    latestUsableSyncCoverage: latestUsableSyncCoverageStatus(item.latestUsableSync, requestedTo),
    latestUsableSyncCoverageComparedTo: requestedTo.toISOString(),
    sales: item.sales,
    advertising: item.advertising,
    storage: item.storage,
    stocks: item.stocks,
    costs: item.costs,
  }));
}
