import { sql, type SQL } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { listObservedProductOptions } from '@/server/catalog/observed-products';

type FunnelAggregateRow = {
  nmId: number;
  openCardCount: number | string | null;
  addToCartCount: number | string | null;
  ordersCount: number | string | null;
  ordersSumRub: number | string | null;
  buyoutsCount: number | string | null;
  buyoutsSumRub: number | string | null;
};

export type SalesFunnelSummaryItem = {
  nmId: number;
  vendorCode: string | null;
  title: string;
  openCardCount: number;
  addToCartCount: number;
  ordersCount: number;
  ordersSumRub: number;
  buyoutsCount: number;
  buyoutsSumRub: number;
  cartConversionPct: number;
  orderConversionPct: number;
  buyoutPct: number;
};

export type SalesFunnelSummaryTotals = {
  openCardCount: number;
  addToCartCount: number;
  ordersCount: number;
  ordersSumRub: number;
  buyoutsCount: number;
  buyoutsSumRub: number;
  cartConversionPct: number;
  orderConversionPct: number;
  buyoutPct: number;
};

export type BuildSalesFunnelSummaryOptions = {
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

function computePct(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return roundMetric((numerator / denominator) * 100);
}

function inListSql(values: number[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

function andInFilter(column: SQL, values: number[]) {
  return values.length > 0 ? sql`AND ${column} IN (${inListSql(values)})` : sql``;
}

async function loadFunnelAggregateRows(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  nmIds: number[],
) {
  const nmFilter = andInFilter(sql`f.nm_id`, nmIds);

  const rows = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql<FunnelAggregateRow>`
    SELECT
      f.nm_id AS "nmId",
      COALESCE(SUM(f.open_card_count), 0)::int AS "openCardCount",
      COALESCE(SUM(f.add_to_cart_count), 0)::int AS "addToCartCount",
      COALESCE(SUM(f.order_count), 0)::int AS "ordersCount",
      COALESCE(SUM(f.order_sum), 0)::numeric AS "ordersSumRub",
      COALESCE(SUM(f.buyout_count), 0)::int AS "buyoutsCount",
      COALESCE(SUM(f.buyout_sum), 0)::numeric AS "buyoutsSumRub"
    FROM raw_api_funnel_stats f
    LEFT JOIN products p
      ON p.tenant_id = f.tenant_id
     AND p.nm_id = f.nm_id
    WHERE f.tenant_id = ${tenantId}
      AND f.period_start::date = f.period_end::date
      AND f.period_start::date >= ${dateFrom}::date
      AND f.period_start::date <= ${dateTo}::date
      AND COALESCE(p.is_hidden, FALSE) = FALSE
      ${nmFilter}
    GROUP BY f.nm_id
    ORDER BY "ordersCount" DESC, "buyoutsCount" DESC, "nmId" ASC
  `));

  return rows as unknown as FunnelAggregateRow[];
}

export async function buildSalesFunnelSummary(
  options: BuildSalesFunnelSummaryOptions,
) {
  const nmIds = Array.isArray(options.nmIds)
    ? Array.from(new Set(
        options.nmIds
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.trunc(value)),
      ))
    : [];

  const [catalogRows, aggregateRows] = await Promise.all([
    listObservedProductOptions(options.tenantId),
    loadFunnelAggregateRows(options.tenantId, options.dateFrom, options.dateTo, nmIds),
  ]);

  const catalogByNmId = new Map(catalogRows.map((row) => [row.nmId, row]));

  const items = aggregateRows.map((row) => {
    const openCardCount = Math.round(toNumber(row.openCardCount));
    const addToCartCount = Math.round(toNumber(row.addToCartCount));
    const ordersCount = Math.round(toNumber(row.ordersCount));
    const ordersSumRub = roundMetric(toNumber(row.ordersSumRub));
    const buyoutsCount = Math.round(toNumber(row.buyoutsCount));
    const buyoutsSumRub = roundMetric(toNumber(row.buyoutsSumRub));
    const catalogRow = catalogByNmId.get(Number(row.nmId));

    return {
      nmId: Number(row.nmId),
      vendorCode: catalogRow?.vendorCode ?? null,
      title: catalogRow?.title?.trim() || catalogRow?.vendorCode || `WB ${row.nmId}`,
      openCardCount,
      addToCartCount,
      ordersCount,
      ordersSumRub,
      buyoutsCount,
      buyoutsSumRub,
      cartConversionPct: computePct(addToCartCount, openCardCount),
      orderConversionPct: computePct(ordersCount, addToCartCount),
      buyoutPct: computePct(buyoutsCount, ordersCount),
    } satisfies SalesFunnelSummaryItem;
  });

  const totals = items.reduce<SalesFunnelSummaryTotals>((acc, item) => {
    acc.openCardCount += item.openCardCount;
    acc.addToCartCount += item.addToCartCount;
    acc.ordersCount += item.ordersCount;
    acc.ordersSumRub += item.ordersSumRub;
    acc.buyoutsCount += item.buyoutsCount;
    acc.buyoutsSumRub += item.buyoutsSumRub;
    return acc;
  }, {
    openCardCount: 0,
    addToCartCount: 0,
    ordersCount: 0,
    ordersSumRub: 0,
    buyoutsCount: 0,
    buyoutsSumRub: 0,
    cartConversionPct: 0,
    orderConversionPct: 0,
    buyoutPct: 0,
  });

  totals.ordersSumRub = roundMetric(totals.ordersSumRub);
  totals.buyoutsSumRub = roundMetric(totals.buyoutsSumRub);
  totals.cartConversionPct = computePct(totals.addToCartCount, totals.openCardCount);
  totals.orderConversionPct = computePct(totals.ordersCount, totals.addToCartCount);
  totals.buyoutPct = computePct(totals.buyoutsCount, totals.ordersCount);

  return {
    totals,
    items,
  };
}
