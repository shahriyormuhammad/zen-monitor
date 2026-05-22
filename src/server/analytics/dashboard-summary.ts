import { AnalyticsEngine } from '@/server/analytics/engine';
import { resolvePreviousPeriodRange } from '@/server/analytics/services/economics';
import { sql, type SQL } from 'drizzle-orm';
import {
  createTenantDashboardCache,
  getDashboardCacheTag,
} from '@/lib/analytics/dashboard-cache';
import { db, withTenantContext } from '@/lib/db';
import {
  getSalesPlanSummaryForPeriod,
  type SalesPlanPeriodSummary,
} from '@/server/sales-plan/service';

export type DashboardProductHighlight = {
  nmId: number;
  photoUrl: string | null;
  brand: string | null;
  vendorCode: string | null;
  soldQuantity: number;
  grossRevenue: number;
  netProfit: number;
  adSpend: number;
};

export type DashboardWarehouseRevenueRow = {
  warehouseName: string;
  revenue: number;
  salesCount: number;
  sharePct: number;
};

export type DashboardSummaryPayload = {
  kpi: Record<string, unknown>;
  chart: unknown;
  chartComparison: {
    period: {
      from: string;
      to: string;
    };
    rows: unknown;
  };
  salesPlan: SalesPlanPeriodSummary | null;
  products: {
    topSelling: DashboardProductHighlight[];
    leastSelling: DashboardProductHighlight[];
  };
  warehouseRevenue: {
    rows: DashboardWarehouseRevenueRow[];
    totalRevenue: number;
    warehouseCount: number;
    source: 'raw_api_sales';
  };
  scope: {
    type: 'all' | 'group';
    groupId: string | null;
  };
};

function toSafeNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toSafeString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toUtcDateParam(value: Date) {
  return value.toISOString().slice(0, 10);
}

function groupScopeFilter(tenantId: string, groupId: string | null, nmExpression: string): SQL {
  if (!groupId) {
    return sql``;
  }

  return sql`
    AND EXISTS (
      SELECT 1
      FROM product_group_members gm
      JOIN product_groups pg ON pg.id = gm.group_id
      WHERE gm.group_id = ${groupId}
        AND pg.tenant_id = ${tenantId}
        AND gm.nm_id = ${sql.raw(nmExpression)}
    )
  `;
}

