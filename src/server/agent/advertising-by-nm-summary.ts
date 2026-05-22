import { sql, type SQL } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { listObservedProductOptions } from '@/server/catalog/observed-products';

type AdvertisingByNmRow = {
  nmId: number;
  adSpend: number | string | null;
  rawCostSpend: number | string | null;
  clusterSpend: number | string | null;
  ordersCount: number | string | null;
  ordersSumRub: number | string | null;
  campaignIdsJson: unknown;
  spendSource: string | null;
};

export type AdvertisingByNmSummaryItem = {
  nmId: number;
  vendorCode: string | null;
  title: string;
  adSpend: number;
  rawCostSpend: number;
  clusterSpend: number;
  spendSource: string;
  ordersCount: number;
  ordersSumRub: number;
  drrPct: number;
  campaignIds: number[];
};

export type AdvertisingByNmSummaryTotals = {
  adSpend: number;
  rawCostSpend: number;
  clusterSpend: number;
  campaignCount: number;
  nmCount: number;
  spendSource: 'raw_api_ad_costs' | 'raw_api_ad_clusters' | 'mixed' | 'none';
};

export type BuildAdvertisingByNmSummaryOptions = {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  nmIds?: number[];
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMetric(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

function normalizeNmIds(nmIds: number[] | undefined) {
  return Array.isArray(nmIds)
    ? Array.from(new Set(
        nmIds
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.trunc(value)),
      ))
    : [];
}

function inListSql(values: number[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

function andInFilter(column: SQL, values: number[]) {
  return values.length > 0 ? sql`AND ${column} IN (${inListSql(values)})` : sql``;
}

function parseCampaignIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.trunc(entry));
}

async function loadAdvertisingRows(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  nmIds: number[],
) {
  const nmFilter = andInFilter(sql`a.nm_id`, nmIds);
  const clusterNmFilter = andInFilter(sql`c.nm_id`, nmIds);
  const ordersNmFilter = andInFilter(sql`o.nm_id`, nmIds);

  const rows = await withTenantContext(db, tenantId, async (tx) => tx.execute<AdvertisingByNmRow>(sql`
    WITH ad_agg AS (
      SELECT
        a.nm_id AS "nmId",
        COALESCE(SUM(a.amount), 0)::numeric AS "adSpend",
        COALESCE(
          json_agg(
            DISTINCT CASE
              WHEN a.placement LIKE 'campaign:%'
                THEN REPLACE(a.placement, 'campaign:', '')::bigint
              ELSE NULL
            END
          ) FILTER (WHERE a.placement LIKE 'campaign:%'),
          '[]'::json
        ) AS "campaignIdsJson"
      FROM raw_api_ad_costs a
      WHERE a.tenant_id = ${tenantId}
        AND a.date::date >= ${dateFrom}::date
        AND a.date::date <= ${dateTo}::date
        ${nmFilter}
      GROUP BY a.nm_id
    ),
    cluster_agg AS (
      SELECT
        c.nm_id AS "nmId",
        COALESCE(SUM(c.amount), 0)::numeric AS "clusterSpend"
      FROM raw_api_ad_clusters c
      WHERE c.tenant_id = ${tenantId}
        AND c.date::date >= ${dateFrom}::date
        AND c.date::date <= ${dateTo}::date
        ${clusterNmFilter}
      GROUP BY c.nm_id
    ),
    order_agg AS (
      SELECT
        o.nm_id AS "nmId",
        COUNT(*)::int AS "ordersCount",
        COALESCE(SUM(o.total_price), 0)::numeric AS "ordersSumRub"
      FROM raw_api_orders o
      WHERE o.tenant_id = ${tenantId}
        AND o.is_cancel = FALSE
        AND o.date::date >= ${dateFrom}::date
        AND o.date::date <= ${dateTo}::date
        ${ordersNmFilter}
      GROUP BY o.nm_id
    )
    SELECT
      COALESCE(a."nmId", c."nmId") AS "nmId",
      CASE
        WHEN COALESCE(c."clusterSpend", 0) > COALESCE(a."adSpend", 0) * 1.05
          THEN COALESCE(c."clusterSpend", 0)
        ELSE COALESCE(a."adSpend", 0)
      END AS "adSpend",
      COALESCE(a."adSpend", 0) AS "rawCostSpend",
      COALESCE(c."clusterSpend", 0) AS "clusterSpend",
      COALESCE(o."ordersCount", 0) AS "ordersCount",
      COALESCE(o."ordersSumRub", 0) AS "ordersSumRub",
      COALESCE(a."campaignIdsJson", '[]'::json) AS "campaignIdsJson",
      CASE
        WHEN COALESCE(c."clusterSpend", 0) > COALESCE(a."adSpend", 0) * 1.05
          THEN 'raw_api_ad_clusters'
        WHEN COALESCE(a."adSpend", 0) > 0
          THEN 'raw_api_ad_costs'
        ELSE 'none'
      END AS "spendSource"
    FROM ad_agg a
    FULL OUTER JOIN cluster_agg c
      ON c."nmId" = a."nmId"
    LEFT JOIN order_agg o
      ON o."nmId" = COALESCE(a."nmId", c."nmId")
    ORDER BY "adSpend" DESC, o."ordersCount" DESC NULLS LAST, "nmId" ASC
  `));

  return rows as unknown as AdvertisingByNmRow[];
}

export async function buildAdvertisingByNmSummary(
  options: BuildAdvertisingByNmSummaryOptions,
) {
  const nmIds = normalizeNmIds(options.nmIds);
  const [catalogRows, aggregateRows] = await Promise.all([
    listObservedProductOptions(options.tenantId),
    loadAdvertisingRows(options.tenantId, options.dateFrom, options.dateTo, nmIds),
  ]);

  const catalogByNmId = new Map(catalogRows.map((row) => [row.nmId, row]));

  const items = aggregateRows.map((row) => {
    const nmId = Number(row.nmId);
    const adSpend = roundMetric(toNumber(row.adSpend));
    const rawCostSpend = roundMetric(toNumber(row.rawCostSpend));
    const clusterSpend = roundMetric(toNumber(row.clusterSpend));
    const ordersCount = Math.max(0, Math.round(toNumber(row.ordersCount)));
    const ordersSumRub = roundMetric(toNumber(row.ordersSumRub));
    const catalogRow = catalogByNmId.get(nmId);

    return {
      nmId,
      vendorCode: catalogRow?.vendorCode ?? null,
      title: catalogRow?.title?.trim() || catalogRow?.vendorCode || `WB ${nmId}`,
      adSpend,
      rawCostSpend,
      clusterSpend,
      spendSource: row.spendSource ?? 'none',
      ordersCount,
      ordersSumRub,
      drrPct: ordersSumRub > 0 ? roundMetric((adSpend / ordersSumRub) * 100) : 0,
      campaignIds: parseCampaignIds(row.campaignIdsJson),
    } satisfies AdvertisingByNmSummaryItem;
  });

  const campaignIdSet = new Set<number>();
  for (const item of items) {
    for (const campaignId of item.campaignIds) {
      campaignIdSet.add(campaignId);
    }
  }
  const totals: AdvertisingByNmSummaryTotals = {
    adSpend: roundMetric(items.reduce((sum, item) => sum + item.adSpend, 0)),
    rawCostSpend: roundMetric(items.reduce((sum, item) => sum + item.rawCostSpend, 0)),
    clusterSpend: roundMetric(items.reduce((sum, item) => sum + item.clusterSpend, 0)),
    campaignCount: campaignIdSet.size,
    nmCount: items.length,
    spendSource: items.length === 0
      ? 'none'
      : items.every((item) => item.spendSource === 'raw_api_ad_costs')
        ? 'raw_api_ad_costs'
        : items.every((item) => item.spendSource === 'raw_api_ad_clusters')
          ? 'raw_api_ad_clusters'
          : 'mixed',
  };

  return {
    totals,
    items,
  };
}