async function loadWarehouseRevenue(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  groupId: string | null,
): Promise<DashboardSummaryPayload['warehouseRevenue']> {
  const from = toUtcDateParam(dateFrom);
  const to = toUtcDateParam(dateTo);
  const salesGroupFilter = groupScopeFilter(tenantId, groupId, 's.nm_id');
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH warehouse_sales AS (
      SELECT
        COALESCE(NULLIF(TRIM(s.warehouse_name), ''), 'Склад не указан') AS warehouse_name,
        COALESCE(SUM(s.price_with_discount), 0)::numeric AS revenue,
        COUNT(*)::int AS sales_count
      FROM raw_api_sales s
      LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
      WHERE s.tenant_id = ${tenantId}
        AND s.is_storno = false
        AND s.date::date >= ${from}::date
        AND s.date::date <= ${to}::date
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${salesGroupFilter}
      GROUP BY COALESCE(NULLIF(TRIM(s.warehouse_name), ''), 'Склад не указан')
    ),
    totals AS (
      SELECT COALESCE(SUM(revenue), 0)::numeric AS total_revenue
      FROM warehouse_sales
    )
    SELECT
      ws.warehouse_name AS "warehouseName",
      ws.revenue,
      ws.sales_count AS "salesCount",
      totals.total_revenue AS "totalRevenue",
      (SELECT COUNT(*) FROM warehouse_sales)::int AS "warehouseCount",
      CASE
        WHEN totals.total_revenue > 0 THEN ws.revenue / totals.total_revenue * 100
        ELSE 0
      END::numeric AS "sharePct"
    FROM warehouse_sales ws
    CROSS JOIN totals
    WHERE ws.revenue > 0
    ORDER BY ws.revenue DESC, ws.sales_count DESC, ws.warehouse_name ASC
    LIMIT 30
  `)) as Array<Record<string, unknown>>;

  const normalizedRows = rows.map((row) => ({
    warehouseName: toSafeString(row.warehouseName) ?? 'Склад не указан',
    revenue: toSafeNumber(row.revenue),
    salesCount: Math.round(toSafeNumber(row.salesCount)),
    sharePct: toSafeNumber(row.sharePct),
  }));
  const totalRevenue = rows.length > 0 ? toSafeNumber(rows[0]?.totalRevenue) : 0;
  const warehouseCount = rows.length > 0 ? Math.round(toSafeNumber(rows[0]?.warehouseCount)) : 0;

  return {
    rows: normalizedRows,
    totalRevenue,
    warehouseCount,
    source: 'raw_api_sales',
  };
}

async function buildDashboardSummaryPayload(
  tenantId: string,
  fromIso: string,
  toIso: string,
  groupId: string | null = null,
): Promise<DashboardSummaryPayload> {
  const parsedDateFrom = new Date(fromIso);
  const parsedDateTo = new Date(toIso);
  const previousRange = resolvePreviousPeriodRange(parsedDateFrom, parsedDateTo);
  const scopeGroupId = typeof groupId === 'string' && groupId.trim().length > 0 ? groupId.trim() : null;
  const scopeOptions = { calculationMode: 'FACT_WB' as const, groupId: scopeGroupId };

  const [kpi, chart, comparisonChart, unitEconomics, orderHighlights, salesPlan, warehouseRevenue] = await Promise.all([
    AnalyticsEngine.getKpis(tenantId, parsedDateFrom, parsedDateTo, scopeOptions),
    AnalyticsEngine.getDailyPnL(tenantId, parsedDateFrom, parsedDateTo, scopeOptions),
    AnalyticsEngine.getDailyPnL(tenantId, previousRange.from, previousRange.to, scopeOptions),
    AnalyticsEngine.getUnitEconomics(tenantId, parsedDateFrom, parsedDateTo, scopeOptions),
    AnalyticsEngine.getOrderHighlights(tenantId, parsedDateFrom, parsedDateTo, { groupId: scopeGroupId }),
    getSalesPlanSummaryForPeriod(
      tenantId,
      parsedDateFrom.toISOString().slice(0, 10),
      parsedDateTo.toISOString().slice(0, 10),
      scopeGroupId,
    ),
    loadWarehouseRevenue(tenantId, parsedDateFrom, parsedDateTo, scopeGroupId),
  ]);

  const unitEconomicsByNm = new Map<number, Record<string, unknown>>();
  for (const row of unitEconomics as Array<Record<string, unknown>>) {
    const nmId = toSafeNumber(row.nmId);
    if (nmId > 0) {
      unitEconomicsByNm.set(nmId, row);
    }
  }

  const normalizedProducts: DashboardProductHighlight[] = (orderHighlights as Array<Record<string, unknown>>)
    .map((row) => {
      const nmId = toSafeNumber(row.nmId);
      const financeRow = unitEconomicsByNm.get(nmId);
      return {
        nmId,
        photoUrl: toSafeString(row.photoUrl),
        brand: toSafeString(row.brand),
        vendorCode: toSafeString(row.vendorCode),
        soldQuantity: toSafeNumber(row.soldQuantity),
        grossRevenue: toSafeNumber(row.grossRevenue),
        netProfit: toSafeNumber(financeRow?.netProfit),
        adSpend: toSafeNumber(financeRow?.adSpend),
      };
    })
    .filter((row) => row.nmId > 0 && row.soldQuantity > 0);

  const topSelling = [...normalizedProducts]
    .sort((a, b) => b.soldQuantity - a.soldQuantity || b.grossRevenue - a.grossRevenue);
  const leastSelling = [...normalizedProducts]
    .sort((a, b) => a.soldQuantity - b.soldQuantity || a.grossRevenue - b.grossRevenue)
    .slice(0, 8);

  return {
    kpi: kpi as Record<string, unknown>,
    chart,
    chartComparison: {
      period: {
        from: toUtcDateParam(previousRange.from),
        to: toUtcDateParam(previousRange.to),
      },
      rows: comparisonChart,
    },
    salesPlan,
    products: { topSelling, leastSelling },
    warehouseRevenue,
    scope: {
      type: scopeGroupId ? 'group' : 'all',
      groupId: scopeGroupId,
    },
  };
}

export const loadDashboardPayload = createTenantDashboardCache(
  'dashboard-fast',
  getDashboardCacheTag,
  buildDashboardSummaryPayload,
);
