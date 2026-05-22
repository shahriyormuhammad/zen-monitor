import { db, withTenantContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql, type SQL } from "drizzle-orm";
import { subDays } from "date-fns";
import { parseNumeric, getUtcDayStart, getUtcNextDayStart } from "../helpers/numeric";
import { calculateNetProfitFromOperating } from "../helpers/net-profit";
import { buildTaxAmountSql, buildNetProfitSql } from "../helpers/sql-builders";

type NumericLike = number | string | null | undefined;

type UnitEconomicsRow = {
  nmId: number;
  soldQuantity: NumericLike;
  grossRevenue: NumericLike;
  netProfit: NumericLike;
  adSpend: NumericLike;
  logistics: NumericLike;
  currentStock: NumericLike;
  daysOfStock: NumericLike;
  lostOrdersCount: NumericLike;
  lostOrdersSum: NumericLike;
  stockAnalyticsDays: NumericLike;
  stockTurnoverDays: NumericLike;
  stockSizeAvailable: boolean;
  orderCount: NumericLike;
  buyoutCount: NumericLike;
  cancelCount: NumericLike;
  buyoutRate: NumericLike;
  views: NumericLike;
  carts: NumericLike;
  [key: string]: unknown;
};

type AnalyticsScopeOptions = {
  calculationMode?: EconomicsCalculationMode | string | null;
  groupId?: string | null;
};

function normalizeGroupId(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isFirstDayOfMonthUtc(date: Date) {
  return date.getUTCDate() === 1;
}

function isLastDayOfMonthUtc(date: Date) {
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return date.getUTCDate() === lastDay;
}

export function resolvePreviousPeriodRange(currentFrom: Date, currentTo: Date) {
  const isCurrentMonthToDate = (
    isFirstDayOfMonthUtc(currentFrom)
    && currentFrom.getUTCFullYear() === currentTo.getUTCFullYear()
    && currentFrom.getUTCMonth() === currentTo.getUTCMonth()
  );
  const isFullCalendarMonth = isCurrentMonthToDate && isLastDayOfMonthUtc(currentTo);

  if (isFullCalendarMonth) {
    const previousMonthStart = new Date(Date.UTC(
      currentFrom.getUTCFullYear(),
      currentFrom.getUTCMonth() - 1,
      1,
    ));
    const previousMonthEnd = new Date(Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth() + 1,
      0,
    ));

    return { from: previousMonthStart, to: previousMonthEnd };
  }

  if (isCurrentMonthToDate) {
    const previousMonthStart = new Date(Date.UTC(
      currentFrom.getUTCFullYear(),
      currentFrom.getUTCMonth() - 1,
      1,
    ));
    const previousMonthLastDay = new Date(Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    const currentDayOfMonth = currentTo.getUTCDate();
    const previousToDay = Math.min(currentDayOfMonth, previousMonthLastDay);
    const previousMonthTo = new Date(Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth(),
      previousToDay,
    ));
    return { from: previousMonthStart, to: previousMonthTo };
  }

  const duration = currentTo.getTime() - currentFrom.getTime();
  return {
    from: new Date(currentFrom.getTime() - duration - 86_400_000),
    to: new Date(currentTo.getTime() - duration - 86_400_000),
  };
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

type DailyPnlSummaryFallback = {
  financeRevenue: number;
  financeTaxBaseRevenue: number;
  tailRevenueFromSales: number;
  tailTaxBaseFromSales: number;
  tailProfitFromSales: number;
  tailLogisticsFromSales: number;
  tailRevenueSalesRows: number;
  tailRevenueFromFunnel: number;
  tailTaxBaseFromFunnel: number;
  tailRevenueFunnelRows: number;
  financeBuyouts: number;
  tailBuyoutsFromSales: number;
  tailBuyoutsFromFunnel: number;
  tailStorageOperational: number;
  tailStorageRows: number;
  revenueProvisionalDays: number;
  financeOperatingProfit: number;
  financeLogistics: number;
  taxType: string;
  taxRate: number;
  vatMode: string;
  vatRate: number;
  totalStorageFinance: number;
  totalStorageOperational: number;
  totalStorageOperationalRows: number;
  totalAds: number;
  totalAdsOrderSum: number;
  totalAdsOrderCount: number;
  adsSource: string;
  totalStocks: number;
  totalStocksInWayToClient: number;
  totalStocksInWayFromClient: number;
  stocksAvailable: boolean;
  stockDays: number;
  stockTurnoverDays: number;
  stockAnalyticsAvailable: boolean;
  lostOrdersCount: number;
  lostOrdersSum: number;
  localSharePct: number;
  localShareAvailable: boolean;
  totalSppRub: number;
  totalSppBaseAmount: number;
  sppSnapshotAvg: number;
  sppAvailable: boolean;
  sppSnapshotAvailable: boolean;
  totalViews: number;
  totalFunnelOrders: number;
  totalFunnelCancels: number;
  totalOrderSum: number;
  totalBuyouts: number;
  totalBuyoutSum: number;
  totalFunnelRows: number;
  fallbackOrders: number;
  fallbackOrderRevenue: number;
  dailyCoveredDays: number;
  selectedFunnelPeriodEnd: string | null;
};

export type EconomicsCalculationMode = "FACT_WB" | "PLAN_TEMPLATE";
export type DataTrustStatus = "ok" | "warning" | "critical";

export type DataTrustCheck = {
  id: string;
  label: string;
  status: DataTrustStatus;
  expected: string;
  actual: string;
  deltaPct: number | null;
  details: string;
};

export type DashboardDataTrustAudit = {
  status: DataTrustStatus;
  score: number;
  checkedAt: string;
  blockers: string[];
  sources: {
    adsSource: "ad_costs" | "ad_clusters" | "none";
    toplineSource: "exact_funnel" | "finance_only";
    calculationMode: EconomicsCalculationMode;
  };
  checks: DataTrustCheck[];
};

export function resolveEconomicsCalculationMode(value: string | null | undefined): EconomicsCalculationMode {
  return value === "PLAN_TEMPLATE" ? "PLAN_TEMPLATE" : "FACT_WB";
}

export function buildWbRealizationTaxBaseSql(alias = "r") {
  return `COALESCE(${alias}.retail_amount, 0)`;
}

export function buildWbSellerPriceAfterDiscountSql(alias = "r") {
  return `
    CASE
      WHEN COALESCE(${alias}.retail_price_withdisc_rub, 0) <> 0
        THEN COALESCE(${alias}.retail_price_withdisc_rub, 0)
      ELSE COALESCE(${alias}.retail_amount, 0)
    END
  `;
}

function buildWbDeductionReasonSql(alias = "r") {
  return `
    LOWER(COALESCE(
      NULLIF(${alias}.bonus_type_name, ''),
      NULLIF(${alias}.supplier_oper_name, ''),
      NULLIF(${alias}.doc_type_name, ''),
      ''
    ))
  `;
}

function buildWbCreditPrincipalPredicateSql(alias = "r") {
  const reasonSql = buildWbDeductionReasonSql(alias);
  return `
    (${reasonSql} LIKE '%основного долга%' AND ${reasonSql} LIKE '%кредит%')
  `;
}

function buildWbCreditInterestPredicateSql(alias = "r") {
  const reasonSql = buildWbDeductionReasonSql(alias);
  return `
    (${reasonSql} LIKE '%процент%' AND ${reasonSql} LIKE '%кредит%')
  `;
}

function buildWbPromotionDeductionPredicateSql(alias = "r") {
  const reasonSql = buildWbDeductionReasonSql(alias);
  return `
    (${reasonSql} LIKE '%продвиж%' AND (${reasonSql} LIKE '%wb%' OR ${reasonSql} LIKE '%вб%'))
  `;
}

export function buildWbDeductionExpenseSql(alias = "r") {
  return `
    CASE
      WHEN ${buildWbCreditPrincipalPredicateSql(alias)}
        THEN 0
      WHEN ${buildWbPromotionDeductionPredicateSql(alias)}
        THEN 0
      ELSE COALESCE(${alias}.deduction, 0)
    END
  `;
}

export function buildWbCreditPrincipalDeductionSql(alias = "r") {
  return `
    CASE
      WHEN ${buildWbCreditPrincipalPredicateSql(alias)}
        THEN COALESCE(${alias}.deduction, 0)
      ELSE 0
    END
  `;
}

export function buildWbCreditInterestDeductionSql(alias = "r") {
  return `
    CASE
      WHEN ${buildWbCreditInterestPredicateSql(alias)}
        THEN COALESCE(${alias}.deduction, 0)
      ELSE 0
    END
  `;
}

export function buildWbDeductionKindSql(alias = "r") {
  return `
    CASE
      WHEN ${buildWbCreditPrincipalPredicateSql(alias)} THEN 'credit_principal'
      WHEN ${buildWbCreditInterestPredicateSql(alias)} THEN 'credit_interest'
      WHEN ${buildWbPromotionDeductionPredicateSql(alias)} THEN 'wb_promotion'
      ELSE 'other'
    END
  `;
}

export function buildWbPayoutBeforeCostSql(alias = "r") {
  return `
    CASE
      WHEN COALESCE(${alias}.ppvz_for_pay, 0) <> 0
        THEN COALESCE(${alias}.ppvz_for_pay, 0)
      ELSE (
        (${buildWbSellerPriceAfterDiscountSql(alias)})
        - COALESCE(${alias}.commission_amount, 0)
        - COALESCE(${alias}.delivery_rub, 0)
        - COALESCE(${alias}.storage_fee_rub, 0)
        - COALESCE(${alias}.penalty_rub, 0)
        - COALESCE(${alias}.payment_schedule_rub, 0)
        - (${buildWbDeductionExpenseSql(alias)})
        - COALESCE(${alias}.acquiring_fee, 0)
      )
    END
  `;
}

const OPERATIONAL_TAIL_DEFAULT_PAYOUT_RATE = 0.75;
const OPERATIONAL_TAIL_DEFAULT_RESIDUAL_RATE = 1 - OPERATIONAL_TAIL_DEFAULT_PAYOUT_RATE;

export function buildOperationalTailComponentSql(
  revenueExpr: string,
  ratesAlias: string,
  rateColumn: string,
  fallbackRate = 0,
) {
  return `(COALESCE(${revenueExpr}, 0) * COALESCE(${ratesAlias}.${rateColumn}, ${fallbackRate}))`;
}

export function buildOperationalTailOtherFeesSql(revenueExpr: string, ratesAlias = "m") {
  return `
    (
      ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "wb_storage_fee_rate")}
      + ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "penalty_rate")}
      + ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "payment_schedule_rate")}
      + ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "deduction_rate")}
      + ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "acquiring_rate")}
      - ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "additional_payment_rate")}
      + ${buildOperationalTailComponentSql(
        revenueExpr,
        ratesAlias,
        "residual_rate",
        OPERATIONAL_TAIL_DEFAULT_RESIDUAL_RATE,
      )}
    )
  `;
}

export function buildOperationalTailPayoutBeforeCostSql(revenueExpr: string, ratesAlias = "m") {
  return `
    (
      COALESCE(${revenueExpr}, 0)
      - ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "commission_rate")}
      - ${buildOperationalTailComponentSql(revenueExpr, ratesAlias, "logistics_rate")}
      - ${buildOperationalTailOtherFeesSql(revenueExpr, ratesAlias)}
    )
  `;
}

export function buildOperationalTailRatesSelectSql(alias = "r") {
  const revenueBase = `NULLIF(SUM(ABS(COALESCE(${alias}.retail_amount, 0))), 0)`;
  const payoutBeforeCost = `SUM((${buildWbPayoutBeforeCostSql(alias)}))`;
  const deductionExpense = `SUM((${buildWbDeductionExpenseSql(alias)}))`;
  const creditPrincipal = `SUM((${buildWbCreditPrincipalDeductionSql(alias)}))`;
  const creditInterest = `SUM((${buildWbCreditInterestDeductionSql(alias)}))`;
  const residualNumerator = `
    (
      SUM(ABS(COALESCE(${alias}.retail_amount, 0)))
      - SUM(COALESCE(${alias}.commission_amount, 0))
      - SUM(COALESCE(${alias}.delivery_rub, 0))
      - SUM(COALESCE(${alias}.storage_fee_rub, 0))
      - SUM(COALESCE(${alias}.penalty_rub, 0))
      - SUM(COALESCE(${alias}.payment_schedule_rub, 0))
      - ${deductionExpense}
      - SUM(COALESCE(${alias}.acquiring_fee, 0))
      - ${payoutBeforeCost}
    )
  `;

  return `
    SUM(ABS(COALESCE(${alias}.retail_amount, 0)))::numeric as revenue_base,
    COALESCE(${payoutBeforeCost} / ${revenueBase}, ${OPERATIONAL_TAIL_DEFAULT_PAYOUT_RATE})::numeric as payout_rate,
    COALESCE(SUM(COALESCE(${alias}.commission_amount, 0)) / ${revenueBase}, 0)::numeric as commission_rate,
    COALESCE(SUM(COALESCE(${alias}.delivery_rub, 0)) / ${revenueBase}, 0)::numeric as logistics_rate,
    COALESCE(SUM(COALESCE(${alias}.storage_fee_rub, 0)) / ${revenueBase}, 0)::numeric as wb_storage_fee_rate,
    COALESCE(SUM(COALESCE(${alias}.penalty_rub, 0)) / ${revenueBase}, 0)::numeric as penalty_rate,
    COALESCE(SUM(COALESCE(${alias}.payment_schedule_rub, 0)) / ${revenueBase}, 0)::numeric as payment_schedule_rate,
    COALESCE(${deductionExpense} / ${revenueBase}, 0)::numeric as deduction_rate,
    COALESCE(${creditPrincipal} / ${revenueBase}, 0)::numeric as credit_principal_rate,
    COALESCE(${creditInterest} / ${revenueBase}, 0)::numeric as credit_interest_rate,
    COALESCE(SUM(COALESCE(${alias}.acquiring_fee, 0)) / ${revenueBase}, 0)::numeric as acquiring_rate,
    0::numeric as additional_payment_rate, -- возмещение перевозки исключено из P&L (не доход, см. migration 0107)
    COALESCE(${residualNumerator} / ${revenueBase}, ${OPERATIONAL_TAIL_DEFAULT_RESIDUAL_RATE})::numeric as residual_rate
  `;
}

export function buildWbRealizationSaleDateSql(alias = "r") {
  return `COALESCE(${alias}.sale_dt, ${alias}.date_from)`;
}

function buildJsonbNumericSql(valueExpr: string) {
  return `
    CASE
      WHEN NULLIF(TRIM(${valueExpr}), '') ~ '^-?[0-9]+([,.][0-9]+)?$'
        THEN REPLACE(TRIM(${valueExpr}), ',', '.')::numeric
      ELSE NULL
    END
  `;
}

function buildManualNumericSql(manualAlias: string, field: string) {
  return buildJsonbNumericSql(`${manualAlias}.manual_fields ->> '${field}'`);
}

function buildSelectedWarehouseCostSql(manualAlias: string) {
  const warehouseCostsExpr = `
    CASE
      WHEN jsonb_typeof(${manualAlias}.manual_fields -> 'warehouseCosts') = 'object'
        THEN ${manualAlias}.manual_fields -> 'warehouseCosts'
      ELSE '{}'::jsonb
    END
  `;
  const selectedWarehousesExpr = `
    CASE
      WHEN jsonb_typeof(${manualAlias}.manual_fields -> 'selectedWarehouses') = 'array'
        THEN ${manualAlias}.manual_fields -> 'selectedWarehouses'
      ELSE '[]'::jsonb
    END
  `;

  return `
    COALESCE((
      SELECT AVG(${buildJsonbNumericSql("wc.value")})
      FROM jsonb_each_text(${warehouseCostsExpr}) AS wc(key, value)
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(${selectedWarehousesExpr}) AS sw(warehouse_id)
        WHERE sw.warehouse_id = wc.key
      )
    ), 0)
  `;
}

export function buildFullLandedCostSql(manualAlias: string, configuredCostExpr: string) {
  const purchaseCost = buildPurchaseCostSql(manualAlias, configuredCostExpr);

  return `
    (
      ${purchaseCost}
      + COALESCE((${buildManualNumericSql(manualAlias, "deliveryToFf")}), 0)
      + COALESCE((${buildManualNumericSql(manualAlias, "packagingMaterial")}), 0)
      + COALESCE((${buildManualNumericSql(manualAlias, "fulfillment")}), 0)
      + ${buildSelectedWarehouseCostSql(manualAlias)}
    )
  `;
}

function buildPurchaseCostSql(manualAlias: string, configuredCostExpr: string) {
  const manualCost = buildManualNumericSql(manualAlias, "costPrice");
  const hasDetailedCosts = `
    (
      COALESCE((${buildManualNumericSql(manualAlias, "deliveryToFf")}), 0) > 0
      OR COALESCE((${buildManualNumericSql(manualAlias, "packagingMaterial")}), 0) > 0
      OR COALESCE((${buildManualNumericSql(manualAlias, "fulfillment")}), 0) > 0
      OR ${buildSelectedWarehouseCostSql(manualAlias)} > 0
    )
  `;

  return `
    COALESCE(
      CASE WHEN COALESCE((${manualCost}), 0) > 0 THEN (${manualCost}) ELSE NULL END,
      CASE WHEN NOT ${hasDetailedCosts} THEN ${configuredCostExpr} ELSE NULL END,
      0
    )
  `;
}

export async function getDailyPnL(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  _options?: AnalyticsScopeOptions,
) {
  const from = getUtcDayStart(dateFrom).toISOString();
  const toExclusive = getUtcNextDayStart(dateTo).toISOString();
  // Always include provisional tail so the chart shows operational data
  // for days after the last realization report (reconciliation cutoff).
  // Without this, the chart would show gaps while KPI cards show totals.
  // calculationMode accepted for API compatibility but not yet applied here.
  const includeProvisionalTail = true;
  const groupId = normalizeGroupId(_options?.groupId);
  const realizationGroupFilter = groupScopeFilter(tenantId, groupId, "r.nm_id");
  const mvGroupFilter = groupScopeFilter(tenantId, groupId, "m.nm_id");
  const salesGroupFilter = groupScopeFilter(tenantId, groupId, "s.nm_id");
  const adsGroupFilter = groupScopeFilter(tenantId, groupId, "c.nm_id");
  const funnelGroupFilter = groupScopeFilter(tenantId, groupId, "f.nm_id");
  const ordersGroupFilter = groupScopeFilter(tenantId, groupId, "r.nm_id");
  const storageGroupFilter = groupScopeFilter(tenantId, groupId, "st.nm_id");
  const stocksGroupFilter = groupScopeFilter(tenantId, groupId, "s.nm_id");
  const dailyProfitBeforeTaxExpr = "COALESCE(s.op_profit, 0) - COALESCE(a.total_ads, 0)";
  const dailyNetProfitExpr = buildNetProfitSql({
    taxTypeExpr: "tt.tax_type",
    taxRateExpr: "tt.tax_rate",
    vatModeExpr: "tt.vat_mode",
    vatRateExpr: "tt.vat_rate",
    revenueExpr: "COALESCE(s.tax_base_revenue, 0)",
    profitBeforeTaxExpr: dailyProfitBeforeTaxExpr,
  });

  try {
    const query = sql`
      WITH day_grid AS (
        SELECT generate_series(
          ${from}::timestamp,
          (${toExclusive}::timestamp - interval '1 day'),
          interval '1 day'
        ) as day_raw
      ),
      tenant_tax AS (
        SELECT tax_type, tax_rate, vat_mode, vat_rate
        FROM tenants
        WHERE id = ${tenantId}
        LIMIT 1
      ),
      reconciliation_cutoff AS MATERIALIZED (
        SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) as cutoff
        FROM raw_api_realization_reports
        WHERE tenant_id = ${tenantId}
      ),
      sku_operational_tail_rates AS MATERIALIZED (
        -- Recent WB component rates per SKU for operational tail estimates.
        SELECT
          r.nm_id,
          ${sql.raw(buildOperationalTailRatesSelectSql("r"))}
        FROM raw_api_realization_reports r
        WHERE r.tenant_id = ${tenantId}
          AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
          ${realizationGroupFilter}
        GROUP BY r.nm_id
      ),
      full_cost_latest AS MATERIALIZED (
        -- Dashboard profit uses the full landed cost from Unit Economics:
        -- purchase + delivery to FF + packaging + fulfillment + selected WB delivery.
        SELECT
          cost_source.nm_id,
          (${sql.raw(buildFullLandedCostSql("mi", "c.cost_price"))})::numeric as full_cost
        FROM (
          SELECT nm_id FROM unit_economics_configs WHERE tenant_id = ${tenantId}
          UNION
          SELECT nm_id FROM unit_economics_manual_inputs WHERE tenant_id = ${tenantId}
        ) cost_source
        LEFT JOIN LATERAL (
          SELECT cost_price
          FROM unit_economics_configs
          WHERE tenant_id = ${tenantId}
            AND nm_id = cost_source.nm_id
          ORDER BY effective_from DESC
          LIMIT 1
        ) c ON true
        LEFT JOIN unit_economics_manual_inputs mi
          ON mi.tenant_id = ${tenantId}
         AND mi.nm_id = cost_source.nm_id
      ),
      unified_sales AS (
        -- FINAL DATA sourced from mv_daily_pnl_final (pre-aggregated per day+nm_id).
        -- full landed cost is joined at read-time so cost edits
        -- are picked up without waiting for the next MV refresh.
        SELECT
          m.day::timestamp as day_raw,
          m.nm_id,
          m.revenue as revenue,
          m.spp_rub as spp,
          m.tax_base_revenue as tax_base_revenue,
          m.logistics as logistics,
          (m.payout_before_cost - m.quantity_for_cost * COALESCE(c.full_cost, 0)) as profit
        FROM mv_daily_pnl_final m
        LEFT JOIN full_cost_latest c ON c.nm_id = m.nm_id
        WHERE m.tenant_id = ${tenantId}
          AND m.day >= ${from}::date
          AND m.day < ${toExclusive}::date
          ${mvGroupFilter}

        ${includeProvisionalTail ? sql`
          UNION ALL

          -- PROVISIONAL DATA from statistics api (only after cutoff)
          -- Uses historical WB component rates plus a residual reserve.
          SELECT
            DATE_TRUNC('day', s.date) as day_raw,
            s.nm_id,
            s.price_with_discount as revenue,
            0 as spp,
            s.price_with_discount as tax_base_revenue,
            ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "logistics_rate"))})) as logistics,
            ((${sql.raw(buildOperationalTailPayoutBeforeCostSql("s.price_with_discount", "m"))}) - COALESCE(c.full_cost, 0)) as profit
          FROM raw_api_sales s
          CROSS JOIN reconciliation_cutoff rc
          LEFT JOIN sku_operational_tail_rates m ON m.nm_id = s.nm_id
          LEFT JOIN full_cost_latest c ON c.nm_id = s.nm_id
          WHERE s.tenant_id = ${tenantId}
            AND s.date::date > rc.cutoff::date
            AND s.date >= ${from}::timestamp
            AND s.date < ${toExclusive}::timestamp
            AND s.is_storno = false
            ${salesGroupFilter}
        ` : sql``}
      ),
      daily_stats AS (
        SELECT
          u.day_raw,
          COALESCE(SUM(u.revenue + u.spp), 0)::numeric as gross_revenue,
          COALESCE(SUM(u.revenue), 0)::numeric as realized_revenue,
          COALESCE(SUM(u.spp), 0)::numeric as spp_amount,
          COALESCE(SUM(u.tax_base_revenue), 0)::numeric as tax_base_revenue,
          COALESCE(SUM(u.logistics), 0)::numeric as logistics_amount,
          COALESCE(SUM(u.profit), 0)::numeric as op_profit
        FROM unified_sales u
        LEFT JOIN products p ON u.nm_id = p.nm_id AND p.tenant_id = ${tenantId}
        WHERE COALESCE(p.is_hidden, FALSE) = FALSE
        GROUP BY u.day_raw
      ),
      daily_ads_costs AS (
        SELECT
          DATE_TRUNC('day', c.date) as day_raw,
          SUM(c.amount)::numeric as total_ads
        FROM raw_api_ad_costs c
        LEFT JOIN products p ON p.tenant_id = c.tenant_id AND p.nm_id = c.nm_id
        WHERE c.tenant_id = ${tenantId}
          AND c.date >= ${from}::timestamp
          AND c.date < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${adsGroupFilter}
        GROUP BY DATE_TRUNC('day', c.date)
      ),
      daily_ads_clusters AS (
        SELECT
          DATE_TRUNC('day', c.date) as day_raw,
          SUM(c.amount)::numeric as total_ads
        FROM raw_api_ad_clusters c
        LEFT JOIN products p ON p.tenant_id = c.tenant_id AND p.nm_id = c.nm_id
        WHERE c.tenant_id = ${tenantId}
          AND c.date >= ${from}::timestamp
          AND c.date < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${adsGroupFilter}
        GROUP BY DATE_TRUNC('day', c.date)
      ),
      daily_ads_source AS (
        SELECT
          CASE
            WHEN EXISTS (SELECT 1 FROM daily_ads_costs) THEN 'ad_costs'
            WHEN EXISTS (SELECT 1 FROM daily_ads_clusters) THEN 'ad_clusters'
            ELSE 'none'
          END::text as source
      ),
      daily_ads AS (
        SELECT c.day_raw, COALESCE(c.total_ads, 0)::numeric as total_ads
        FROM daily_ads_costs c
        CROSS JOIN daily_ads_source src
        WHERE src.source = 'ad_costs'

        UNION ALL

        SELECT cl.day_raw, COALESCE(cl.total_ads, 0)::numeric as total_ads
        FROM daily_ads_clusters cl
        CROSS JOIN daily_ads_source src
        WHERE src.source = 'ad_clusters'
      ),
      daily_funnel_exact AS (
        SELECT
          DATE_TRUNC('day', f.period_start) as day_raw,
          COALESCE(SUM(f.open_card_count), 0)::numeric as open_card_count,
          COALESCE(SUM(f.order_count), 0)::numeric as order_count,
          COALESCE(SUM(f.order_sum), 0)::numeric as order_sum,
          COALESCE(SUM(f.buyout_count), 0)::numeric as buyout_count,
          COALESCE(SUM(f.cancel_count), 0)::numeric as cancel_count,
          COUNT(*)::int as total_rows
        FROM raw_api_funnel_stats f
        LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
        WHERE f.tenant_id = ${tenantId}
          AND f.period_start::date = f.period_end::date
          AND f.period_start >= ${from}::timestamp
          AND f.period_start < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${funnelGroupFilter}
        GROUP BY DATE_TRUNC('day', f.period_start)
      ),
      daily_impressions AS (
        SELECT
          DATE_TRUNC('day', sf.date) as day_raw,
          COALESCE(SUM(sf.view_count), 0)::numeric as view_count,
          COALESCE(SUM(sf.open_card_count), 0)::numeric as open_card_count
        FROM raw_api_sales_funnel_daily sf
        WHERE sf.tenant_id = ${tenantId}
          AND sf.date >= ${from}::timestamp
          AND sf.date < ${toExclusive}::timestamp
          ${groupId ? sql`AND FALSE` : sql``}
        GROUP BY DATE_TRUNC('day', sf.date)
      ),
      daily_orders_raw AS (
        SELECT
          DATE_TRUNC('day', r.date) as day_raw,
          COUNT(*)::numeric as order_count,
          COALESCE(SUM(r.total_price), 0)::numeric as order_sum
        FROM raw_api_orders r
        LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
        WHERE r.tenant_id = ${tenantId}
          AND r.date >= ${from}::timestamp
          AND r.date < ${toExclusive}::timestamp
          AND r.is_cancel = false
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${ordersGroupFilter}
        GROUP BY DATE_TRUNC('day', r.date)
      ),
      daily_buyouts_raw AS (
        SELECT
          DATE_TRUNC('day', s.date) as day_raw,
          COUNT(*)::numeric as buyout_count
        FROM raw_api_sales s
        LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.date >= ${from}::timestamp
          AND s.date < ${toExclusive}::timestamp
          AND s.is_storno = false
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${salesGroupFilter}
        GROUP BY DATE_TRUNC('day', s.date)
      ),
      daily_finance_buyouts AS (
        SELECT
          m.day::timestamp as day_raw,
          COALESCE(SUM(m.quantity_for_cost), 0)::numeric as buyout_count
        FROM mv_daily_pnl_final m
        LEFT JOIN products p ON p.tenant_id = m.tenant_id AND p.nm_id = m.nm_id
        WHERE m.tenant_id = ${tenantId}
          AND m.day >= ${from}::date
          AND m.day < ${toExclusive}::date
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${mvGroupFilter}
        GROUP BY m.day
      ),
      daily_storage AS (
        SELECT
          DATE_TRUNC('day', st.date) as day_raw,
          COALESCE(SUM(st.storage_amount), 0)::numeric as storage_amount
        FROM raw_api_paid_storage st
        LEFT JOIN products p ON p.tenant_id = st.tenant_id AND p.nm_id = st.nm_id
        WHERE st.tenant_id = ${tenantId}
          AND st.date >= ${from}::timestamp
          AND st.date < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${storageGroupFilter}
        GROUP BY DATE_TRUNC('day', st.date)
      ),
      daily_spp AS (
        SELECT
          m.day::timestamp as day_raw,
          COALESCE(SUM(m.spp_rub), 0)::numeric as spp_rub,
          COALESCE(SUM(m.revenue + m.spp_rub), 0)::numeric as spp_base_amount
        FROM mv_daily_pnl_final m
        LEFT JOIN products p ON p.tenant_id = m.tenant_id AND p.nm_id = m.nm_id
        WHERE m.tenant_id = ${tenantId}
          AND m.day >= ${from}::date
          AND m.day < ${toExclusive}::date
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${mvGroupFilter}
        GROUP BY m.day
      ),
      daily_localization AS (
        SELECT DISTINCT ON (DATE_TRUNC('day', r.created_at))
          DATE_TRUNC('day', r.created_at) as day_raw,
          r.current_local_share_pct::numeric as localization_pct
        FROM redistribution_runs r
        WHERE r.tenant_id = ${tenantId}
          AND r.created_at >= ${from}::timestamp
          AND r.created_at < ${toExclusive}::timestamp
          AND r.status <> 'failed'
          AND r.sku_count > 0
        ORDER BY DATE_TRUNC('day', r.created_at), r.created_at DESC
      ),
      daily_stocks AS (
        SELECT
          DATE_TRUNC('day', s.date) as day_raw,
          COALESCE(SUM(s.amount), 0)::numeric as stocks_total
        FROM raw_api_stocks s
        LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.date >= ${from}::timestamp
          AND s.date < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${stocksGroupFilter}
        GROUP BY DATE_TRUNC('day', s.date)
      )
      SELECT
        TO_CHAR(g.day_raw, 'YYYY-MM-DD') as day_date,
        COALESCE(s.gross_revenue, 0)::numeric as gross_revenue,
        COALESCE(s.realized_revenue, 0)::numeric as realized_revenue,
        COALESCE(s.spp_amount, 0)::numeric as spp_amount,
        COALESCE((${sql.raw(dailyNetProfitExpr)})::numeric, 0)::numeric as net_profit,
        COALESCE(
          CASE
            WHEN COALESCE(f.total_rows, 0) > 0 THEN f.order_sum
            ELSE o.order_sum
          END,
          0
        )::numeric as order_sum,
        COALESCE(
          CASE
            WHEN COALESCE(f.total_rows, 0) > 0 THEN f.order_count
            ELSE o.order_count
          END,
          0
        )::numeric as order_count,
        COALESCE(
          CASE
            WHEN COALESCE(fb.buyout_count, 0) > 0 THEN fb.buyout_count
            WHEN COALESCE(f.total_rows, 0) > 0
              AND NOT (
                COALESCE(f.buyout_count, 0) <= 0
                AND COALESCE(f.order_count, 0) > 0
                AND COALESCE(b.buyout_count, 0) > 0
              )
              THEN f.buyout_count
            ELSE b.buyout_count
          END,
          0
        )::numeric as buyout_count,
        CASE
          WHEN COALESCE(f.total_rows, 0) > 0
            AND (COALESCE(f.buyout_count, 0) + COALESCE(f.cancel_count, 0)) > 0
            THEN COALESCE(f.buyout_count, 0) / NULLIF(COALESCE(f.buyout_count, 0) + COALESCE(f.cancel_count, 0), 0) * 100
          WHEN COALESCE(o.order_count, 0) > 0
            THEN COALESCE(b.buyout_count, 0) / NULLIF(COALESCE(o.order_count, 0), 0) * 100
          ELSE 0
        END::numeric as buyout_rate_pct,
        COALESCE(s.logistics_amount, 0)::numeric as logistics_amount,
        CASE
          WHEN COALESCE(s.gross_revenue, 0) > 0
            THEN ((${sql.raw(dailyProfitBeforeTaxExpr)}) / NULLIF(COALESCE(s.gross_revenue, 0), 0)) * 100
          ELSE 0
        END::numeric as gross_margin_pct,
        CASE
          WHEN COALESCE(s.gross_revenue, 0) > 0
            THEN (COALESCE((${sql.raw(dailyNetProfitExpr)})::numeric, 0) / NULLIF(COALESCE(s.gross_revenue, 0), 0)) * 100
          ELSE 0
        END::numeric as net_margin_pct,
        COALESCE(st.storage_amount, 0)::numeric as storage_amount,
        CASE
          WHEN COALESCE(f.open_card_count, 0) > 0
            THEN (COALESCE(f.order_count, 0) / NULLIF(COALESCE(f.open_card_count, 0), 0)) * 100
          ELSE NULL
        END::numeric as conversion_pct,
        COALESCE(di.view_count, 0)::numeric as impressions,
        CASE
          WHEN COALESCE(di.view_count, 0) > 0
            THEN (COALESCE(di.open_card_count, 0) / NULLIF(COALESCE(di.view_count, 0), 0)) * 100
          ELSE NULL
        END::numeric as funnel_ctr_pct,
        COALESCE(a.total_ads, 0)::numeric as ads_amount,
        CASE
          WHEN COALESCE(s.gross_revenue, 0) > 0
            THEN (COALESCE(a.total_ads, 0) / NULLIF(COALESCE(s.gross_revenue, 0), 0)) * 100
          ELSE 0
        END::numeric as ads_drr_pct,
        loc.localization_pct::numeric as localization_pct,
        COALESCE(stk.stocks_total, 0)::numeric as stocks_total,
        CASE
          WHEN COALESCE(sp.spp_base_amount, 0) > 0
            THEN (COALESCE(sp.spp_rub, 0) / NULLIF(COALESCE(sp.spp_base_amount, 0), 0)) * 100
          ELSE NULL
        END::numeric as spp_pct
      FROM day_grid g
      CROSS JOIN tenant_tax tt
      LEFT JOIN daily_stats s ON s.day_raw = g.day_raw
      LEFT JOIN daily_ads a ON a.day_raw = g.day_raw
      LEFT JOIN daily_funnel_exact f ON f.day_raw = g.day_raw
      LEFT JOIN daily_impressions di ON di.day_raw = g.day_raw
      LEFT JOIN daily_orders_raw o ON o.day_raw = g.day_raw
      LEFT JOIN daily_buyouts_raw b ON b.day_raw = g.day_raw
      LEFT JOIN daily_finance_buyouts fb ON fb.day_raw = g.day_raw
      LEFT JOIN daily_storage st ON st.day_raw = g.day_raw
      LEFT JOIN daily_localization loc ON loc.day_raw = g.day_raw
      LEFT JOIN daily_stocks stk ON stk.day_raw = g.day_raw
      LEFT JOIN daily_spp sp ON sp.day_raw = g.day_raw
      ORDER BY day_date ASC
    `;

    const res = await withTenantContext(db, tenantId, async (tx) => tx.execute(query));
    return res;
  } catch (error) {
    logger.error({ err: error }, "[AnalyticsEngine.getDailyPnL] SQL Error");
    throw error;
  }
}

/**
 * Таблица Unit-Экономики с учетом Рекламы и Воронки
 */
export async function getUnitEconomics(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  options?: AnalyticsScopeOptions & { recentActivityDays?: number | null },
): Promise<UnitEconomicsRow[]> {
  const from = getUtcDayStart(dateFrom).toISOString();
  const to = getUtcDayStart(dateTo).toISOString();
  const toExclusive = getUtcNextDayStart(dateTo).toISOString();
  const recentActivityDaysRaw = Number(options?.recentActivityDays ?? 0);
  const recentActivityDays = Number.isFinite(recentActivityDaysRaw) && recentActivityDaysRaw > 0
    ? Math.round(recentActivityDaysRaw)
    : 0;
  const groupId = normalizeGroupId(options?.groupId);
  const calculationMode = resolveEconomicsCalculationMode(options?.calculationMode);
  // Always include provisional tail so per-SKU economics show operational data
  // for days after the last realization report, consistent with KPI cards and chart.
  const includeProvisionalTail = true;
  const realizationGroupFilter = groupScopeFilter(tenantId, groupId, "r.nm_id");
  const salesGroupFilter = groupScopeFilter(tenantId, groupId, "s.nm_id");
  const adsGroupFilter = groupScopeFilter(tenantId, groupId, "a.nm_id");
  const funnelGroupFilter = groupScopeFilter(tenantId, groupId, "f.nm_id");
  const activityFrom = recentActivityDays > 0
    ? getUtcDayStart(subDays(dateTo, recentActivityDays)).toISOString()
    : null;
  const periodDays = Math.max(1, Math.round(
    (getUtcDayStart(dateTo).getTime() - getUtcDayStart(dateFrom).getTime()) / 86_400_000
  ) + 1);
  const unitProfitBeforeTaxExpr = "b.payout_before_cost - b.total_cost - COALESCE(a.ad_spend, 0)";
  const unitNetProfitExpr = buildNetProfitSql({
    taxTypeExpr: "b.tax_type",
    taxRateExpr: "b.tax_rate",
    vatModeExpr: "b.vat_mode",
    vatRateExpr: "b.vat_rate",
    revenueExpr: "b.tax_base_revenue",
    profitBeforeTaxExpr: unitProfitBeforeTaxExpr,
  });

  const skuPoolCte = groupId
    ? sql`
      sku_pool AS (
        SELECT gm.nm_id
        FROM product_group_members gm
        JOIN product_groups pg ON pg.id = gm.group_id
        WHERE gm.group_id = ${groupId}
          AND pg.tenant_id = ${tenantId}
      ),
    `
    : activityFrom
    ? sql`
      active_recent_skus AS (
        SELECT nm_id
        FROM raw_api_orders
        WHERE tenant_id = ${tenantId}
          AND date >= ${activityFrom}::timestamp
          AND date < ${toExclusive}::timestamp
          AND is_cancel = false
        UNION
        SELECT nm_id
        FROM raw_api_sales
        WHERE tenant_id = ${tenantId}
          AND date >= ${activityFrom}::timestamp
          AND date < ${toExclusive}::timestamp
          AND is_storno = false
        UNION
        SELECT nm_id
        FROM raw_api_realization_reports
        WHERE tenant_id = ${tenantId}
          AND COALESCE(sale_dt, date_from) >= ${activityFrom}::timestamp
          AND COALESCE(sale_dt, date_from) < ${toExclusive}::timestamp
      ),
      sku_pool AS (
        SELECT nm_id FROM active_recent_skus
      ),
    `
    : sql`
      sku_pool AS (
        SELECT nm_id FROM products WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM unit_economics_configs WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM unit_economics_manual_inputs WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_product_metadata WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_prices WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_stocks WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_paid_storage WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_ad_costs WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_ad_clusters WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_funnel_stats WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_orders WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_sales WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_realization_reports WHERE tenant_id = ${tenantId}
      ),
    `;

  const query = sql`
    WITH inventory AS (
      SELECT
        nm_id,
        SUM(amount) as current_stock
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
      GROUP BY nm_id
    ),
    stock_size_latest AS (
      SELECT MAX(snapshot_date) as snapshot_date
      FROM raw_api_stock_sizes
      WHERE tenant_id = ${tenantId}
        AND stock_type = 'wb'
    ),
    stock_size_by_sku AS (
      SELECT
        ss.nm_id,
        COALESCE(SUM(ABS(ss.lost_orders_count)), 0)::numeric as lost_orders_count,
        COALESCE(SUM(ABS(ss.lost_orders_sum)), 0)::numeric as lost_orders_sum,
        COALESCE(
          SUM(ss.sale_rate_days * ss.stock_count) FILTER (
            WHERE ss.sale_rate_days IS NOT NULL AND ss.stock_count > 0
          ) / NULLIF(SUM(ss.stock_count) FILTER (
            WHERE ss.sale_rate_days IS NOT NULL AND ss.stock_count > 0
          ), 0),
          AVG(ss.sale_rate_days),
          0
        )::numeric as stock_days,
        COALESCE(
          SUM(ss.avg_stock_turnover_days * ss.stock_count) FILTER (
            WHERE ss.avg_stock_turnover_days IS NOT NULL AND ss.stock_count > 0
          ) / NULLIF(SUM(ss.stock_count) FILTER (
            WHERE ss.avg_stock_turnover_days IS NOT NULL AND ss.stock_count > 0
          ), 0),
          AVG(ss.avg_stock_turnover_days),
          0
        )::numeric as stock_turnover_days
      FROM raw_api_stock_sizes ss
      JOIN stock_size_latest latest ON latest.snapshot_date = ss.snapshot_date
      WHERE ss.tenant_id = ${tenantId}
        AND ss.stock_type = 'wb'
      GROUP BY ss.nm_id
    ),
    reconciliation_cutoff AS MATERIALIZED (
      SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) as cutoff
      FROM raw_api_realization_reports
      WHERE tenant_id = ${tenantId}
    ),
    latest_costs AS MATERIALIZED (
      SELECT
        cost_source.tenant_id,
        cost_source.nm_id,
        (${sql.raw(buildPurchaseCostSql("mi", "c.cost_price"))})::numeric as purchase_price,
        (${sql.raw(buildFullLandedCostSql("mi", "c.cost_price"))})::numeric as full_cost
      FROM (
        SELECT tenant_id, nm_id FROM unit_economics_configs WHERE tenant_id = ${tenantId}
        UNION
        SELECT tenant_id, nm_id FROM unit_economics_manual_inputs WHERE tenant_id = ${tenantId}
      ) cost_source
      LEFT JOIN LATERAL (
        SELECT cost_price
        FROM unit_economics_configs
        WHERE tenant_id = cost_source.tenant_id
          AND nm_id = cost_source.nm_id
        ORDER BY effective_from DESC
        LIMIT 1
      ) c ON true
      LEFT JOIN unit_economics_manual_inputs mi
        ON mi.tenant_id = cost_source.tenant_id
       AND mi.nm_id = cost_source.nm_id
    ),
    sku_operational_tail_rates AS MATERIALIZED (
      SELECT
        r.nm_id,
        ${sql.raw(buildOperationalTailRatesSelectSql("r"))}
      FROM raw_api_realization_reports r
      WHERE r.tenant_id = ${tenantId}
        AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
        ${realizationGroupFilter}
      GROUP BY r.nm_id
    ),
    unified_sales AS (
      -- FINAL DATA sourced from mv_daily_pnl_final (pre-aggregated per day+nm_id).
      -- total_cost = quantity_for_cost × full landed cost, computed at read time.
      SELECT
        mv.nm_id,
        mv.quantity_for_cost::int as sold_quantity,
        mv.revenue as gross_revenue,
        mv.spp_rub as spp,
        mv.tax_base_revenue as tax_base_revenue,
        mv.payout_before_cost as payout_before_cost,
        mv.commission as commission,
        mv.logistics as logistics,
        mv.other_fees as other_fees,
        (mv.quantity_for_cost * COALESCE(c.full_cost, 0)) as total_cost
      FROM mv_daily_pnl_final mv
      LEFT JOIN latest_costs c ON c.nm_id = mv.nm_id
      WHERE mv.tenant_id = ${tenantId}
        AND mv.day >= ${from}::date
        AND mv.day < ${toExclusive}::date

      ${includeProvisionalTail ? sql`
        UNION ALL

        SELECT
          s.nm_id,
          1 as sold_quantity,
          s.price_with_discount as gross_revenue,
          0 as spp,
          s.price_with_discount as tax_base_revenue,
          ((${sql.raw(buildOperationalTailPayoutBeforeCostSql("s.price_with_discount", "m"))})) as payout_before_cost,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "commission_rate"))})) as commission,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "logistics_rate"))})) as logistics,
          ((${sql.raw(buildOperationalTailOtherFeesSql("s.price_with_discount", "m"))})) as other_fees,
          COALESCE(c.full_cost, 0) as total_cost
        FROM raw_api_sales s
        CROSS JOIN reconciliation_cutoff rc
        LEFT JOIN sku_operational_tail_rates m ON m.nm_id = s.nm_id
        LEFT JOIN latest_costs c ON c.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.date::date > rc.cutoff::date
          AND s.date >= ${from}::timestamp
          AND s.date < ${toExclusive}::timestamp
          AND s.is_storno = false
          ${salesGroupFilter}
      ` : sql``}
    ),
    sales_agg AS (
      SELECT
        u.nm_id,
        SUM(u.sold_quantity)::int as sold_quantity,
        SUM(u.gross_revenue)::numeric as gross_revenue,
        SUM(u.spp)::numeric as spp,
        SUM(u.tax_base_revenue)::numeric as tax_base_revenue,
        SUM(u.payout_before_cost)::numeric as payout_before_cost,
        SUM(u.commission)::numeric as commission,
        SUM(u.logistics)::numeric as logistics,
        SUM(u.other_fees)::numeric as other_fees,
        SUM(u.total_cost)::numeric as total_cost
      FROM unified_sales u
      GROUP BY u.nm_id
    ),
    ${skuPoolCte}
    product_base AS (
      SELECT
        s.nm_id,
        p.photo_url as photo_url,
        p.brand as brand,
        p.barcode as barcode,
        p.category as category,
        p.vendor_code as vendor_code,
        COALESCE(sa.sold_quantity, 0)::int as sold_quantity,
        COALESCE(sa.gross_revenue, 0)::numeric as gross_revenue,
        COALESCE(sa.spp, 0)::numeric as spp,
        COALESCE(sa.tax_base_revenue, 0)::numeric as tax_base_revenue,
        COALESCE(sa.payout_before_cost, 0)::numeric as payout_before_cost,
        COALESCE(sa.commission, 0)::numeric as commission,
        COALESCE(sa.logistics, 0)::numeric as logistics,
        COALESCE(sa.other_fees, 0)::numeric as other_fees,
        COALESCE(sa.total_cost, 0)::numeric as total_cost,
        COALESCE(lc.purchase_price, 0)::numeric as purchase_price,
        COALESCE(lc.full_cost, lc.purchase_price, 0)::numeric as cost_price,
        t.tax_type,
        t.tax_rate,
        t.vat_mode,
        t.vat_rate,
        COALESCE(st.current_stock, 0) as current_stock,
        COALESCE(ss.lost_orders_count, 0)::numeric as lost_orders_count,
        COALESCE(ss.lost_orders_sum, 0)::numeric as lost_orders_sum,
        COALESCE(ss.stock_days, 0)::numeric as stock_days,
        COALESCE(ss.stock_turnover_days, 0)::numeric as stock_turnover_days,
        (ss.nm_id IS NOT NULL) as stock_size_available
      FROM sku_pool s
      JOIN tenants t ON t.id = ${tenantId}
      LEFT JOIN products p ON s.nm_id = p.nm_id AND p.tenant_id = t.id
      LEFT JOIN sales_agg sa ON s.nm_id = sa.nm_id
      LEFT JOIN latest_costs lc ON s.nm_id = lc.nm_id AND lc.tenant_id = t.id
      LEFT JOIN inventory st ON s.nm_id = st.nm_id
      LEFT JOIN stock_size_by_sku ss ON s.nm_id = ss.nm_id
      WHERE s.nm_id > 0
        AND COALESCE(p.is_hidden, FALSE) = FALSE
    ),
    ad_stats_costs AS (
      SELECT
        a.nm_id,
        SUM(a.amount)::numeric as ad_spend
      FROM raw_api_ad_costs a
      LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${from}::timestamp
        AND a.date < ${toExclusive}::timestamp
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${adsGroupFilter}
      GROUP BY a.nm_id
    ),
    ad_stats_clusters AS (
      SELECT
        a.nm_id,
        SUM(a.amount)::numeric as ad_spend
      FROM raw_api_ad_clusters a
      LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${from}::timestamp
        AND a.date < ${toExclusive}::timestamp
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${adsGroupFilter}
      GROUP BY a.nm_id
    ),
    ad_stats_source AS (
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM ad_stats_costs) THEN 'ad_costs'
          WHEN EXISTS (SELECT 1 FROM ad_stats_clusters) THEN 'ad_clusters'
          ELSE 'none'
        END::text as source
    ),
    ad_stats AS (
      SELECT c.nm_id, COALESCE(c.ad_spend, 0)::numeric as ad_spend
      FROM ad_stats_costs c
      CROSS JOIN ad_stats_source src
      WHERE src.source = 'ad_costs'

      UNION ALL

      SELECT cl.nm_id, COALESCE(cl.ad_spend, 0)::numeric as ad_spend
      FROM ad_stats_clusters cl
      CROSS JOIN ad_stats_source src
      WHERE src.source = 'ad_clusters'
    ),
    funnel_stats AS (
      SELECT
        f.nm_id,
        SUM(f.open_card_count) as views,
        SUM(f.add_to_cart_count) as carts,
        SUM(f.order_count)::numeric as order_count,
        SUM(f.buyout_count)::numeric as buyout_count,
        SUM(f.cancel_count)::numeric as cancel_count,
        CASE
          WHEN SUM(f.order_count) > 0 THEN (SUM(f.buyout_count)::numeric / NULLIF(SUM(f.order_count), 0)) * 100
          ELSE COALESCE(AVG(NULLIF(f.order_to_buyout_percent, 0)), 0)
        END::numeric as buyout_rate
      FROM raw_api_funnel_stats f
      LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
      WHERE f.tenant_id = ${tenantId}
        AND f.period_start = ${from}::timestamp
        AND f.period_end = ${to}::timestamp
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${funnelGroupFilter}
      GROUP BY f.nm_id
    )
    SELECT
      b.nm_id as "nmId",
      b.photo_url as "photoUrl",
      b.brand as "brand",
      b.barcode as "barcode",
      b.category as "category",
      b.vendor_code as "vendorCode",
      b.sold_quantity as "soldQuantity",
      (b.gross_revenue + b.spp) as "grossRevenue",
      b.gross_revenue as "realizedRevenue",
      b.spp as "spp",
      b.tax_base_revenue as "taxBaseRevenue",
      b.payout_before_cost as "payoutBeforeCost",
      b.commission as "commission",
      b.logistics as "logistics",
      b.other_fees as "otherFees",
      b.total_cost as "totalCost",
      b.purchase_price as "purchasePrice",
      b.cost_price as "costPrice",
      b.current_stock as "currentStock",
      (CASE WHEN b.sold_quantity > 0 THEN (b.current_stock::numeric / (b.sold_quantity::numeric / ${periodDays})) ELSE 999 END) as "daysOfStock",
      b.lost_orders_count as "lostOrdersCount",
      b.lost_orders_sum as "lostOrdersSum",
      b.stock_days as "stockAnalyticsDays",
      b.stock_turnover_days as "stockTurnoverDays",
      b.stock_size_available as "stockSizeAvailable",
      COALESCE(a.ad_spend, 0) as "adSpend",
      CAST(${calculationMode} AS text) as "calculationMode",
      COALESCE(f.views, 0) as "views",
      COALESCE(f.carts, 0) as "carts",
      COALESCE(f.order_count, 0) as "orderCount",
      COALESCE(f.buyout_count, 0) as "buyoutCount",
      COALESCE(f.cancel_count, 0) as "cancelCount",
      COALESCE(f.buyout_rate, 0) as "buyoutRate",
      ${sql.raw(unitProfitBeforeTaxExpr)} as "opProfit",
      ${sql.raw(`(${unitNetProfitExpr})::numeric`)} as "netProfit"
    FROM product_base b
    LEFT JOIN ad_stats a ON b.nm_id = a.nm_id
    LEFT JOIN funnel_stats f ON b.nm_id = f.nm_id
    ORDER BY "netProfit" ASC
  `;

  return await withTenantContext(db, tenantId, async (tx) => {
    await tx.execute(sql`SET LOCAL jit = off`);
    return tx.execute(query);
  }) as UnitEconomicsRow[];
}

export async function getNetProfitBreakdown(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  nmId?: number | null,
  _options?: AnalyticsScopeOptions,
) {
  const from = getUtcDayStart(dateFrom).toISOString();
  const toExclusive = getUtcNextDayStart(dateTo).toISOString();
  // Always include provisional tail so profit report includes operational data
  // for days after the last realization report, consistent with KPI cards.
  // calculationMode accepted for API compatibility but not yet applied here.
  const includeProvisionalTail = true;
  const groupId = normalizeGroupId(_options?.groupId);
  const normalizedNmId = Number.isFinite(nmId) && Number(nmId) > 0 ? Math.trunc(Number(nmId)) : null;

  const realizationNmFilter = normalizedNmId ? sql`AND r.nm_id = ${normalizedNmId}` : sql``;
  const mvNmFilter = normalizedNmId ? sql`AND mv.nm_id = ${normalizedNmId}` : sql``;
  const salesNmFilter = normalizedNmId ? sql`AND s.nm_id = ${normalizedNmId}` : sql``;
  const storageNmFilter = normalizedNmId ? sql`AND st.nm_id = ${normalizedNmId}` : sql``;
  const adCostsNmFilter = normalizedNmId ? sql`AND a.nm_id = ${normalizedNmId}` : sql``;
  const adClustersNmFilter = normalizedNmId ? sql`AND a.nm_id = ${normalizedNmId}` : sql``;
  const costNmFilter = normalizedNmId ? sql`AND nm_id = ${normalizedNmId}` : sql``;
  const finalNmFilter = normalizedNmId ? sql`AND b.nm_id = ${normalizedNmId}` : sql``;
  const realizationGroupFilter = groupScopeFilter(tenantId, groupId, "r.nm_id");
  const mvGroupFilter = groupScopeFilter(tenantId, groupId, "mv.nm_id");
  const salesGroupFilter = groupScopeFilter(tenantId, groupId, "s.nm_id");
  const storageGroupFilter = groupScopeFilter(tenantId, groupId, "st.nm_id");
  const adCostsGroupFilter = groupScopeFilter(tenantId, groupId, "a.nm_id");
  const adClustersGroupFilter = groupScopeFilter(tenantId, groupId, "a.nm_id");
  const finalGroupFilter = groupScopeFilter(tenantId, groupId, "b.nm_id");

  const profitBeforeTaxExpr = "b.payout_before_cost - b.cost_total - b.ad_spend";
  const taxAmountExpr = buildTaxAmountSql({
    taxTypeExpr: "t.tax_type",
    taxRateExpr: "t.tax_rate",
    vatModeExpr: "t.vat_mode",
    vatRateExpr: "t.vat_rate",
    revenueExpr: "b.tax_base_revenue",
    profitBeforeTaxExpr,
  });
  const netProfitExpr = buildNetProfitSql({
    taxTypeExpr: "t.tax_type",
    taxRateExpr: "t.tax_rate",
    vatModeExpr: "t.vat_mode",
    vatRateExpr: "t.vat_rate",
    revenueExpr: "b.tax_base_revenue",
    profitBeforeTaxExpr,
  });

  const [tenantTaxRow] = await db.execute(sql`
    SELECT
      tax_type as "taxType",
      tax_rate as "taxRate",
      vat_mode as "vatMode",
      vat_rate as "vatRate"
    FROM tenants
    WHERE id = ${tenantId}
    LIMIT 1
  `) as Array<{ taxType: string; taxRate: string; vatMode: string; vatRate: string }>;

  const rows = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
    WITH reconciliation_cutoff AS (
      SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) AS cutoff
      FROM raw_api_realization_reports
      WHERE tenant_id = ${tenantId}
    ),
    sku_operational_tail_rates AS MATERIALIZED (
      SELECT
        r.nm_id,
        ${sql.raw(buildOperationalTailRatesSelectSql("r"))}
      FROM raw_api_realization_reports r
      WHERE r.tenant_id = ${tenantId}
        AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
        ${realizationNmFilter}
        ${realizationGroupFilter}
      GROUP BY r.nm_id
    ),
    latest_costs AS MATERIALIZED (
      SELECT
        cost_source.tenant_id,
        cost_source.nm_id,
        (${sql.raw(buildFullLandedCostSql("mi", "c.cost_price"))})::numeric as full_cost
      FROM (
        SELECT tenant_id, nm_id FROM unit_economics_configs WHERE tenant_id = ${tenantId} ${costNmFilter}
        UNION
        SELECT tenant_id, nm_id FROM unit_economics_manual_inputs WHERE tenant_id = ${tenantId} ${costNmFilter}
      ) cost_source
      LEFT JOIN LATERAL (
        SELECT cost_price
        FROM unit_economics_configs
        WHERE tenant_id = cost_source.tenant_id
          AND nm_id = cost_source.nm_id
        ORDER BY effective_from DESC
        LIMIT 1
      ) c ON true
      LEFT JOIN unit_economics_manual_inputs mi
        ON mi.tenant_id = cost_source.tenant_id
       AND mi.nm_id = cost_source.nm_id
    ),
    unified_sales AS (
      SELECT
        mv.nm_id,
        mv.quantity_for_cost::int AS sold_quantity,
        mv.revenue::numeric AS gross_revenue,
        mv.spp_rub::numeric AS spp,
        mv.tax_base_revenue::numeric AS tax_base_revenue,
        mv.payout_before_cost::numeric AS payout_before_cost,
        mv.commission::numeric AS commission,
        mv.logistics::numeric AS logistics,
        mv.other_fees::numeric AS other_fees,
        mv.storage_fee::numeric AS wb_storage_fee,
        0::numeric AS wb_penalty,
        0::numeric AS wb_payment_schedule,
        0::numeric AS wb_deduction,
        0::numeric AS wb_deduction_credit_principal,
        0::numeric AS wb_deduction_credit_interest,
        0::numeric AS wb_acquiring_fee,
        0::numeric AS wb_additional_payment,
        0::numeric AS provisional_other_fees,
        (mv.quantity_for_cost * COALESCE(c.full_cost, 0))::numeric AS cost_total
      FROM mv_daily_pnl_final mv
      LEFT JOIN latest_costs c ON c.tenant_id = ${tenantId} AND c.nm_id = mv.nm_id
      WHERE mv.tenant_id = ${tenantId}
        AND mv.day >= ${from}::date
        AND mv.day < ${toExclusive}::date
        ${mvNmFilter}
        ${mvGroupFilter}
      ${includeProvisionalTail ? sql`
        UNION ALL
        SELECT
          s.nm_id,
          1::int AS sold_quantity,
          s.price_with_discount::numeric AS gross_revenue,
          0::numeric AS spp,
          s.price_with_discount::numeric AS tax_base_revenue,
          ((${sql.raw(buildOperationalTailPayoutBeforeCostSql("s.price_with_discount", "m"))}))::numeric AS payout_before_cost,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "commission_rate"))}))::numeric AS commission,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "logistics_rate"))}))::numeric AS logistics,
          ((${sql.raw(buildOperationalTailOtherFeesSql("s.price_with_discount", "m"))}))::numeric AS other_fees,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "wb_storage_fee_rate"))}))::numeric AS wb_storage_fee,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "penalty_rate"))}))::numeric AS wb_penalty,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "payment_schedule_rate"))}))::numeric AS wb_payment_schedule,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "deduction_rate"))}))::numeric AS wb_deduction,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "credit_principal_rate"))}))::numeric AS wb_deduction_credit_principal,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "credit_interest_rate"))}))::numeric AS wb_deduction_credit_interest,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "acquiring_rate"))}))::numeric AS wb_acquiring_fee,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "additional_payment_rate"))}))::numeric AS wb_additional_payment,
          ((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "residual_rate", 0.25))}))::numeric AS provisional_other_fees,
          COALESCE(c.full_cost, 0)::numeric AS cost_total
        FROM raw_api_sales s
        CROSS JOIN reconciliation_cutoff rc
        LEFT JOIN sku_operational_tail_rates m ON m.nm_id = s.nm_id
        LEFT JOIN latest_costs c ON c.tenant_id = s.tenant_id AND c.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.date::date > rc.cutoff::date
          AND s.date >= ${from}::timestamp
          AND s.date < ${toExclusive}::timestamp
          AND s.is_storno = false
          ${salesNmFilter}
          ${salesGroupFilter}
      ` : sql``}
    ),
    sales_agg AS (
      SELECT
        nm_id,
        COALESCE(SUM(sold_quantity), 0)::int AS sold_quantity,
        COALESCE(SUM(gross_revenue), 0)::numeric AS gross_revenue,
        COALESCE(SUM(spp), 0)::numeric AS spp,
        COALESCE(SUM(tax_base_revenue), 0)::numeric AS tax_base_revenue,
        COALESCE(SUM(payout_before_cost), 0)::numeric AS payout_before_cost,
        COALESCE(SUM(commission), 0)::numeric AS commission,
        COALESCE(SUM(logistics), 0)::numeric AS logistics,
        COALESCE(SUM(other_fees), 0)::numeric AS other_fees,
        COALESCE(SUM(wb_storage_fee), 0)::numeric AS wb_storage_fee,
        COALESCE(SUM(wb_penalty), 0)::numeric AS wb_penalty,
        COALESCE(SUM(wb_payment_schedule), 0)::numeric AS wb_payment_schedule,
        COALESCE(SUM(wb_deduction), 0)::numeric AS wb_deduction,
        COALESCE(SUM(wb_deduction_credit_principal), 0)::numeric AS wb_deduction_credit_principal,
        COALESCE(SUM(wb_deduction_credit_interest), 0)::numeric AS wb_deduction_credit_interest,
        COALESCE(SUM(wb_acquiring_fee), 0)::numeric AS wb_acquiring_fee,
        COALESCE(SUM(wb_additional_payment), 0)::numeric AS wb_additional_payment,
        COALESCE(SUM(provisional_other_fees), 0)::numeric AS provisional_other_fees,
        COALESCE(SUM(cost_total), 0)::numeric AS cost_total
      FROM unified_sales
      GROUP BY nm_id
    ),
    fee_components AS (
      SELECT
        r.nm_id,
        COALESCE(SUM(r.storage_fee_rub), 0)::numeric AS wb_storage_fee,
        COALESCE(SUM(r.penalty_rub), 0)::numeric AS wb_penalty,
        COALESCE(SUM(r.payment_schedule_rub), 0)::numeric AS wb_payment_schedule,
        COALESCE(SUM((${sql.raw(buildWbDeductionExpenseSql("r"))})), 0)::numeric AS wb_deduction,
        COALESCE(SUM((${sql.raw(buildWbCreditPrincipalDeductionSql("r"))})), 0)::numeric AS wb_deduction_credit_principal,
        COALESCE(SUM((${sql.raw(buildWbCreditInterestDeductionSql("r"))})), 0)::numeric AS wb_deduction_credit_interest,
        COALESCE(SUM(r.acquiring_fee), 0)::numeric AS wb_acquiring_fee,
        0::numeric AS wb_additional_payment -- возмещение перевозки исключено из P&L (см. migration 0107)
      FROM raw_api_realization_reports r
      WHERE r.tenant_id = ${tenantId}
        AND COALESCE(r.sale_dt, r.date_from) >= ${from}::timestamp
        AND COALESCE(r.sale_dt, r.date_from) < ${toExclusive}::timestamp
        ${realizationNmFilter}
        ${realizationGroupFilter}
      GROUP BY r.nm_id
    ),
    storage_agg AS (
      SELECT
        st.nm_id,
        COALESCE(SUM(st.storage_amount), 0)::numeric AS storage_cost
      FROM raw_api_paid_storage st
      WHERE st.tenant_id = ${tenantId}
        AND st.date >= ${from}::timestamp
        AND st.date < ${toExclusive}::timestamp
        ${storageNmFilter}
        ${storageGroupFilter}
      GROUP BY st.nm_id
    ),
    storage_source AS (
      SELECT
        COUNT(*)::int AS storage_rows
      FROM raw_api_paid_storage st
      WHERE st.tenant_id = ${tenantId}
        AND st.date >= ${from}::timestamp
        AND st.date < ${toExclusive}::timestamp
        ${storageNmFilter}
        ${storageGroupFilter}
    ),
    ad_costs AS (
      SELECT
        a.nm_id,
        COALESCE(SUM(a.amount), 0)::numeric AS ad_spend
      FROM raw_api_ad_costs a
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${from}::timestamp
        AND a.date < ${toExclusive}::timestamp
        ${adCostsNmFilter}
        ${adCostsGroupFilter}
      GROUP BY a.nm_id
    ),
    ad_clusters AS (
      SELECT
        a.nm_id,
        COALESCE(SUM(a.amount), 0)::numeric AS ad_spend
      FROM raw_api_ad_clusters a
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${from}::timestamp
        AND a.date < ${toExclusive}::timestamp
        ${adClustersNmFilter}
        ${adClustersGroupFilter}
      GROUP BY a.nm_id
    ),
    ad_source AS (
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM ad_costs) THEN 'ad_costs'
          WHEN EXISTS (SELECT 1 FROM ad_clusters) THEN 'ad_clusters'
          ELSE 'none'
        END::text AS source
    ),
    ad_agg AS (
      SELECT c.nm_id, COALESCE(c.ad_spend, 0)::numeric AS ad_spend
      FROM ad_costs c
      CROSS JOIN ad_source src
      WHERE src.source = 'ad_costs'

      UNION ALL

      SELECT cl.nm_id, COALESCE(cl.ad_spend, 0)::numeric AS ad_spend
      FROM ad_clusters cl
      CROSS JOIN ad_source src
      WHERE src.source = 'ad_clusters'
    ),
    sku_pool AS (
      SELECT nm_id FROM sales_agg
      UNION
      SELECT nm_id FROM fee_components
      UNION
      SELECT nm_id FROM storage_agg
      UNION
      SELECT nm_id FROM ad_agg
    ),
    sku_base AS (
      SELECT
        sp.nm_id,
        p.brand,
        p.vendor_code,
        p.photo_url,
        p.barcode,
        p.category,
        COALESCE(sa.sold_quantity, 0)::int AS sold_quantity,
        COALESCE(sa.gross_revenue, 0)::numeric AS gross_revenue,
        COALESCE(sa.spp, 0)::numeric AS spp,
        COALESCE(sa.tax_base_revenue, 0)::numeric AS tax_base_revenue,
        COALESCE(sa.payout_before_cost, 0)::numeric AS payout_before_cost,
        COALESCE(sa.commission, 0)::numeric AS commission,
        COALESCE(sa.logistics, 0)::numeric AS logistics,
        (
          COALESCE(sa.other_fees, 0)
          - COALESCE(fc.wb_storage_fee, sa.wb_storage_fee, 0)
        )::numeric AS other_fees,
        COALESCE(fc.wb_storage_fee, sa.wb_storage_fee, 0)::numeric AS wb_storage_fee,
        COALESCE(fc.wb_penalty, sa.wb_penalty, 0)::numeric AS wb_penalty,
        COALESCE(fc.wb_payment_schedule, sa.wb_payment_schedule, 0)::numeric AS wb_payment_schedule,
        COALESCE(fc.wb_deduction, sa.wb_deduction, 0)::numeric AS wb_deduction,
        COALESCE(fc.wb_deduction_credit_principal, sa.wb_deduction_credit_principal, 0)::numeric AS wb_deduction_credit_principal,
        COALESCE(fc.wb_deduction_credit_interest, sa.wb_deduction_credit_interest, 0)::numeric AS wb_deduction_credit_interest,
        COALESCE(fc.wb_acquiring_fee, sa.wb_acquiring_fee, 0)::numeric AS wb_acquiring_fee,
        COALESCE(fc.wb_additional_payment, sa.wb_additional_payment, 0)::numeric AS wb_additional_payment,
        COALESCE(sa.provisional_other_fees, 0)::numeric AS provisional_other_fees,
        COALESCE(sa.cost_total, 0)::numeric AS cost_total,
        CASE
          WHEN (SELECT storage_rows FROM storage_source) > 0
            THEN COALESCE(st.storage_cost, 0)
          ELSE COALESCE(fc.wb_storage_fee, sa.wb_storage_fee, 0)
        END::numeric AS storage_cost,
        CASE
          WHEN (SELECT storage_rows FROM storage_source) > 0
            THEN 'paid_storage'
          ELSE 'finance_storage_fee'
        END::text AS storage_source,
        COALESCE(a.ad_spend, 0)::numeric AS ad_spend,
        c.full_cost::numeric AS purchase_price
      FROM sku_pool sp
      LEFT JOIN sales_agg sa ON sa.nm_id = sp.nm_id
      LEFT JOIN fee_components fc ON fc.nm_id = sp.nm_id
      LEFT JOIN storage_agg st ON st.nm_id = sp.nm_id
      LEFT JOIN ad_agg a ON a.nm_id = sp.nm_id
      LEFT JOIN products p ON p.tenant_id = ${tenantId} AND p.nm_id = sp.nm_id
      LEFT JOIN latest_costs c ON c.tenant_id = ${tenantId} AND c.nm_id = sp.nm_id
      WHERE COALESCE(p.is_hidden, FALSE) = FALSE
    )
    SELECT
      b.nm_id as "nmId",
      b.brand as "brand",
      b.vendor_code as "vendorCode",
      b.barcode as "barcode",
      b.category as "category",
      b.photo_url as "photoUrl",
      b.sold_quantity as "soldQuantity",
      (b.gross_revenue + b.spp) as "grossRevenue",
      b.gross_revenue as "realizedRevenue",
      b.spp as "spp",
      b.tax_base_revenue as "taxBaseRevenue",
      b.payout_before_cost as "payoutBeforeCost",
      b.commission as "commission",
      b.logistics as "logistics",
      b.other_fees as "otherFees",
      b.wb_storage_fee as "wbStorageFee",
      b.wb_penalty as "wbPenalty",
      b.wb_payment_schedule as "wbPaymentSchedule",
      b.wb_deduction as "wbDeduction",
      b.wb_deduction_credit_principal as "wbDeductionCreditPrincipal",
      b.wb_deduction_credit_interest as "wbDeductionCreditInterest",
      b.wb_acquiring_fee as "wbAcquiringFee",
      b.wb_additional_payment as "wbAdditionalPayment",
      b.provisional_other_fees as "provisionalOtherFees",
      b.cost_total as "costTotal",
      b.storage_cost as "storageCost",
      b.storage_source as "storageSource",
      b.ad_spend as "adSpend",
      b.purchase_price as "purchasePrice",
      ${sql.raw(`(${profitBeforeTaxExpr})::numeric`)} as "profitBeforeTax",
      ${sql.raw(`(${taxAmountExpr})::numeric`)} as "taxAmount",
      ${sql.raw(`(${netProfitExpr})::numeric`)} as "netProfit"
    FROM sku_base b
    JOIN tenants t ON t.id = ${tenantId}
    WHERE (
      ABS(b.gross_revenue)
      + ABS(b.payout_before_cost)
      + ABS(b.commission)
      + ABS(b.logistics)
      + ABS(b.other_fees)
      + ABS(b.wb_storage_fee)
      + ABS(b.wb_penalty)
      + ABS(b.wb_payment_schedule)
      + ABS(b.wb_deduction)
      + ABS(b.wb_deduction_credit_principal)
      + ABS(b.wb_deduction_credit_interest)
      + ABS(b.wb_acquiring_fee)
      + ABS(b.wb_additional_payment)
      + ABS(b.provisional_other_fees)
      + ABS(b.cost_total)
      + ABS(b.storage_cost)
      + ABS(b.ad_spend)
    ) > 0
    ${finalNmFilter}
    ${finalGroupFilter}
    ORDER BY "netProfit" ASC, "grossRevenue" DESC, "nmId" ASC
  `)) as Array<Record<string, unknown>>;

  const toNum = (value: unknown) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const toNullableNum = (value: unknown) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const toText = (value: unknown) => {
    if (value === null || value === undefined) {
      return null;
    }

    const text = String(value).trim();
    return text.length > 0 ? text : null;
  };

  const deductionRows = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
    SELECT
      r.realizationreport_id AS "reportId",
      COALESCE(r.sale_dt, r.date_from)::date::text AS "date",
      COALESCE(NULLIF(r.supplier_oper_name, ''), 'Удержание') AS "operation",
      NULLIF(r.doc_type_name, '') AS "docType",
      COALESCE(
        NULLIF(r.bonus_type_name, ''),
        NULLIF(r.supplier_oper_name, ''),
        NULLIF(r.doc_type_name, ''),
        'Без расшифровки в сохраненных данных'
      ) AS "reason",
      (${sql.raw(buildWbDeductionKindSql("r"))})::text AS "creditKind",
      r.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      COUNT(*)::int AS "rowCount",
      MIN(r.rrd_id)::text AS "firstRrdId",
      COALESCE(SUM(r.deduction), 0)::numeric AS "amount",
      COALESCE(SUM((${sql.raw(buildWbDeductionExpenseSql("r"))})), 0)::numeric AS "amountExpense",
      COALESCE(SUM((${sql.raw(buildWbCreditPrincipalDeductionSql("r"))})), 0)::numeric AS "amountCreditPrincipal",
      COALESCE(SUM((${sql.raw(buildWbCreditInterestDeductionSql("r"))})), 0)::numeric AS "amountCreditInterest"
    FROM raw_api_realization_reports r
    LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
    WHERE r.tenant_id = ${tenantId}
      AND COALESCE(r.sale_dt, r.date_from) >= ${from}::timestamp
      AND COALESCE(r.sale_dt, r.date_from) < ${toExclusive}::timestamp
      AND COALESCE(r.deduction, 0) <> 0
      ${realizationNmFilter}
      ${realizationGroupFilter}
    GROUP BY
      r.realizationreport_id,
      COALESCE(r.sale_dt, r.date_from)::date,
      COALESCE(NULLIF(r.supplier_oper_name, ''), 'Удержание'),
      NULLIF(r.doc_type_name, ''),
      COALESCE(
        NULLIF(r.bonus_type_name, ''),
        NULLIF(r.supplier_oper_name, ''),
        NULLIF(r.doc_type_name, ''),
        'Без расшифровки в сохраненных данных'
      ),
      (${sql.raw(buildWbDeductionKindSql("r"))}),
      r.nm_id,
      p.vendor_code
    ORDER BY SUM(r.deduction) DESC, COALESCE(r.sale_dt, r.date_from)::date DESC
    LIMIT 300
  `)) as Array<Record<string, unknown>>;

  const deductionDetails = deductionRows.map((row) => ({
    reportId: toNum(row.reportId),
    date: toText(row.date),
    operation: toText(row.operation),
    docType: toText(row.docType),
    reason: toText(row.reason) ?? "Без расшифровки в сохраненных данных",
    creditKind: toText(row.creditKind) ?? "other",
    nmId: toNum(row.nmId),
    vendorCode: toText(row.vendorCode),
    rowCount: toNum(row.rowCount),
    firstRrdId: toText(row.firstRrdId),
    amount: toNum(row.amount),
    amountExpense: toNum(row.amountExpense),
    amountCreditPrincipal: toNum(row.amountCreditPrincipal),
    amountCreditInterest: toNum(row.amountCreditInterest),
  }));

  const items = rows.map((row) => {
    const soldQuantity = toNum(row.soldQuantity);
    const commission = toNum(row.commission);
    const logistics = toNum(row.logistics);
    const otherFees = toNum(row.otherFees);
    const wbStorageFee = toNum(row.wbStorageFee);
    const wbPenalty = toNum(row.wbPenalty);
    const wbPaymentSchedule = toNum(row.wbPaymentSchedule);
    const wbDeduction = toNum(row.wbDeduction);
    const wbDeductionCreditPrincipal = toNum(row.wbDeductionCreditPrincipal);
    const wbDeductionCreditInterest = toNum(row.wbDeductionCreditInterest);
    const wbAcquiringFee = toNum(row.wbAcquiringFee);
    const wbAdditionalPayment = toNum(row.wbAdditionalPayment);
    const provisionalOtherFees = toNum(row.provisionalOtherFees);
    const costTotal = toNum(row.costTotal);
    const storageCost = toNum(row.storageCost);
    const storageSource = typeof row.storageSource === "string" ? row.storageSource : "finance_storage_fee";
    const payoutBeforeCost = toNum(row.payoutBeforeCost);
    const purchasePrice = toNullableNum(row.purchasePrice);
    const fullCostPerUnit = soldQuantity > 0
      ? (costTotal + commission + logistics + storageCost + otherFees) / soldQuantity
      : null;

    return {
      nmId: toNum(row.nmId),
      brand: typeof row.brand === "string" ? row.brand : null,
      vendorCode: typeof row.vendorCode === "string" ? row.vendorCode : null,
      barcode: typeof row.barcode === "string" ? row.barcode : null,
      category: typeof row.category === "string" ? row.category : null,
      photoUrl: typeof row.photoUrl === "string" ? row.photoUrl : null,
      soldQuantity,
      unitsSold: soldQuantity,
      grossRevenue: toNum(row.grossRevenue),
      realizedRevenue: toNum(row.realizedRevenue),
      spp: toNum(row.spp),
      taxBaseRevenue: toNum(row.taxBaseRevenue),
      payoutBeforeCost,
      commission,
      logistics,
      otherFees,
      wbStorageFee,
      wbPenalty,
      wbPaymentSchedule,
      wbDeduction,
      wbDeductionCreditPrincipal,
      wbDeductionCreditInterest,
      wbAcquiringFee,
      wbAdditionalPayment,
      provisionalOtherFees,
      costTotal,
      storageCost,
      storageSource,
      adSpend: toNum(row.adSpend),
      purchasePrice,
      costPerUnit: purchasePrice ?? (soldQuantity > 0 ? costTotal / soldQuantity : null),
      fullCostPerUnit,
      profitBeforeTax: toNum(row.profitBeforeTax),
      taxAmount: toNum(row.taxAmount),
      netProfit: toNum(row.netProfit),
    };
  });

  const totals = items.reduce((acc, row) => {
    acc.soldQuantity += row.soldQuantity;
    acc.grossRevenue += row.grossRevenue;
    acc.realizedRevenue += row.realizedRevenue;
    acc.spp += row.spp;
    acc.taxBaseRevenue += row.taxBaseRevenue;
    acc.payoutBeforeCost += row.payoutBeforeCost;
    acc.commission += row.commission;
    acc.logistics += row.logistics;
    acc.otherFees += row.otherFees;
    acc.wbStorageFee += row.wbStorageFee;
    acc.wbPenalty += row.wbPenalty;
    acc.wbPaymentSchedule += row.wbPaymentSchedule;
    acc.wbDeduction += row.wbDeduction;
    acc.wbDeductionCreditPrincipal += row.wbDeductionCreditPrincipal;
    acc.wbDeductionCreditInterest += row.wbDeductionCreditInterest;
    acc.wbAcquiringFee += row.wbAcquiringFee;
    acc.wbAdditionalPayment += row.wbAdditionalPayment;
    acc.provisionalOtherFees += row.provisionalOtherFees;
    acc.costTotal += row.costTotal;
    acc.storageCost += row.storageCost;
    acc.adSpend += row.adSpend;
    acc.profitBeforeTax += row.profitBeforeTax;
    acc.taxAmount += row.taxAmount;
    acc.netProfit += row.netProfit;
    return acc;
  }, {
    soldQuantity: 0,
    grossRevenue: 0,
    realizedRevenue: 0,
    spp: 0,
    taxBaseRevenue: 0,
    payoutBeforeCost: 0,
    commission: 0,
    logistics: 0,
    otherFees: 0,
    wbStorageFee: 0,
    wbPenalty: 0,
    wbPaymentSchedule: 0,
    wbDeduction: 0,
    wbDeductionCreditPrincipal: 0,
    wbDeductionCreditInterest: 0,
    wbAcquiringFee: 0,
    wbAdditionalPayment: 0,
    provisionalOtherFees: 0,
    costTotal: 0,
    storageCost: 0,
    adSpend: 0,
    profitBeforeTax: 0,
    taxAmount: 0,
    netProfit: 0,
  });

  const taxRatePercent = Number(tenantTaxRow?.taxRate ?? 0);
  const vatRatePercent = Number(tenantTaxRow?.vatRate ?? 0);
  return {
    taxType: tenantTaxRow?.taxType ?? "usn_income",
    taxRatePercent: Number.isFinite(taxRatePercent) ? taxRatePercent : 0,
    vatMode: tenantTaxRow?.vatMode ?? "none",
    vatRatePercent: Number.isFinite(vatRatePercent) ? vatRatePercent : 0,
    totals,
    items,
    deductionDetails,
  };
}

/**
 * Топ/аутсайдеры SKU по количеству заказов из воронки (snapshot) за выбранный период.
 * Используем тот же snapshot-контур, что и KPI-карточка заказов, чтобы значения совпадали.
 */
export async function getOrderHighlights(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  options?: { groupId?: string | null },
) {
  const from = getUtcDayStart(dateFrom).toISOString();
  const to = getUtcDayStart(dateTo).toISOString();
  const groupId = normalizeGroupId(options?.groupId);
  const funnelGroupFilter = groupScopeFilter(tenantId, groupId, "f.nm_id");
  const requestedDayCount = Math.floor(
    (getUtcDayStart(dateTo).getTime() - getUtcDayStart(dateFrom).getTime())
    / 86_400_000
  ) + 1;

  const query = sql`
    WITH selected_period_funnel_anchor AS (
      SELECT MAX(f.period_end::date) AS period_end
      FROM raw_api_funnel_stats f
      LEFT JOIN products p
        ON p.tenant_id = f.tenant_id
       AND p.nm_id = f.nm_id
      WHERE f.tenant_id = ${tenantId}
        AND f.period_start::date = ${from}::date
        AND f.period_end::date <= ${to}::date
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${funnelGroupFilter}
    ),
    daily_exact_cover AS (
      SELECT
        COUNT(DISTINCT f.period_start::date)::int AS covered_days
      FROM raw_api_funnel_stats f
      LEFT JOIN products p
        ON p.tenant_id = f.tenant_id
       AND p.nm_id = f.nm_id
      WHERE f.tenant_id = ${tenantId}
        AND f.period_start::date = f.period_end::date
        AND f.period_start::date >= ${from}::date
        AND f.period_start::date <= ${to}::date
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${funnelGroupFilter}
    ),
    daily_exact_orders AS (
      SELECT
        f.nm_id,
        COALESCE(SUM(f.order_count), 0)::int AS sold_quantity,
        COALESCE(SUM(f.order_sum), 0)::numeric AS gross_revenue
      FROM raw_api_funnel_stats f
      LEFT JOIN products p
        ON p.tenant_id = f.tenant_id
       AND p.nm_id = f.nm_id
      WHERE f.tenant_id = ${tenantId}
        AND f.period_start::date = f.period_end::date
        AND f.period_start::date >= ${from}::date
        AND f.period_start::date <= ${to}::date
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${funnelGroupFilter}
      GROUP BY f.nm_id
    ),
    selected_period_orders AS (
      SELECT
        f.nm_id,
        COALESCE(SUM(f.order_count), 0)::int AS sold_quantity,
        COALESCE(SUM(f.order_sum), 0)::numeric AS gross_revenue
      FROM raw_api_funnel_stats f
      CROSS JOIN selected_period_funnel_anchor anchor
      LEFT JOIN products p
        ON p.tenant_id = f.tenant_id
       AND p.nm_id = f.nm_id
      WHERE f.tenant_id = ${tenantId}
        AND f.period_start::date = ${from}::date
        AND f.period_end::date = anchor.period_end
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${funnelGroupFilter}
      GROUP BY f.nm_id
    ),
    mode AS (
      SELECT
        (COALESCE((SELECT covered_days FROM daily_exact_cover), 0) = ${requestedDayCount}) AS use_daily,
        ((SELECT period_end FROM selected_period_funnel_anchor) = ${to}::date) AS use_selected
    ),
    order_agg AS (
      SELECT d.nm_id, d.sold_quantity, d.gross_revenue
      FROM daily_exact_orders d
      CROSS JOIN mode m
      WHERE m.use_daily
      UNION ALL
      SELECT s.nm_id, s.sold_quantity, s.gross_revenue
      FROM selected_period_orders s
      CROSS JOIN mode m
      WHERE (NOT m.use_daily) AND m.use_selected
    )
    SELECT
      oa.nm_id AS "nmId",
      p.photo_url AS "photoUrl",
      p.brand AS "brand",
      p.vendor_code AS "vendorCode",
      oa.sold_quantity AS "soldQuantity",
      oa.gross_revenue AS "grossRevenue"
    FROM order_agg oa
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = oa.nm_id
    WHERE oa.sold_quantity > 0
      AND COALESCE(p.is_hidden, FALSE) = FALSE
  `;

  return await withTenantContext(db, tenantId, async (tx) => tx.execute(query));
}

/**
 * Общие KPI для дашборда с расчетом Трендов (Vs прошлый период)
 */
export async function getKpis(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  options?: AnalyticsScopeOptions,
) {
   const currentFrom = getUtcDayStart(dateFrom);
   const currentTo = getUtcDayStart(dateTo);
   const previousRange = resolvePreviousPeriodRange(currentFrom, currentTo);
   const prevDateFrom = previousRange.from;
   const prevDateTo = previousRange.to;
   const calculationMode = resolveEconomicsCalculationMode(options?.calculationMode);
   const includeProvisionalTail = calculationMode === "PLAN_TEMPLATE";
   const groupId = normalizeGroupId(options?.groupId);
   const realizationGroupFilter = groupScopeFilter(tenantId, groupId, "r.nm_id");
   const mvGroupFilter = groupScopeFilter(tenantId, groupId, "mv.nm_id");
   const salesGroupFilter = groupScopeFilter(tenantId, groupId, "s.nm_id");
   const funnelGroupFilter = groupScopeFilter(tenantId, groupId, "f.nm_id");
   const storageGroupFilter = groupScopeFilter(tenantId, groupId, "s.nm_id");
   const adsGroupFilter = groupScopeFilter(tenantId, groupId, "a.nm_id");
   const stocksGroupFilter = groupScopeFilter(tenantId, groupId, "s.nm_id");
   const stockSizeGroupFilter = groupScopeFilter(tenantId, groupId, "ss.nm_id");
   const priceSnapshotGroupFilter = groupScopeFilter(tenantId, groupId, "ps.nm_id");
   const ordersGroupFilter = groupScopeFilter(tenantId, groupId, "r.nm_id");
   const shopOnlyScopeFilter = groupId ? sql`AND FALSE` : sql``;

   const fetchPeriodData = async (fromDate: Date, toDate: Date) => {
      try {
        const fromStr = getUtcDayStart(fromDate).toISOString();
        const toStr = getUtcDayStart(toDate).toISOString();
        const toExclusive = getUtcNextDayStart(toDate).toISOString();
        const requestedDayCount = Math.floor(
          (getUtcDayStart(toDate).getTime() - getUtcDayStart(fromDate).getTime())
          / 86_400_000
        ) + 1;
        const query = sql`
          WITH reconciliation_cutoff AS MATERIALIZED (
            SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) as cutoff
            FROM raw_api_realization_reports
            WHERE tenant_id = ${tenantId}
          ),
          tenant_tax AS (
            SELECT
              t.tax_type as tax_type,
              COALESCE(t.tax_rate, '0') as tax_rate,
              t.vat_mode as vat_mode,
              COALESCE(t.vat_rate, '0') as vat_rate
            FROM tenants t
            WHERE t.id = ${tenantId}
            LIMIT 1
          ),
          provisional_revenue_window AS (
            SELECT
              GREATEST(${fromStr}::date, (rc.cutoff::date + 1)) as tail_start,
              ${toStr}::date as tail_end
            FROM reconciliation_cutoff rc
          ),
          provisional_revenue_days AS (
            SELECT
              CASE
                WHEN tail_end >= tail_start THEN (tail_end - tail_start + 1)
                ELSE 0
              END::int as total_days
            FROM provisional_revenue_window
          ),
          sku_operational_tail_rates AS MATERIALIZED (
            SELECT
              r.nm_id,
              ${sql.raw(buildOperationalTailRatesSelectSql("r"))}
            FROM raw_api_realization_reports r
            WHERE r.tenant_id = ${tenantId}
              AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
              ${realizationGroupFilter}
            GROUP BY r.nm_id
          ),
          full_cost_latest AS MATERIALIZED (
            SELECT
              cost_source.nm_id,
              (${sql.raw(buildFullLandedCostSql("mi", "c.cost_price"))})::numeric as full_cost
            FROM (
              SELECT nm_id FROM unit_economics_configs WHERE tenant_id = ${tenantId}
              UNION
              SELECT nm_id FROM unit_economics_manual_inputs WHERE tenant_id = ${tenantId}
            ) cost_source
            LEFT JOIN LATERAL (
              SELECT cost_price
              FROM unit_economics_configs
              WHERE tenant_id = ${tenantId}
                AND nm_id = cost_source.nm_id
              ORDER BY effective_from DESC
              LIMIT 1
            ) c ON true
            LEFT JOIN unit_economics_manual_inputs mi
              ON mi.tenant_id = ${tenantId}
             AND mi.nm_id = cost_source.nm_id
          ),
          operational_tail_sales AS (
            SELECT
              COALESCE(SUM(s.price_with_discount), 0)::numeric as total_revenue,
              COALESCE(SUM(s.price_with_discount), 0)::numeric as total_tax_base_revenue,
              COALESCE(SUM((${sql.raw(buildOperationalTailPayoutBeforeCostSql("s.price_with_discount", "m"))}) - COALESCE(c.full_cost, 0)), 0)::numeric as total_profit,
              COALESCE(SUM((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "logistics_rate"))})), 0)::numeric as total_logistics,
              COUNT(*)::numeric as total_buyouts,
              COUNT(*)::int as total_rows
            FROM raw_api_sales s
            CROSS JOIN provisional_revenue_window tw
            LEFT JOIN sku_operational_tail_rates m ON m.nm_id = s.nm_id
            LEFT JOIN full_cost_latest c ON c.nm_id = s.nm_id
            LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
            WHERE s.tenant_id = ${tenantId}
              AND s.is_storno = false
              AND s.date::date >= tw.tail_start
              AND s.date::date <= tw.tail_end
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${salesGroupFilter}
          ),
          operational_tail_funnel AS (
            SELECT
              COALESCE(SUM(f.buyout_sum), 0)::numeric as total_buyout_sum,
              COALESCE(SUM(f.buyout_sum), 0)::numeric as total_tax_base_revenue,
              COALESCE(SUM(f.buyout_count), 0)::numeric as total_buyouts,
              COUNT(*)::int as total_rows
            FROM raw_api_funnel_stats f
            CROSS JOIN provisional_revenue_window tw
            LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
            WHERE f.tenant_id = ${tenantId}
              AND f.period_start::date = f.period_end::date
              AND f.period_start::date >= tw.tail_start
              AND f.period_start::date <= tw.tail_end
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${funnelGroupFilter}
          ),
          operational_tail_storage AS (
            SELECT
              COALESCE(SUM(s.storage_amount), 0)::numeric as total_storage,
              COUNT(*)::int as total_rows
            FROM raw_api_paid_storage s
            CROSS JOIN provisional_revenue_window tw
            LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
            WHERE s.tenant_id = ${tenantId}
              AND s.date::date >= tw.tail_start
              AND s.date::date <= tw.tail_end
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${storageGroupFilter}
          ),
          unified_sales AS (
            -- FINAL DATA sourced from mv_daily_pnl_final (pre-aggregated).
            -- profit = payout_before_cost − quantity_for_cost × full landed cost.
            SELECT
              mv.nm_id,
              mv.revenue as revenue,
              mv.spp_rub as spp,
              mv.tax_base_revenue as tax_base_revenue,
              (mv.quantity_for_cost * COALESCE(c.full_cost, 0)) as cost,
              (mv.payout_before_cost - mv.quantity_for_cost * COALESCE(c.full_cost, 0)) as profit
            FROM mv_daily_pnl_final mv
            LEFT JOIN full_cost_latest c ON c.nm_id = mv.nm_id
            LEFT JOIN products p ON p.tenant_id = mv.tenant_id AND p.nm_id = mv.nm_id
            WHERE mv.tenant_id = ${tenantId}
              AND mv.day >= ${fromStr}::date
              AND mv.day < ${toExclusive}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${mvGroupFilter}

            ${includeProvisionalTail ? sql`
              UNION ALL

              SELECT
                s.nm_id,
                s.price_with_discount as revenue,
                0 as spp,
                s.price_with_discount as tax_base_revenue,
                COALESCE(c.full_cost, 0) as cost,
                ((${sql.raw(buildOperationalTailPayoutBeforeCostSql("s.price_with_discount", "m"))}) - COALESCE(c.full_cost, 0)) as profit
              FROM raw_api_sales s
              CROSS JOIN reconciliation_cutoff rc
              LEFT JOIN sku_operational_tail_rates m ON m.nm_id = s.nm_id
              LEFT JOIN full_cost_latest c ON c.nm_id = s.nm_id
              LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
              WHERE s.tenant_id = ${tenantId}
                AND s.date::date > rc.cutoff::date
                AND s.date >= ${fromStr}::timestamp
                AND s.date < ${toExclusive}::timestamp
                AND s.is_storno = false
                AND COALESCE(p.is_hidden, FALSE) = FALSE
                ${salesGroupFilter}
            ` : sql``}
          ),
          totals AS (
            SELECT
              COALESCE(SUM(u.revenue), 0)::numeric as total_revenue,
              COALESCE(SUM(u.spp), 0)::numeric as total_spp,
              COALESCE(SUM(u.tax_base_revenue), 0)::numeric as total_tax_base_revenue,
              COALESCE(SUM(u.cost), 0)::numeric as total_cost,
              COALESCE(SUM(u.profit), 0)::numeric as total_op_profit
            FROM unified_sales u
          ),
          finance_buyout_total AS (
            SELECT
              COALESCE(SUM(mv.quantity_for_cost), 0)::numeric as total_buyouts
            FROM mv_daily_pnl_final mv
            LEFT JOIN products p ON p.tenant_id = mv.tenant_id AND p.nm_id = mv.nm_id
            WHERE mv.tenant_id = ${tenantId}
              AND mv.day >= ${fromStr}::date
              AND mv.day < ${toExclusive}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${mvGroupFilter}
          ),
          finance_storage_total AS (
            SELECT COALESCE(SUM(mv.storage_fee), 0)::numeric as total_storage_finance
            FROM mv_daily_pnl_final mv
            LEFT JOIN products p ON p.tenant_id = mv.tenant_id AND p.nm_id = mv.nm_id
            WHERE mv.tenant_id = ${tenantId}
              AND mv.day >= ${fromStr}::date
              AND mv.day < ${toExclusive}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${mvGroupFilter}
          ),
          finance_logistics_total AS (
            SELECT COALESCE(SUM(mv.logistics), 0)::numeric as total_logistics_finance
            FROM mv_daily_pnl_final mv
            LEFT JOIN products p ON p.tenant_id = mv.tenant_id AND p.nm_id = mv.nm_id
            WHERE mv.tenant_id = ${tenantId}
              AND mv.day >= ${fromStr}::date
              AND mv.day < ${toExclusive}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${mvGroupFilter}
          ),
          operational_storage_total AS (
            SELECT
              COALESCE(SUM(storage_amount), 0)::numeric as total_storage_operational,
              COUNT(*)::int as total_storage_rows
            FROM raw_api_paid_storage s
            LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
            WHERE s.tenant_id = ${tenantId}
              AND s.date >= ${fromStr}::timestamp
              AND s.date < ${toExclusive}::timestamp
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${storageGroupFilter}
          ),
          spp_total AS (
            SELECT
              COALESCE(SUM(mv.spp_rub), 0)::numeric as total_spp_rub,
              COALESCE(SUM(mv.revenue + mv.spp_rub), 0)::numeric as total_spp_base_amount
            FROM mv_daily_pnl_final mv
            LEFT JOIN products p ON p.tenant_id = mv.tenant_id AND p.nm_id = mv.nm_id
            WHERE mv.tenant_id = ${tenantId}
              AND mv.day >= ${fromStr}::date
              AND mv.day < ${toExclusive}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${mvGroupFilter}
          ),
          spp_latest_snapshot_slot AS (
            SELECT ps.snapshot_date, ps.snapshot_slot
            FROM raw_api_price_snapshots ps
            LEFT JOIN products p ON p.tenant_id = ps.tenant_id AND p.nm_id = ps.nm_id
            WHERE ps.tenant_id = ${tenantId}
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${priceSnapshotGroupFilter}
            ORDER BY ps.snapshot_at DESC
            LIMIT 1
          ),
          spp_prices_snapshot AS (
            SELECT
              COALESCE(AVG(
                CASE
                  WHEN ps.public_price_source = 'wb_card_v4' THEN ps.implied_spp
                  ELSE ps.spp
                END
              ), 0)::numeric as avg_spp,
              COUNT(*)::int as total_rows
            FROM raw_api_price_snapshots ps
            JOIN spp_latest_snapshot_slot latest
              ON latest.snapshot_date = ps.snapshot_date
              AND latest.snapshot_slot = ps.snapshot_slot
            LEFT JOIN products p ON p.tenant_id = ps.tenant_id AND p.nm_id = ps.nm_id
            WHERE ps.tenant_id = ${tenantId}
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${priceSnapshotGroupFilter}
          ),
          ad_cost_rows AS (
            SELECT
              a.nm_id,
              DATE_TRUNC('day', a.date)::date as day_key,
              COALESCE(a.amount, 0)::numeric as amount,
              COALESCE(a.order_sum, 0)::numeric as order_sum,
              COALESCE(a.order_count, 0)::numeric as order_count
            FROM raw_api_ad_costs a
            LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
            WHERE a.tenant_id = ${tenantId}
              AND a.date >= ${fromStr}::timestamp
              AND a.date < ${toExclusive}::timestamp
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${adsGroupFilter}
          ),
          ad_total_costs AS (
            SELECT
              COALESCE(SUM(amount), 0)::numeric as total_ads,
              COUNT(*)::int as total_rows
            FROM ad_cost_rows
          ),
          ad_total_costs_attributed AS (
            SELECT
              COALESCE(SUM(order_sum_max), 0)::numeric as total_ads_order_sum,
              COALESCE(SUM(order_count_max), 0)::numeric as total_ads_order_count
            FROM (
              SELECT
                nm_id,
                day_key,
                MAX(order_sum)::numeric as order_sum_max,
                MAX(order_count)::numeric as order_count_max
              FROM ad_cost_rows
              GROUP BY nm_id, day_key
            ) dedup
          ),
          ad_total_clusters AS (
            SELECT
              COALESCE(SUM(amount), 0)::numeric as total_ads,
              COALESCE(SUM(order_count), 0)::numeric as total_ads_order_count,
              COUNT(*)::int as total_rows
            FROM raw_api_ad_clusters a
            LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
            WHERE a.tenant_id = ${tenantId}
              AND a.date >= ${fromStr}::timestamp
              AND a.date < ${toExclusive}::timestamp
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${adsGroupFilter}
          ),
          ad_total AS (
            SELECT
              CASE
                WHEN COALESCE((SELECT total_rows FROM ad_total_costs), 0) > 0
                  THEN COALESCE((SELECT total_ads FROM ad_total_costs), 0)
                WHEN COALESCE((SELECT total_rows FROM ad_total_clusters), 0) > 0
                  THEN COALESCE((SELECT total_ads FROM ad_total_clusters), 0)
                ELSE 0
              END::numeric as total_ads,
              CASE
                WHEN COALESCE((SELECT total_rows FROM ad_total_costs), 0) > 0
                  THEN COALESCE((SELECT total_ads_order_sum FROM ad_total_costs_attributed), 0)
                ELSE 0
              END::numeric as total_ads_order_sum,
              CASE
                WHEN COALESCE((SELECT total_rows FROM ad_total_costs), 0) > 0
                  THEN COALESCE((SELECT total_ads_order_count FROM ad_total_costs_attributed), 0)
                WHEN COALESCE((SELECT total_rows FROM ad_total_clusters), 0) > 0
                  THEN COALESCE((SELECT total_ads_order_count FROM ad_total_clusters), 0)
                ELSE 0
              END::numeric as total_ads_order_count,
              CASE
                WHEN COALESCE((SELECT total_rows FROM ad_total_costs), 0) > 0 THEN 'ad_costs'
                WHEN COALESCE((SELECT total_rows FROM ad_total_clusters), 0) > 0 THEN 'ad_clusters'
                ELSE 'none'
              END::text as ads_source
          ),
          stocks_snapshot AS (
            SELECT
              COALESCE(SUM(s.amount), 0)::numeric as total_stocks,
              COALESCE(SUM(s.in_way_to_client), 0)::numeric as total_in_way_to_client,
              COALESCE(SUM(s.in_way_from_client), 0)::numeric as total_in_way_from_client,
              COUNT(*)::int as total_rows
            FROM raw_api_stocks s
            LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
            WHERE s.tenant_id = ${tenantId}
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${stocksGroupFilter}
          ),
          stock_size_latest AS (
            SELECT MAX(ss.snapshot_date) as snapshot_date
            FROM raw_api_stock_sizes ss
            WHERE ss.tenant_id = ${tenantId}
              AND ss.stock_type = 'wb'
          ),
          stock_size_metrics AS (
            SELECT
              COALESCE(SUM(ABS(ss.lost_orders_count)), 0)::numeric as lost_orders_count,
              COALESCE(SUM(ABS(ss.lost_orders_sum)), 0)::numeric as lost_orders_sum,
              COALESCE(
                SUM(ss.sale_rate_days * ss.stock_count) FILTER (
                  WHERE ss.sale_rate_days IS NOT NULL AND ss.stock_count > 0
                ) / NULLIF(SUM(ss.stock_count) FILTER (
                  WHERE ss.sale_rate_days IS NOT NULL AND ss.stock_count > 0
                ), 0),
                AVG(ss.sale_rate_days),
                0
              )::numeric as stock_days,
              COALESCE(
                SUM(ss.avg_stock_turnover_days * ss.stock_count) FILTER (
                  WHERE ss.avg_stock_turnover_days IS NOT NULL AND ss.stock_count > 0
                ) / NULLIF(SUM(ss.stock_count) FILTER (
                  WHERE ss.avg_stock_turnover_days IS NOT NULL AND ss.stock_count > 0
                ), 0),
                AVG(ss.avg_stock_turnover_days),
                0
              )::numeric as stock_turnover_days,
              COUNT(*)::int as total_rows
            FROM raw_api_stock_sizes ss
            JOIN stock_size_latest latest ON latest.snapshot_date = ss.snapshot_date
            LEFT JOIN products p ON p.tenant_id = ss.tenant_id AND p.nm_id = ss.nm_id
            WHERE ss.tenant_id = ${tenantId}
              AND ss.stock_type = 'wb'
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${stockSizeGroupFilter}
          ),
          stock_office_latest AS (
            SELECT MAX(so.snapshot_date) as snapshot_date
            FROM raw_api_stock_offices so
            WHERE so.tenant_id = ${tenantId}
              AND so.stock_type = 'wb'
              ${shopOnlyScopeFilter}
          ),
          stock_office_metrics AS (
            SELECT
              COALESCE(SUM(ABS(so.lost_orders_count)), 0)::numeric as lost_orders_count,
              COALESCE(SUM(ABS(so.lost_orders_sum)), 0)::numeric as lost_orders_sum,
              COALESCE(
                SUM(so.sale_rate_days * so.stock_count) FILTER (
                  WHERE so.sale_rate_days IS NOT NULL AND so.stock_count > 0
                ) / NULLIF(SUM(so.stock_count) FILTER (
                  WHERE so.sale_rate_days IS NOT NULL AND so.stock_count > 0
                ), 0),
                AVG(so.sale_rate_days),
                0
              )::numeric as stock_days,
              COALESCE(
                SUM(so.avg_stock_turnover_days * so.stock_count) FILTER (
                  WHERE so.avg_stock_turnover_days IS NOT NULL AND so.stock_count > 0
                ) / NULLIF(SUM(so.stock_count) FILTER (
                  WHERE so.avg_stock_turnover_days IS NOT NULL AND so.stock_count > 0
                ), 0),
                AVG(so.avg_stock_turnover_days),
                0
              )::numeric as stock_turnover_days,
              COUNT(*)::int as total_rows
            FROM raw_api_stock_offices so
            JOIN stock_office_latest latest ON latest.snapshot_date = so.snapshot_date
            WHERE so.tenant_id = ${tenantId}
              AND so.stock_type = 'wb'
              ${shopOnlyScopeFilter}
          ),
          stock_analytics_snapshot AS (
            SELECT
              CASE
                WHEN COALESCE((SELECT total_rows FROM stock_size_metrics), 0) > 0
                  THEN COALESCE((SELECT lost_orders_count FROM stock_size_metrics), 0)
                ELSE COALESCE((SELECT lost_orders_count FROM stock_office_metrics), 0)
              END::numeric as lost_orders_count,
              CASE
                WHEN COALESCE((SELECT total_rows FROM stock_size_metrics), 0) > 0
                  THEN COALESCE((SELECT lost_orders_sum FROM stock_size_metrics), 0)
                ELSE COALESCE((SELECT lost_orders_sum FROM stock_office_metrics), 0)
              END::numeric as lost_orders_sum,
              CASE
                WHEN COALESCE((SELECT total_rows FROM stock_size_metrics), 0) > 0
                  THEN COALESCE((SELECT stock_days FROM stock_size_metrics), 0)
                ELSE COALESCE((SELECT stock_days FROM stock_office_metrics), 0)
              END::numeric as stock_days,
              CASE
                WHEN COALESCE((SELECT total_rows FROM stock_size_metrics), 0) > 0
                  THEN COALESCE((SELECT stock_turnover_days FROM stock_size_metrics), 0)
                ELSE COALESCE((SELECT stock_turnover_days FROM stock_office_metrics), 0)
              END::numeric as stock_turnover_days,
              (
                COALESCE((SELECT total_rows FROM stock_size_metrics), 0) > 0
                OR COALESCE((SELECT total_rows FROM stock_office_metrics), 0) > 0
              ) as analytics_available
          ),
          localization_period AS (
            SELECT
              AVG(r.current_local_share_pct)::numeric as avg_local_share_pct,
              COUNT(*)::int as total_rows
            FROM redistribution_runs r
            WHERE r.tenant_id = ${tenantId}
              AND r.created_at >= ${fromStr}::timestamp
              AND r.created_at < ${toExclusive}::timestamp
              AND r.status <> 'failed'
              ${shopOnlyScopeFilter}
          ),
          localization_latest AS (
            SELECT
              r.current_local_share_pct::numeric as local_share_pct
            FROM redistribution_runs r
            WHERE r.tenant_id = ${tenantId}
              AND r.created_at < ${toExclusive}::timestamp
              AND r.status <> 'failed'
              AND r.sku_count > 0
              ${shopOnlyScopeFilter}
            ORDER BY r.created_at DESC
            LIMIT 1
          ),
          selected_period_funnel_anchor AS (
            SELECT MAX(f.period_end::date) as period_end
            FROM raw_api_funnel_stats f
            LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
            WHERE f.tenant_id = ${tenantId}
              AND f.period_start::date = ${fromStr}::date
              AND f.period_end::date <= ${toStr}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${funnelGroupFilter}
          ),
          selected_period_funnel_total AS (
            SELECT
              COALESCE(SUM(f.open_card_count), 0)::numeric as total_views,
              COALESCE(SUM(f.add_to_cart_count), 0)::numeric as total_carts,
              COALESCE(SUM(f.order_count), 0)::numeric as total_orders,
              COALESCE(SUM(f.order_sum), 0)::numeric as total_order_sum,
              COALESCE(SUM(f.buyout_count), 0)::numeric as total_buyouts,
              COALESCE(SUM(f.buyout_sum), 0)::numeric as total_buyout_sum,
              COALESCE(SUM(f.cancel_count), 0)::numeric as total_cancels,
              COUNT(*)::int as total_rows
            FROM raw_api_funnel_stats f
            CROSS JOIN selected_period_funnel_anchor anchor
            LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
            WHERE f.tenant_id = ${tenantId}
              AND f.period_start::date = ${fromStr}::date
              AND f.period_end::date = anchor.period_end
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${funnelGroupFilter}
          ),
          daily_exact_funnel_total AS (
            SELECT
              COALESCE(SUM(f.open_card_count), 0)::numeric as total_views,
              COALESCE(SUM(f.add_to_cart_count), 0)::numeric as total_carts,
              COALESCE(SUM(f.order_count), 0)::numeric as total_orders,
              COALESCE(SUM(f.order_sum), 0)::numeric as total_order_sum,
              COALESCE(SUM(f.buyout_count), 0)::numeric as total_buyouts,
              COALESCE(SUM(f.buyout_sum), 0)::numeric as total_buyout_sum,
              COALESCE(SUM(f.cancel_count), 0)::numeric as total_cancels,
              COUNT(*)::int as total_rows,
              COUNT(DISTINCT f.period_start::date)::int as covered_days
            FROM raw_api_funnel_stats f
            LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
            WHERE f.tenant_id = ${tenantId}
              AND f.period_start::date = f.period_end::date
              AND f.period_start::date >= ${fromStr}::date
              AND f.period_start::date <= ${toStr}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${funnelGroupFilter}
          ),
          operational_orders AS (
            SELECT
              COUNT(*)::numeric as total_orders,
              COALESCE(SUM(total_price), 0)::numeric as total_order_revenue
            FROM raw_api_orders r
            LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
            WHERE r.tenant_id = ${tenantId}
              AND r.is_cancel = false
              AND r.date::date >= ${fromStr}::date
              AND r.date::date <= ${toStr}::date
              AND COALESCE(p.is_hidden, FALSE) = FALSE
              ${ordersGroupFilter}
          )
          SELECT
            COALESCE((SELECT total_revenue FROM totals), 0)::numeric as "financeRevenue",
            COALESCE((SELECT total_cost FROM totals), 0)::numeric as "financeCost",
            COALESCE((SELECT total_tax_base_revenue FROM totals), 0)::numeric as "financeTaxBaseRevenue",
            COALESCE((SELECT total_revenue FROM operational_tail_sales), 0)::numeric as "tailRevenueFromSales",
            COALESCE((SELECT total_tax_base_revenue FROM operational_tail_sales), 0)::numeric as "tailTaxBaseFromSales",
            COALESCE((SELECT total_profit FROM operational_tail_sales), 0)::numeric as "tailProfitFromSales",
            COALESCE((SELECT total_logistics FROM operational_tail_sales), 0)::numeric as "tailLogisticsFromSales",
            COALESCE((SELECT total_rows FROM operational_tail_sales), 0)::int as "tailRevenueSalesRows",
            COALESCE((SELECT total_buyout_sum FROM operational_tail_funnel), 0)::numeric as "tailRevenueFromFunnel",
            COALESCE((SELECT total_tax_base_revenue FROM operational_tail_funnel), 0)::numeric as "tailTaxBaseFromFunnel",
            COALESCE((SELECT total_rows FROM operational_tail_funnel), 0)::int as "tailRevenueFunnelRows",
            COALESCE((SELECT total_buyouts FROM finance_buyout_total), 0)::numeric as "financeBuyouts",
            COALESCE((SELECT total_buyouts FROM operational_tail_sales), 0)::numeric as "tailBuyoutsFromSales",
            COALESCE((SELECT total_buyouts FROM operational_tail_funnel), 0)::numeric as "tailBuyoutsFromFunnel",
            COALESCE((SELECT total_storage FROM operational_tail_storage), 0)::numeric as "tailStorageOperational",
            COALESCE((SELECT total_rows FROM operational_tail_storage), 0)::int as "tailStorageRows",
            COALESCE((SELECT total_days FROM provisional_revenue_days), 0)::int as "revenueProvisionalDays",
            COALESCE((SELECT total_op_profit FROM totals), 0)::numeric as "financeOperatingProfit",
            COALESCE((SELECT total_logistics_finance FROM finance_logistics_total), 0)::numeric as "financeLogistics",
            COALESCE((SELECT tax_type FROM tenant_tax), 'usn_income')::text as "taxType",
            COALESCE((SELECT tax_rate FROM tenant_tax), '0')::numeric as "taxRate",
            COALESCE((SELECT vat_mode FROM tenant_tax), 'none')::text as "vatMode",
            COALESCE((SELECT vat_rate FROM tenant_tax), '0')::numeric as "vatRate",
            COALESCE((SELECT total_storage_finance FROM finance_storage_total), 0)::numeric as "totalStorageFinance",
            COALESCE((SELECT total_storage_operational FROM operational_storage_total), 0)::numeric as "totalStorageOperational",
            COALESCE((SELECT total_storage_rows FROM operational_storage_total), 0)::int as "totalStorageOperationalRows",
            COALESCE((SELECT total_ads FROM ad_total), 0)::numeric as "totalAds",
            COALESCE((SELECT total_ads_order_sum FROM ad_total), 0)::numeric as "totalAdsOrderSum",
            COALESCE((SELECT total_ads_order_count FROM ad_total), 0)::numeric as "totalAdsOrderCount",
            COALESCE((SELECT ads_source FROM ad_total), 'none')::text as "adsSource",
            COALESCE((SELECT total_stocks FROM stocks_snapshot), 0)::numeric as "totalStocks",
            COALESCE((SELECT total_in_way_to_client FROM stocks_snapshot), 0)::numeric as "totalStocksInWayToClient",
            COALESCE((SELECT total_in_way_from_client FROM stocks_snapshot), 0)::numeric as "totalStocksInWayFromClient",
            (COALESCE((SELECT total_rows FROM stocks_snapshot), 0) > 0) as "stocksAvailable",
            COALESCE((SELECT stock_days FROM stock_analytics_snapshot), 0)::numeric as "stockDays",
            COALESCE((SELECT stock_turnover_days FROM stock_analytics_snapshot), 0)::numeric as "stockTurnoverDays",
            (COALESCE((SELECT analytics_available FROM stock_analytics_snapshot), FALSE)) as "stockAnalyticsAvailable",
            COALESCE((SELECT lost_orders_count FROM stock_analytics_snapshot), 0)::numeric as "lostOrdersCount",
            COALESCE((SELECT lost_orders_sum FROM stock_analytics_snapshot), 0)::numeric as "lostOrdersSum",
            COALESCE(
              (SELECT local_share_pct FROM localization_latest),
              0
            )::numeric as "localSharePct",
            EXISTS (SELECT 1 FROM localization_latest) as "localShareAvailable",
            COALESCE((SELECT total_spp_rub FROM spp_total), 0)::numeric as "totalSppRub",
            COALESCE((SELECT total_spp_base_amount FROM spp_total), 0)::numeric as "totalSppBaseAmount",
            COALESCE((SELECT avg_spp FROM spp_prices_snapshot), 0)::numeric as "sppSnapshotAvg",
            (
              COALESCE((SELECT total_spp_base_amount FROM spp_total), 0) > 0
              OR COALESCE((SELECT total_rows FROM spp_prices_snapshot), 0) > 0
            ) as "sppAvailable",
            (COALESCE((SELECT total_rows FROM spp_prices_snapshot), 0) > 0) as "sppSnapshotAvailable",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_views
                ELSE (SELECT total_views FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_views FROM selected_period_funnel_total), 0))::numeric as "totalViews",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_carts
                ELSE (SELECT total_carts FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_carts FROM selected_period_funnel_total), 0))::numeric as "totalCarts",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_orders
                ELSE (SELECT total_orders FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_orders FROM selected_period_funnel_total), 0))::numeric as "totalFunnelOrders",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_order_sum
                ELSE (SELECT total_order_sum FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_order_sum FROM selected_period_funnel_total), 0))::numeric as "totalOrderSum",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_buyouts
                ELSE (SELECT total_buyouts FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_buyouts FROM selected_period_funnel_total), 0))::numeric as "totalBuyouts",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_cancels
                ELSE (SELECT total_cancels FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_cancels FROM selected_period_funnel_total), 0))::numeric as "totalFunnelCancels",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_buyout_sum
                ELSE (SELECT total_buyout_sum FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_buyout_sum FROM selected_period_funnel_total), 0))::numeric as "totalBuyoutSum",
            COALESCE((
              SELECT CASE
                WHEN covered_days = ${requestedDayCount} THEN total_rows
                ELSE (SELECT total_rows FROM selected_period_funnel_total)
              END
              FROM daily_exact_funnel_total
            ), COALESCE((SELECT total_rows FROM selected_period_funnel_total), 0))::int as "totalFunnelRows",
            COALESCE((SELECT total_orders FROM operational_orders), 0)::numeric as "fallbackOrders",
            COALESCE((SELECT total_order_revenue FROM operational_orders), 0)::numeric as "fallbackOrderRevenue"
            ,COALESCE((SELECT covered_days FROM daily_exact_funnel_total), 0)::int as "dailyCoveredDays"
            ,(SELECT period_end FROM selected_period_funnel_anchor)::date as "selectedFunnelPeriodEnd"
        `;
        const res = await withTenantContext(db, tenantId, async (tx) => tx.execute(query));

        const defaultSummary: DailyPnlSummaryFallback = {
          financeRevenue: 0,
          financeTaxBaseRevenue: 0,
          tailRevenueFromSales: 0,
          tailTaxBaseFromSales: 0,
          tailProfitFromSales: 0,
          tailLogisticsFromSales: 0,
          tailRevenueSalesRows: 0,
          tailRevenueFromFunnel: 0,
          tailTaxBaseFromFunnel: 0,
          tailRevenueFunnelRows: 0,
          financeBuyouts: 0,
          tailBuyoutsFromSales: 0,
          tailBuyoutsFromFunnel: 0,
          tailStorageOperational: 0,
          tailStorageRows: 0,
          revenueProvisionalDays: 0,
          financeOperatingProfit: 0,
          financeLogistics: 0,
          taxType: 'usn_income',
          taxRate: 0,
          vatMode: 'none',
          vatRate: 0,
          totalStorageFinance: 0,
          totalStorageOperational: 0,
          totalStorageOperationalRows: 0,
          totalAds: 0,
          totalAdsOrderSum: 0,
          totalAdsOrderCount: 0,
          adsSource: 'none',
          totalStocks: 0,
          totalStocksInWayToClient: 0,
          totalStocksInWayFromClient: 0,
          stocksAvailable: false,
          stockDays: 0,
          stockTurnoverDays: 0,
          stockAnalyticsAvailable: false,
          lostOrdersCount: 0,
          lostOrdersSum: 0,
          localSharePct: 0,
          localShareAvailable: false,
          totalSppRub: 0,
          totalSppBaseAmount: 0,
          sppSnapshotAvg: 0,
          sppAvailable: false,
          sppSnapshotAvailable: false,
          totalViews: 0,
          totalFunnelOrders: 0,
          totalFunnelCancels: 0,
          totalOrderSum: 0,
          totalBuyouts: 0,
          totalBuyoutSum: 0,
          totalFunnelRows: 0,
          fallbackOrders: 0,
          fallbackOrderRevenue: 0,
          dailyCoveredDays: 0,
          selectedFunnelPeriodEnd: null,
        };
        const summary = ((res && res[0]) ?? defaultSummary) as Record<string, unknown>;

        const financeRevenue = parseNumeric(summary.financeRevenue);
        const financeTaxBaseRevenue = parseNumeric(summary.financeTaxBaseRevenue);
        const tailRevenueFromSales = parseNumeric(summary.tailRevenueFromSales);
        const tailTaxBaseFromSales = parseNumeric(summary.tailTaxBaseFromSales);
        const tailProfitFromSales = parseNumeric(summary.tailProfitFromSales);
        const tailLogisticsFromSales = parseNumeric(summary.tailLogisticsFromSales);
        const tailRevenueSalesRows = Math.round(parseNumeric(summary.tailRevenueSalesRows));
        const tailRevenueFromFunnel = parseNumeric(summary.tailRevenueFromFunnel);
        const tailTaxBaseFromFunnel = parseNumeric(summary.tailTaxBaseFromFunnel);
        const tailRevenueFunnelRows = Math.round(parseNumeric(summary.tailRevenueFunnelRows));
        const financeBuyouts = parseNumeric(summary.financeBuyouts);
        const tailBuyoutsFromSales = parseNumeric(summary.tailBuyoutsFromSales);
        const tailBuyoutsFromFunnel = parseNumeric(summary.tailBuyoutsFromFunnel);
        const tailStorageRows = Math.round(parseNumeric(summary.tailStorageRows));
        const revenueProvisionalDays = Math.round(parseNumeric(summary.revenueProvisionalDays));
        const financeOperatingProfit = parseNumeric(summary.financeOperatingProfit);
        const financeCost = parseNumeric(summary.financeCost);
        const financeLogistics = parseNumeric(summary.financeLogistics);
        const taxType = typeof summary.taxType === "string" ? summary.taxType : "usn_income";
        const taxRate = parseNumeric(summary.taxRate);
        const vatMode = typeof summary.vatMode === "string" ? summary.vatMode : "none";
        const vatRate = parseNumeric(summary.vatRate);
        const storageFinance = parseNumeric(summary.totalStorageFinance);
        const storageOperational = parseNumeric(summary.totalStorageOperational);
        const storageOperationalRows = Math.round(parseNumeric(summary.totalStorageOperationalRows));
        const ads = parseNumeric(summary.totalAds);
        const adsOrderSumRaw = parseNumeric(summary.totalAdsOrderSum);
        const adsOrderCountRaw = parseNumeric(summary.totalAdsOrderCount);
        const adsSource = typeof summary.adsSource === "string" ? summary.adsSource : "none";
        const stocks = parseNumeric(summary.totalStocks);
        const stocksInWayToClient = parseNumeric(summary.totalStocksInWayToClient);
        const stocksInWayFromClient = parseNumeric(summary.totalStocksInWayFromClient);
        const stocksAvailable = Boolean(summary.stocksAvailable);
        const stockDays = parseNumeric(summary.stockDays);
        const stockTurnoverDays = parseNumeric(summary.stockTurnoverDays);
        const stockAnalyticsAvailable = Boolean(summary.stockAnalyticsAvailable);
        const lostOrdersCount = parseNumeric(summary.lostOrdersCount);
        const lostOrdersSum = parseNumeric(summary.lostOrdersSum);
        const localShare = parseNumeric(summary.localSharePct);
        const localShareAvailable = Boolean(summary.localShareAvailable);
        const totalSppRub = parseNumeric(summary.totalSppRub);
        const totalSppBaseAmount = parseNumeric(summary.totalSppBaseAmount);
        const sppSnapshotAvg = parseNumeric(summary.sppSnapshotAvg);
        const sppSnapshotAvailable = Boolean(summary.sppSnapshotAvailable);
        const sppAvailable = Boolean(summary.sppAvailable);
        const views = parseNumeric(summary.totalViews);
        const funnelOrders = parseNumeric(summary.totalFunnelOrders);
        const funnelBuyouts = parseNumeric(summary.totalBuyouts);
        const funnelCancels = parseNumeric(summary.totalFunnelCancels);
        const funnelBuyoutSum = parseNumeric(summary.totalBuyoutSum);
        const funnelOrderSum = parseNumeric(summary.totalOrderSum);
        const fallbackOrders = parseNumeric(summary.fallbackOrders);
        const fallbackOrderRevenue = parseNumeric(summary.fallbackOrderRevenue);
        const dailyCoveredDays = Math.round(parseNumeric(summary.dailyCoveredDays));
        const selectedFunnelPeriodEnd = typeof summary.selectedFunnelPeriodEnd === "string"
          ? summary.selectedFunnelPeriodEnd
          : null;
        const requestedToDate = toStr.slice(0, 10);
        const hasExactToplineSnapshot = dailyCoveredDays === requestedDayCount
          || selectedFunnelPeriodEnd === requestedToDate;

        const hasToplineSnapshot = hasExactToplineSnapshot;
        const shouldMergeOperationalTail = !includeProvisionalTail;
        const effectiveProvisionalDays = shouldMergeOperationalTail ? revenueProvisionalDays : 0;
        const revenueTail = shouldMergeOperationalTail
          ? (tailRevenueSalesRows > 0 ? tailRevenueFromSales : tailRevenueFromFunnel)
          : 0;
        const taxBaseRevenueTail = shouldMergeOperationalTail
          ? (tailRevenueSalesRows > 0 ? tailTaxBaseFromSales : tailTaxBaseFromFunnel)
          : 0;
        const revenue = financeRevenue + revenueTail;
        // P1: выручка для управленческих метрик = цена продавца ДО СПП (СПП — расход WB).
        // `revenue` остаётся реализацией после СПП для внутренней логики; наружу/в знаменатели идёт revenuePreSpp.
        const realizedRevenue = revenue;
        const revenuePreSpp = revenue + totalSppRub;
        const cogs = financeCost;
        const taxBaseRevenue = financeTaxBaseRevenue + taxBaseRevenueTail;
        const revenueSource = effectiveProvisionalDays <= 0
          ? 'finance'
          : tailRevenueSalesRows > 0
            ? 'hybrid_daily_sales'
            : tailRevenueFunnelRows > 0
              ? 'hybrid_funnel'
              : 'finance';
        const buyoutsTail = shouldMergeOperationalTail
          ? (tailRevenueSalesRows > 0 ? tailBuyoutsFromSales : tailRevenueFunnelRows > 0 ? tailBuyoutsFromFunnel : 0)
          : 0;
        const financeBasedBuyouts = financeBuyouts + buyoutsTail;
        const financeBuyoutSum = financeRevenue + revenueTail;
        // WB funnel reports daily buyouts with a 1-2-day delay even when daily
        // orders are already populated. When that gap is detected — daily
        // funnel snapshot exists, has orders > 0, but buyouts == 0 — and
        // finance or raw_api_sales already has data for the period, we fall
        // back to the finance+sales-based number instead of trusting the
        // provisional zero.
        const funnelBuyoutsAreProvisional =
          hasToplineSnapshot
          && funnelBuyouts <= 0
          && funnelOrders > 0
          && financeBasedBuyouts > 0;
        const useFinanceBasedBuyouts = !hasToplineSnapshot || funnelBuyoutsAreProvisional;
        const useExactFunnelBuyouts = hasToplineSnapshot && !useFinanceBasedBuyouts;
        const buyouts = useFinanceBasedBuyouts
          ? financeBasedBuyouts
          : useExactFunnelBuyouts
            ? funnelBuyouts
            : financeBasedBuyouts;
        const financeBasedBuyoutsSource = effectiveProvisionalDays <= 0
          ? 'finance'
          : tailRevenueSalesRows > 0
            ? 'hybrid_daily_sales'
            : tailRevenueFunnelRows > 0
              ? 'hybrid_funnel'
              : 'finance';
        const buyoutsSource = useExactFunnelBuyouts
          ? 'exact_funnel'
          : financeBasedBuyoutsSource;
        const financeOperatingMargin = financeRevenue > 0 ? (financeOperatingProfit / financeRevenue) : 0;
        const tailOperatingProfit = shouldMergeOperationalTail
          ? (
            tailRevenueSalesRows > 0
              ? tailProfitFromSales
              : tailRevenueFunnelRows > 0
                ? tailRevenueFromFunnel * financeOperatingMargin
                : 0
          )
          : 0;
        const operatingProfit = financeOperatingProfit + tailOperatingProfit;
        const netProfitCalc = calculateNetProfitFromOperating({
          taxType,
          taxRatePercent: taxRate,
          vatMode,
          vatRatePercent: vatRate,
          taxBaseRevenue,
          operatingProfit,
          adSpend: ads,
        });
        const profitBeforeTax = netProfitCalc.profitBeforeTax;
        const net = netProfitCalc.netProfit;
        const profitSource = effectiveProvisionalDays <= 0
          ? 'finance'
          : tailRevenueSalesRows > 0
            ? 'hybrid_daily_sales'
            : tailRevenueFunnelRows > 0
              ? 'hybrid_funnel_estimated'
              : 'finance';
        const financeRatioBase = revenuePreSpp;
        const hasOperationalOrderFallback = fallbackOrders > 0 || fallbackOrderRevenue > 0;
        const orderSumSource = hasToplineSnapshot
          ? 'exact_funnel'
          : hasOperationalOrderFallback ? 'raw_orders' : 'none';
        const orderSumAvailable = orderSumSource !== 'none';
        const orderSum = orderSumSource === 'exact_funnel'
          ? funnelOrderSum
          : orderSumSource === 'raw_orders'
            ? fallbackOrderRevenue
            : 0;
        const ordersSource = hasToplineSnapshot
          ? 'exact_funnel'
          : hasOperationalOrderFallback ? 'raw_orders' : 'none';
        const avgCheckSource = hasToplineSnapshot ? 'exact_funnel' : 'none';
        const orders = ordersSource === 'exact_funnel'
          ? funnelOrders
          : ordersSource === 'raw_orders'
            ? fallbackOrders
            : 0;
        const adsOrderSum = orderSum > 0
          ? Math.min(adsOrderSumRaw, orderSum)
          : adsOrderSumRaw;
        const adsOrderCount = orders > 0
          ? Math.min(adsOrderCountRaw, orders)
          : adsOrderCountRaw;
        const ordersAvailable = ordersSource !== 'none';
        const avgCheckAvailable = avgCheckSource !== 'none';
        const conversionAvailable = hasToplineSnapshot;
        const funnelClosedOutcomes = funnelBuyouts + funnelCancels;
        const buyoutRateAvailable = (hasToplineSnapshot && funnelClosedOutcomes > 0 && funnelBuyouts >= 0)
          || (!useExactFunnelBuyouts && financeBasedBuyouts > 0 && orders > 0);
        // buyoutSum: when funnel daily snapshot is provisional (orders > 0
        // but buyouts == 0), fall back to raw_api_sales revenue for the period.
        const buyoutSumAvailable = useExactFunnelBuyouts
          || (useFinanceBasedBuyouts && financeBuyoutSum > 0);
        const avgCheck = hasToplineSnapshot
          ? (funnelOrders > 0 ? funnelOrderSum / funnelOrders : 0)
          : 0;
        const conversion = conversionAvailable && views > 0 ? (funnelOrders / views) * 100 : 0;
        const buyoutRate = hasToplineSnapshot && funnelClosedOutcomes > 0 && useExactFunnelBuyouts
          ? (funnelBuyouts / funnelClosedOutcomes) * 100
          : (!useExactFunnelBuyouts && orders > 0 ? Math.min(100, (financeBasedBuyouts / orders) * 100) : 0);
        const marginProfit = profitBeforeTax;
        const grossMargin = revenuePreSpp > 0 ? (marginProfit / revenuePreSpp) * 100 : 0;
        const netMargin = revenuePreSpp > 0 ? (net / revenuePreSpp) * 100 : 0;
        const storageHasPaidRows = storageOperationalRows > 0 || tailStorageRows > 0;
        const storage = storageHasPaidRows ? storageOperational : storageFinance;
        const storageSource = storageHasPaidRows ? 'paid_storage' : 'finance';
        const storageProvisionalDays = 0;
        const storageShare = financeRatioBase > 0 ? (storage / financeRatioBase) * 100 : 0;
        const storageOperationalShare = financeRatioBase > 0 ? (storageOperational / financeRatioBase) * 100 : 0;
        const logisticsTail = shouldMergeOperationalTail && tailRevenueSalesRows > 0 ? tailLogisticsFromSales : 0;
        const logistics = financeLogistics + logisticsTail;
        const logisticsSource = logisticsTail > 0 ? 'hybrid_daily_sales' : 'finance';
        const logisticsShare = financeRatioBase > 0 ? (logistics / financeRatioBase) * 100 : 0;
        const sppSource = totalSppBaseAmount > 0
          ? 'finance'
          : (sppSnapshotAvailable ? 'prices_snapshot' : 'none');
        const spp = totalSppBaseAmount > 0
          ? (totalSppRub / totalSppBaseAmount) * 100
          : (sppSnapshotAvailable ? sppSnapshotAvg : 0);
        const sppMode: 'day' | 'avg' = requestedDayCount === 1 ? 'day' : 'avg';
        const acosRevenueBase = revenuePreSpp > 0 ? revenuePreSpp : financeRatioBase;
        const adsDrrSource = adsOrderSum > 0
          ? 'wb_attributed'
          : (adsSource === 'ad_clusters' ? 'clusters_proxy' : 'revenue_proxy');
        const acos = adsDrrSource === 'wb_attributed'
          ? (ads / adsOrderSum) * 100
          : (acosRevenueBase > 0 ? (ads / acosRevenueBase) * 100 : 0);

        return {
          revenue: revenuePreSpp,
          realizedRevenue,
          cogs,
          revenueSource,
          revenueProvisionalDays: effectiveProvisionalDays,
          profit: net,
          profitSource,
          profitProvisionalDays: effectiveProvisionalDays,
          orderSum,
          orderSumAvailable,
          orderSumSource,
          orders,
          buyouts,
          buyoutSum: useExactFunnelBuyouts
            ? funnelBuyoutSum
            : (useFinanceBasedBuyouts ? financeBuyoutSum : 0),
          buyoutSumAvailable,
          buyoutSumSource: useExactFunnelBuyouts
            ? 'exact_funnel'
            : (useFinanceBasedBuyouts ? buyoutsSource : 'none'),
          buyoutsSource,
          buyoutsProvisionalDays: effectiveProvisionalDays,
          buyoutRate,
          buyoutRateAvailable,
          ordersAvailable,
          ordersSource,
          grossMargin,
          margin: netMargin,
          storage,
          storageSource,
          storageProvisionalDays,
          storageShare,
          storageOperational,
          storageOperationalShare,
          logistics,
          logisticsSource,
          logisticsShare,
          ads,
          adsOrderSum,
          adsOrderCount,
          adsDrrSource,
          acos,
          stocks,
          stocksInWayToClient,
          stocksInWayFromClient,
          stocksAvailable,
          stockDays,
          stockTurnoverDays,
          stockAnalyticsAvailable,
          lostOrdersCount,
          lostOrdersSum,
          localShare,
          localShareAvailable,
          spp,
          sppAvailable,
          sppSource,
          sppMode,
          avgCheck,
          avgCheckAvailable,
          avgCheckSource,
          conversion,
          conversionAvailable,
          toplineSource: hasToplineSnapshot ? 'exact_funnel' : 'finance_only',
          fallbackOrders,
        };
      } catch (error) {
        logger.error({ err: error }, "[AnalyticsEngine.fetchPeriodData] SQL Error");
        return {
          revenue: 0,
          realizedRevenue: 0,
          cogs: 0,
          revenueSource: 'finance' as const,
          revenueProvisionalDays: 0,
          profit: 0,
          profitSource: 'finance' as const,
          profitProvisionalDays: 0,
          orderSum: 0,
          orderSumAvailable: false,
          orderSumSource: 'none' as const,
          orders: 0,
          buyouts: 0,
          buyoutSum: 0,
          buyoutSumAvailable: false,
          buyoutSumSource: 'none' as const,
          buyoutsSource: 'finance' as const,
          buyoutsProvisionalDays: 0,
          buyoutRate: 0,
          buyoutRateAvailable: false,
          ordersAvailable: false,
          ordersSource: 'none' as const,
          grossMargin: 0,
          margin: 0,
          storage: 0,
          storageSource: 'finance' as const,
          storageProvisionalDays: 0,
          storageShare: 0,
          storageOperational: 0,
          storageOperationalShare: 0,
          logistics: 0,
          logisticsSource: 'finance' as const,
          logisticsShare: 0,
          ads: 0,
          adsOrderSum: 0,
          adsOrderCount: 0,
          adsDrrSource: 'revenue_proxy' as const,
          acos: 0,
          stocks: 0,
          stocksInWayToClient: 0,
          stocksInWayFromClient: 0,
          stocksAvailable: false,
          stockDays: 0,
          stockTurnoverDays: 0,
          stockAnalyticsAvailable: false,
          lostOrdersCount: 0,
          lostOrdersSum: 0,
          localShare: 0,
          localShareAvailable: false,
          spp: 0,
          sppAvailable: false,
          sppSource: 'none' as const,
          sppMode: 'avg' as const,
          avgCheck: 0,
          avgCheckAvailable: false,
          avgCheckSource: 'none' as const,
          conversion: 0,
          conversionAvailable: false,
          toplineSource: 'finance_only' as const,
          fallbackOrders: 0,
        };
      }
   };

   const current = await fetchPeriodData(currentFrom, currentTo);
   const previous = await fetchPeriodData(prevDateFrom, prevDateTo);

   // Показы и CTR берём из дневной воронки ЛК (raw_api_sales_funnel_daily).
   // Таблица — на уровне кабинета (без разбивки по nm_id), поэтому при фильтре
   // по группе показы/CTR недоступны. CTR = переходы / показы (обе метрики из
   // одной таблицы — само-согласованно).
   const fetchImpressions = async (fromDate: Date, toDate: Date) => {
     if (groupId) return { impressions: 0, transitions: 0, available: false };
     try {
       const fromStr = getUtcDayStart(fromDate).toISOString();
       const toExclusive = getUtcNextDayStart(toDate).toISOString();
       const res = await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
         SELECT
           COALESCE(SUM(view_count), 0)::numeric AS impressions,
           COALESCE(SUM(open_card_count), 0)::numeric AS transitions
         FROM raw_api_sales_funnel_daily
         WHERE tenant_id = ${tenantId}
           AND date >= ${fromStr}::timestamptz
           AND date < ${toExclusive}::timestamptz
       `));
       const row = (res && res[0]) as Record<string, unknown> | undefined;
       const impressions = parseNumeric(row?.impressions);
       const transitions = parseNumeric(row?.transitions);
       return { impressions, transitions, available: impressions > 0 };
     } catch (error) {
       logger.error({ err: error }, "[AnalyticsEngine.fetchImpressions] SQL Error");
       return { impressions: 0, transitions: 0, available: false };
     }
   };

   const currentImpressions = await fetchImpressions(currentFrom, currentTo);
   const previousImpressions = await fetchImpressions(prevDateFrom, prevDateTo);
   const ctrOf = (i: { impressions: number; transitions: number }) =>
     i.impressions > 0 ? (i.transitions / i.impressions) * 100 : 0;
   const currentCtr = ctrOf(currentImpressions);
   const previousCtr = ctrOf(previousImpressions);

   const calcDelta = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return ((curr - prev) / Math.abs(prev)) * 100;
   };

	     return {
	       revenue: { value: current.revenue, delta: calcDelta(current.revenue, previous.revenue) },
		       realizedRevenue: { value: current.realizedRevenue, delta: calcDelta(current.realizedRevenue, previous.realizedRevenue) },
		       cogs: { value: current.cogs, delta: calcDelta(current.cogs, previous.cogs) },
	       revenueSource: current.revenueSource,
	       revenueProvisionalDays: current.revenueProvisionalDays,
	       profit: {
	         value: current.profit,
	         delta: current.profitSource === previous.profitSource
	           ? calcDelta(current.profit, previous.profit)
	           : 0,
	       },
	       profitSource: current.profitSource,
	       profitProvisionalDays: current.profitProvisionalDays,
	       orderSum: {
	         value: current.orderSum,
       delta: current.orderSumAvailable
         && previous.orderSumAvailable
         && current.orderSumSource === previous.orderSumSource
           ? calcDelta(current.orderSum, previous.orderSum)
           : 0,
     },
     orderSumAvailable: current.orderSumAvailable,
     orderSumSource: current.orderSumSource,
     orders: {
       value: current.orders,
       delta: current.ordersAvailable
         && previous.ordersAvailable
         && current.ordersSource === previous.ordersSource
           ? calcDelta(current.orders, previous.orders)
           : 0,
	       },
	       buyouts: { value: current.buyouts, delta: calcDelta(current.buyouts, previous.buyouts) },
	       buyoutSum: {
	         value: current.buyoutSum,
	         delta: current.buyoutSumAvailable
	           && previous.buyoutSumAvailable
	           && current.buyoutSumSource === previous.buyoutSumSource
	             ? calcDelta(current.buyoutSum, previous.buyoutSum)
	             : 0,
	       },
	       buyoutSumAvailable: current.buyoutSumAvailable,
	       buyoutSumSource: current.buyoutSumSource,
	       buyoutsSource: current.buyoutsSource,
	       buyoutsProvisionalDays: current.buyoutsProvisionalDays,
	       buyoutRate: {
	         value: parseFloat(current.buyoutRate.toFixed(2)),
	         delta: current.buyoutRateAvailable && previous.buyoutRateAvailable ? current.buyoutRate - previous.buyoutRate : 0,
	       },
	       buyoutRateAvailable: current.buyoutRateAvailable,
	       ordersAvailable: current.ordersAvailable,
	       ordersSource: current.ordersSource,
	       grossMargin: {
	         value: parseFloat(current.grossMargin.toFixed(2)),
	         delta: current.grossMargin - previous.grossMargin,
	       },
		       margin: { value: parseFloat(current.margin.toFixed(2)), delta: current.margin - previous.margin },
		       storage: {
		         value: current.storage,
		         delta: current.storageSource === previous.storageSource
		           ? calcDelta(current.storage, previous.storage)
		           : 0,
		       },
	       storageSource: current.storageSource,
	       storageProvisionalDays: current.storageProvisionalDays,
	       storageShare: {
	         value: parseFloat(current.storageShare.toFixed(2)),
	         delta: current.storageSource === previous.storageSource
	           ? current.storageShare - previous.storageShare
	           : 0,
	       },
          storageOperational: {
            value: current.storageOperational,
            delta: calcDelta(current.storageOperational, previous.storageOperational),
          },
          storageOperationalShare: {
            value: parseFloat(current.storageOperationalShare.toFixed(2)),
            delta: current.storageOperationalShare - previous.storageOperationalShare,
          },
	       logistics: {
	         value: current.logistics,
	         delta: current.logisticsSource === previous.logisticsSource
	           ? calcDelta(current.logistics, previous.logistics)
	           : 0,
	       },
	       logisticsSource: current.logisticsSource,
	       logisticsShare: {
	         value: parseFloat(current.logisticsShare.toFixed(2)),
	         delta: current.logisticsSource === previous.logisticsSource
	           ? current.logisticsShare - previous.logisticsShare
	           : 0,
	       },
	       ads: { value: current.ads, delta: calcDelta(current.ads, previous.ads) },
	       adsOrderSum: { value: current.adsOrderSum, delta: 0 },
	       adsOrderCount: { value: current.adsOrderCount, delta: 0 },
	       adsCpo: {
	         value: current.adsOrderCount > 0 ? current.ads / current.adsOrderCount : 0,
	         delta: current.adsOrderCount > 0 && previous.adsOrderCount > 0
	           ? calcDelta(current.ads / current.adsOrderCount, previous.ads / previous.adsOrderCount)
	           : 0,
	       },
	       adsCpoAvailable: current.adsOrderCount > 0,
	       adsDrrSource: current.adsDrrSource,
	       acos: {
	         value: parseFloat(current.acos.toFixed(2)),
	         delta: current.adsDrrSource === previous.adsDrrSource ? current.acos - previous.acos : 0,
	       },
     profitPerBuyout: {
       value: current.buyouts > 0 ? current.profit / current.buyouts : 0,
       delta: current.buyouts > 0 && previous.buyouts > 0
         ? calcDelta(current.profit / current.buyouts, previous.profit / previous.buyouts)
         : 0,
     },
     profitPerBuyoutAvailable: current.buyouts > 0,
     stocks: {
       value: current.stocks,
       delta: current.stocksAvailable && previous.stocksAvailable ? calcDelta(current.stocks, previous.stocks) : 0,
     },
     stocksInWayToClient: {
       value: current.stocksInWayToClient,
       delta: current.stocksAvailable && previous.stocksAvailable
         ? calcDelta(current.stocksInWayToClient, previous.stocksInWayToClient)
         : 0,
     },
     stocksInWayFromClient: {
       value: current.stocksInWayFromClient,
       delta: current.stocksAvailable && previous.stocksAvailable
         ? calcDelta(current.stocksInWayFromClient, previous.stocksInWayFromClient)
         : 0,
     },
     stocksAvailable: current.stocksAvailable,
     stockDays: {
       value: parseFloat(current.stockDays.toFixed(1)),
       delta: current.stockAnalyticsAvailable && previous.stockAnalyticsAvailable
         ? current.stockDays - previous.stockDays
         : 0,
     },
     stockTurnoverDays: {
       value: parseFloat(current.stockTurnoverDays.toFixed(1)),
       delta: current.stockAnalyticsAvailable && previous.stockAnalyticsAvailable
         ? current.stockTurnoverDays - previous.stockTurnoverDays
         : 0,
     },
     stockAnalyticsAvailable: current.stockAnalyticsAvailable,
     lostOrders: {
       value: current.lostOrdersCount,
       delta: current.stockAnalyticsAvailable && previous.stockAnalyticsAvailable
         ? calcDelta(current.lostOrdersCount, previous.lostOrdersCount)
         : 0,
     },
     lostOrdersSum: {
       value: current.lostOrdersSum,
       delta: current.stockAnalyticsAvailable && previous.stockAnalyticsAvailable
         ? calcDelta(current.lostOrdersSum, previous.lostOrdersSum)
         : 0,
     },
     localization: {
       value: parseFloat(current.localShare.toFixed(2)),
       delta: current.localShareAvailable && previous.localShareAvailable ? current.localShare - previous.localShare : 0,
     },
     localizationAvailable: current.localShareAvailable,
	       spp: {
	         value: parseFloat(current.spp.toFixed(2)),
	         delta: current.sppAvailable
	           && previous.sppAvailable
	           && current.sppSource === previous.sppSource
	           ? current.spp - previous.spp
	           : 0,
	       },
	       sppAvailable: current.sppAvailable,
	       sppSource: current.sppSource,
	       sppMode: current.sppMode,
     avgCheck: {
       value: current.avgCheck,
       delta: current.avgCheckAvailable
         && previous.avgCheckAvailable
         && current.avgCheckSource === previous.avgCheckSource
           ? calcDelta(current.avgCheck, previous.avgCheck)
           : 0,
     },
     avgCheckAvailable: current.avgCheckAvailable,
     avgCheckSource: current.avgCheckSource,
     conversion: {
       value: parseFloat(current.conversion.toFixed(2)),
       delta: current.conversionAvailable && previous.conversionAvailable ? current.conversion - previous.conversion : 0,
     },
     conversionAvailable: current.conversionAvailable,
     impressions: {
       value: currentImpressions.impressions,
       delta: calcDelta(currentImpressions.impressions, previousImpressions.impressions),
     },
     impressionsAvailable: currentImpressions.available,
     ctr: {
       value: parseFloat(currentCtr.toFixed(2)),
       delta: currentImpressions.available && previousImpressions.available ? currentCtr - previousCtr : 0,
     },
     ctrAvailable: currentImpressions.available,
     toplineSource: current.toplineSource,
   };
}

export async function getDashboardDataTrust(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  options?: { calculationMode?: EconomicsCalculationMode | string | null },
): Promise<DashboardDataTrustAudit> {
  const calculationMode = resolveEconomicsCalculationMode(options?.calculationMode);
  const includeProvisionalTail = calculationMode === "PLAN_TEMPLATE";
  const fromStr = getUtcDayStart(dateFrom).toISOString();
  const toStr = getUtcDayStart(dateTo).toISOString();
  const toExclusive = getUtcNextDayStart(dateTo).toISOString();
  const requestedDayCount = Math.floor(
    (getUtcDayStart(dateTo).getTime() - getUtcDayStart(dateFrom).getTime()) / 86_400_000,
  ) + 1;

  const parseNum = (value: unknown) => {
    const numeric = parseFloat(String(value ?? "0"));
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const parseIntNum = (value: unknown) => {
    const numeric = parseInt(String(value ?? "0"), 10);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  try {
    const query = sql`
      WITH reconciliation_cutoff AS (
        SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) as cutoff
        FROM raw_api_realization_reports
        WHERE tenant_id = ${tenantId}
      ),
      unified_sales AS (
        SELECT
          r.nm_id,
          r.retail_amount as revenue
        FROM raw_api_realization_reports r
        LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
        WHERE r.tenant_id = ${tenantId}
          AND COALESCE(r.sale_dt, r.date_from) >= ${fromStr}::timestamp
          AND COALESCE(r.sale_dt, r.date_from) < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE

        ${includeProvisionalTail ? sql`
          UNION ALL

          SELECT
            s.nm_id,
            s.price_with_discount as revenue
          FROM raw_api_sales s
          CROSS JOIN reconciliation_cutoff rc
          LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
          WHERE s.tenant_id = ${tenantId}
            AND s.date::date > rc.cutoff::date
            AND s.date >= ${fromStr}::timestamp
            AND s.date < ${toExclusive}::timestamp
            AND s.is_storno = false
            AND COALESCE(p.is_hidden, FALSE) = FALSE
        ` : sql``}
      ),
      sales_presence AS (
        SELECT
          COUNT(*)::int as total_rows,
          COALESCE(SUM(revenue), 0)::numeric as total_revenue
        FROM unified_sales
      ),
      payout_detail_presence AS (
        SELECT
          COUNT(*)::int as total_rows,
          COUNT(*) FILTER (
            WHERE (
              ABS(COALESCE(r.ppvz_for_pay, 0))
              + ABS(COALESCE(r.deduction, 0))
              + ABS(COALESCE(r.additional_payment, 0))
              + ABS(COALESCE(r.acquiring_fee, 0))
              + ABS(COALESCE(r.return_amount, 0))
            ) > 0
          )::int as detail_rows,
          COALESCE(SUM(r.ppvz_for_pay), 0)::numeric as ppvz_for_pay_total,
          COALESCE(SUM(r.deduction), 0)::numeric as deduction_total,
          COALESCE(SUM(r.additional_payment), 0)::numeric as additional_payment_total,
          COALESCE(SUM(r.acquiring_fee), 0)::numeric as acquiring_total,
          COALESCE(SUM(r.return_amount), 0)::numeric as return_total
        FROM raw_api_realization_reports r
        LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
        WHERE r.tenant_id = ${tenantId}
          AND COALESCE(r.sale_dt, r.date_from) >= ${fromStr}::timestamp
          AND COALESCE(r.sale_dt, r.date_from) < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      finance_storage_presence AS (
        SELECT
          COALESCE(SUM(r.storage_fee_rub), 0)::numeric as storage_finance_total
        FROM raw_api_realization_reports r
        LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
        WHERE r.tenant_id = ${tenantId}
          AND COALESCE(r.sale_dt, r.date_from) >= ${fromStr}::timestamp
          AND COALESCE(r.sale_dt, r.date_from) < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      operational_storage_presence AS (
        SELECT
          COALESCE(SUM(s.storage_amount), 0)::numeric as storage_operational_total
        FROM raw_api_paid_storage s
        LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.date >= ${fromStr}::timestamp
          AND s.date < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      selected_period_funnel_anchor AS (
        SELECT MAX(f.period_end::date) as period_end
        FROM raw_api_funnel_stats f
        LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
        WHERE f.tenant_id = ${tenantId}
          AND f.period_start::date = ${fromStr}::date
          AND f.period_end::date <= ${toStr}::date
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      selected_period_funnel_total AS (
        SELECT
          COALESCE(SUM(f.order_count), 0)::numeric as total_orders,
          COALESCE(SUM(f.buyout_count), 0)::numeric as total_buyouts,
          COUNT(*)::int as total_rows
        FROM raw_api_funnel_stats f
        CROSS JOIN selected_period_funnel_anchor anchor
        LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
        WHERE f.tenant_id = ${tenantId}
          AND f.period_start::date = ${fromStr}::date
          AND f.period_end::date = anchor.period_end
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      daily_exact_funnel_total AS (
        SELECT
          COALESCE(SUM(f.order_count), 0)::numeric as total_orders,
          COALESCE(SUM(f.buyout_count), 0)::numeric as total_buyouts,
          COUNT(*)::int as total_rows,
          COUNT(DISTINCT f.period_start::date)::int as covered_days
        FROM raw_api_funnel_stats f
        LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
        WHERE f.tenant_id = ${tenantId}
          AND f.period_start::date = f.period_end::date
          AND f.period_start::date >= ${fromStr}::date
          AND f.period_start::date <= ${toStr}::date
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      operational_orders AS (
        SELECT
          COUNT(*)::numeric as total_orders
        FROM raw_api_orders r
        LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
        WHERE r.tenant_id = ${tenantId}
          AND r.is_cancel = false
          AND r.date::date >= ${fromStr}::date
          AND r.date::date <= ${toStr}::date
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      operational_sales AS (
        SELECT
          COUNT(*)::numeric as total_sales
        FROM raw_api_sales s
        LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.is_storno = false
          AND s.date::date >= ${fromStr}::date
          AND s.date::date <= ${toStr}::date
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      ad_total_costs AS (
        SELECT
          COALESCE(SUM(amount), 0)::numeric as total_ads,
          COUNT(*)::int as total_rows
        FROM raw_api_ad_costs a
        LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
        WHERE a.tenant_id = ${tenantId}
          AND a.date >= ${fromStr}::timestamp
          AND a.date < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      ad_total_clusters AS (
        SELECT
          COALESCE(SUM(amount), 0)::numeric as total_ads,
          COUNT(*)::int as total_rows
        FROM raw_api_ad_clusters a
        LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
        WHERE a.tenant_id = ${tenantId}
          AND a.date >= ${fromStr}::timestamp
          AND a.date < ${toExclusive}::timestamp
          AND COALESCE(p.is_hidden, FALSE) = FALSE
      ),
      catalog_coverage AS (
        SELECT
          COUNT(*) FILTER (WHERE r.nm_id > 0)::int as goods_rows,
          COUNT(*) FILTER (WHERE r.nm_id > 0 AND p.nm_id IS NULL)::int as missing_product_rows,
          COUNT(DISTINCT r.nm_id) FILTER (WHERE r.nm_id > 0)::int as goods_skus,
          COUNT(DISTINCT r.nm_id) FILTER (WHERE r.nm_id > 0 AND p.nm_id IS NULL)::int as missing_product_skus
        FROM raw_api_realization_reports r
        LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
        WHERE r.tenant_id = ${tenantId}
          AND COALESCE(r.sale_dt, r.date_from) >= ${fromStr}::timestamp
          AND COALESCE(r.sale_dt, r.date_from) < ${toExclusive}::timestamp
      )
      SELECT
        COALESCE((SELECT total_rows FROM sales_presence), 0)::int as "financeRows",
        COALESCE((SELECT total_revenue FROM sales_presence), 0)::numeric as "financeRevenue",
        COALESCE((SELECT total_rows FROM payout_detail_presence), 0)::int as "payoutRows",
        COALESCE((SELECT detail_rows FROM payout_detail_presence), 0)::int as "payoutDetailRows",
        COALESCE((SELECT ppvz_for_pay_total FROM payout_detail_presence), 0)::numeric as "ppvzForPayTotal",
        COALESCE((SELECT deduction_total FROM payout_detail_presence), 0)::numeric as "deductionTotal",
        COALESCE((SELECT additional_payment_total FROM payout_detail_presence), 0)::numeric as "additionalPaymentTotal",
        COALESCE((SELECT acquiring_total FROM payout_detail_presence), 0)::numeric as "acquiringTotal",
        COALESCE((SELECT return_total FROM payout_detail_presence), 0)::numeric as "returnTotal",
        COALESCE((SELECT storage_finance_total FROM finance_storage_presence), 0)::numeric as "storageFinanceTotal",
        COALESCE((SELECT storage_operational_total FROM operational_storage_presence), 0)::numeric as "storageOperationalTotal",
        COALESCE((SELECT total_rows FROM ad_total_costs), 0)::int as "adCostsRows",
        COALESCE((SELECT total_ads FROM ad_total_costs), 0)::numeric as "adCostsAmount",
        COALESCE((SELECT total_rows FROM ad_total_clusters), 0)::int as "adClustersRows",
        COALESCE((SELECT total_ads FROM ad_total_clusters), 0)::numeric as "adClustersAmount",
        COALESCE((SELECT total_orders FROM operational_orders), 0)::numeric as "ordersRaw",
        COALESCE((SELECT total_sales FROM operational_sales), 0)::numeric as "salesRaw",
        COALESCE((
          SELECT CASE
            WHEN covered_days = ${requestedDayCount} THEN total_orders
            ELSE (SELECT total_orders FROM selected_period_funnel_total)
          END
          FROM daily_exact_funnel_total
        ), COALESCE((SELECT total_orders FROM selected_period_funnel_total), 0))::numeric as "funnelOrders",
        COALESCE((
          SELECT CASE
            WHEN covered_days = ${requestedDayCount} THEN total_buyouts
            ELSE (SELECT total_buyouts FROM selected_period_funnel_total)
          END
          FROM daily_exact_funnel_total
        ), COALESCE((SELECT total_buyouts FROM selected_period_funnel_total), 0))::numeric as "funnelBuyouts",
        COALESCE((SELECT covered_days FROM daily_exact_funnel_total), 0)::int as "dailyCoveredDays",
        (SELECT period_end FROM selected_period_funnel_anchor)::date as "selectedFunnelPeriodEnd",
        COALESCE((SELECT goods_rows FROM catalog_coverage), 0)::int as "catalogGoodsRows",
        COALESCE((SELECT missing_product_rows FROM catalog_coverage), 0)::int as "catalogMissingRows",
        COALESCE((SELECT goods_skus FROM catalog_coverage), 0)::int as "catalogGoodsSkus",
        COALESCE((SELECT missing_product_skus FROM catalog_coverage), 0)::int as "catalogMissingSkus"
    `;

    const res = await withTenantContext(db, tenantId, async (tx) => tx.execute(query));
    const summary = (res && res[0]) || ({} as Record<string, unknown>);

    const financeRows = parseIntNum(summary.financeRows);
    const financeRevenue = parseNum(summary.financeRevenue);
    const payoutRows = parseIntNum(summary.payoutRows);
    const payoutDetailRows = parseIntNum(summary.payoutDetailRows);
    const ppvzForPayTotal = parseNum(summary.ppvzForPayTotal);
    const deductionTotal = parseNum(summary.deductionTotal);
    const additionalPaymentTotal = parseNum(summary.additionalPaymentTotal);
    const acquiringTotal = parseNum(summary.acquiringTotal);
    const returnTotal = parseNum(summary.returnTotal);
    const storageFinanceTotal = parseNum(summary.storageFinanceTotal);
    const storageOperationalTotal = parseNum(summary.storageOperationalTotal);
    const adCostsRows = parseIntNum(summary.adCostsRows);
    const adCostsAmount = parseNum(summary.adCostsAmount);
    const adClustersRows = parseIntNum(summary.adClustersRows);
    const adClustersAmount = parseNum(summary.adClustersAmount);
    const ordersRaw = parseNum(summary.ordersRaw);
    const salesRaw = parseNum(summary.salesRaw);
    const funnelOrders = parseNum(summary.funnelOrders);
    const funnelBuyouts = parseNum(summary.funnelBuyouts);
    const dailyCoveredDays = parseIntNum(summary.dailyCoveredDays);
    const selectedFunnelPeriodEnd = summary.selectedFunnelPeriodEnd ? String(summary.selectedFunnelPeriodEnd) : null;
    const catalogGoodsRows = parseIntNum(summary.catalogGoodsRows);
    const catalogMissingRows = parseIntNum(summary.catalogMissingRows);
    const catalogGoodsSkus = parseIntNum(summary.catalogGoodsSkus);
    const catalogMissingSkus = parseIntNum(summary.catalogMissingSkus);

    const requestedToDate = toStr.slice(0, 10);
    const hasExactToplineSnapshot = dailyCoveredDays === requestedDayCount
      || selectedFunnelPeriodEnd === requestedToDate;
    const toplineSource: "exact_funnel" | "finance_only" = hasExactToplineSnapshot ? "exact_funnel" : "finance_only";
    const adsSource: "ad_costs" | "ad_clusters" | "none" = adCostsRows > 0
      ? "ad_costs"
      : adClustersRows > 0
        ? "ad_clusters"
        : "none";

    const checks: DataTrustCheck[] = [];

    const pushCheck = (check: DataTrustCheck) => {
      checks.push(check);
    };

    pushCheck({
      id: "finance_presence",
      label: "Финансовые факты за период",
      status: financeRows > 0 ? "ok" : "critical",
      expected: "financeRows > 0",
      actual: `financeRows=${financeRows}, revenue=${Math.round(financeRevenue).toLocaleString("ru-RU")} ₽`,
      deltaPct: null,
      details: financeRows > 0
        ? "Финансовые данные есть."
        : "Нет финансовых строк в реализациях за выбранный период.",
    });

    const payoutDetailCoverage = payoutRows > 0 ? (payoutDetailRows / payoutRows) * 100 : 0;
    const payoutMagnitude = Math.abs(ppvzForPayTotal)
      + Math.abs(deductionTotal)
      + Math.abs(additionalPaymentTotal)
      + Math.abs(acquiringTotal)
      + Math.abs(returnTotal);
    const payoutDetailsStatus: DataTrustStatus = financeRows <= 0
      ? "warning"
      : payoutMagnitude <= 1 && payoutDetailRows <= 0
        ? "critical"
        : payoutDetailCoverage < 1
          ? "warning"
          : "ok";

    pushCheck({
      id: "payout_detail_coverage",
      label: "Заполненность payout-полей реализации",
      status: payoutDetailsStatus,
      expected: "Payout-поля не должны быть полностью нулевыми в периоде",
      actual: `rows=${payoutRows}, detail_rows=${payoutDetailRows}, ppvz=${Math.round(ppvzForPayTotal).toLocaleString("ru-RU")} ₽, deduction=${Math.round(deductionTotal).toLocaleString("ru-RU")} ₽, add=${Math.round(additionalPaymentTotal).toLocaleString("ru-RU")} ₽, acquiring=${Math.round(acquiringTotal).toLocaleString("ru-RU")} ₽, return=${Math.round(returnTotal).toLocaleString("ru-RU")} ₽`,
      deltaPct: Number(payoutDetailCoverage.toFixed(2)),
      details: payoutDetailsStatus === "ok"
        ? "Payout-поля присутствуют в данных периода."
        : payoutMagnitude <= 1 && payoutDetailRows <= 0
          ? "Payout-поля фактически пустые. Чистая прибыль и расчет выплат ненадежны, нужен backfill реализации."
          : "Payout-поля почти пустые по покрытию строк. Проверьте полноту догруза реализации.",
    });

    const storageContourBaseline = Math.max(
      Math.abs(storageFinanceTotal),
      Math.abs(storageOperationalTotal),
      1,
    );
    const storageContourDiffPct = (Math.abs(storageFinanceTotal - storageOperationalTotal) / storageContourBaseline) * 100;
    const storageContourStatus: DataTrustStatus = financeRows <= 0
      ? "warning"
      : storageContourDiffPct <= 5
        ? "ok"
        : storageContourDiffPct <= 20
          ? "warning"
          : "critical";

    pushCheck({
      id: "storage_contour_alignment",
      label: "Согласованность хранения (weekly finance vs paid_storage)",
      status: storageContourStatus,
      expected: "Расхождение <= 5%",
      actual: `finance=${Math.round(storageFinanceTotal).toLocaleString("ru-RU")} ₽, operational=${Math.round(storageOperationalTotal).toLocaleString("ru-RU")} ₽`,
      deltaPct: Number(storageContourDiffPct.toFixed(2)),
      details: storageContourStatus === "ok"
        ? "Контуры хранения согласованы."
        : storageContourStatus === "warning"
          ? "Есть заметное расхождение контуров хранения. Проверьте полноту paid_storage и weekly-реализаций."
          : "Критичное расхождение контуров хранения. Нельзя слепо доверять KPI хранения до выравнивания sync.",
    });

    pushCheck({
      id: "funnel_snapshot",
      label: "Точный snapshot воронки",
      status: hasExactToplineSnapshot ? "ok" : "critical",
      expected: `dailyCoveredDays=${requestedDayCount} или periodEnd=${requestedToDate}`,
      actual: `dailyCoveredDays=${dailyCoveredDays}, selectedPeriodEnd=${selectedFunnelPeriodEnd ?? "none"}`,
      deltaPct: hasExactToplineSnapshot ? 0 : null,
      details: hasExactToplineSnapshot
        ? "Воронка покрывает выбранный диапазон точно."
        : "Для диапазона нет точного funnel snapshot. KPI верхней воронки ненадежны.",
    });

    pushCheck({
      id: "ads_primary_source",
      label: "Источник рекламных расходов",
      status: adsSource === "ad_costs" ? "ok" : "warning",
      expected: "Основной источник: raw_api_ad_costs",
      actual: `adsSource=${adsSource}, ad_cost_rows=${adCostsRows}, ad_cluster_rows=${adClustersRows}`,
      deltaPct: null,
      details: adsSource === "ad_costs"
        ? "Используется корректный первичный источник WB затрат."
        : adsSource === "ad_clusters"
          ? "Реклама считается по fallback-кластерам, а не по истории списаний WB."
          : "Рекламные данные отсутствуют в обоих источниках.",
    });

    if (adCostsRows > 0 && adClustersRows > 0) {
      const maxAds = Math.max(Math.abs(adCostsAmount), Math.abs(adClustersAmount), 1);
      const adsDiffPct = (Math.abs(adCostsAmount - adClustersAmount) / maxAds) * 100;
      const adsCrossStatus: DataTrustStatus = adsDiffPct <= 2 ? "ok" : "warning";

      pushCheck({
        id: "ads_cross_check",
        label: "Согласованность ad_costs vs ad_clusters",
        status: adsCrossStatus,
        expected: "Отклонение <= 2%",
        actual: `ad_costs=${Math.round(adCostsAmount).toLocaleString("ru-RU")} ₽, ad_clusters=${Math.round(adClustersAmount).toLocaleString("ru-RU")} ₽`,
        deltaPct: Number(adsDiffPct.toFixed(2)),
        details: adsCrossStatus === "ok"
          ? "Два источника рекламы согласованы."
          : "Источники рекламы расходятся заметно. Нужна проверка sync-контура рекламы.",
      });
    } else {
      pushCheck({
        id: "ads_cross_check",
        label: "Согласованность ad_costs vs ad_clusters",
        status: "warning",
        expected: "Оба источника доступны",
        actual: `ad_cost_rows=${adCostsRows}, ad_cluster_rows=${adClustersRows}`,
        deltaPct: null,
        details: "Нет второго источника для перекрестной проверки рекламы.",
      });
    }

    const ordersBaseline = Math.max(Math.abs(funnelOrders), Math.abs(ordersRaw), 1);
    const ordersDiffPct = (Math.abs(funnelOrders - ordersRaw) / ordersBaseline) * 100;
    const ordersStatus: DataTrustStatus = !hasExactToplineSnapshot
      ? "warning"
      : ordersDiffPct <= 5
        ? "ok"
        : "warning";

    pushCheck({
      id: "orders_alignment",
      label: "Согласованность заказов (funnel vs raw_orders)",
      status: ordersStatus,
      expected: "Отклонение <= 5%",
      actual: `funnel=${Math.round(funnelOrders).toLocaleString("ru-RU")}, raw_orders=${Math.round(ordersRaw).toLocaleString("ru-RU")}`,
      deltaPct: Number(ordersDiffPct.toFixed(2)),
      details: !hasExactToplineSnapshot
        ? "Без точного snapshot сравнение носит диагностический характер."
        : ordersStatus === "ok"
          ? "Заказы согласованы."
          : "Заказы между funnel и raw_orders существенно расходятся.",
    });

    const buyoutBaseline = Math.max(Math.abs(funnelBuyouts), Math.abs(salesRaw), 1);
    const buyoutDiffPct = (Math.abs(funnelBuyouts - salesRaw) / buyoutBaseline) * 100;
    const buyoutStatus: DataTrustStatus = !hasExactToplineSnapshot
      ? "warning"
      : buyoutDiffPct <= 5
        ? "ok"
        : "warning";

    pushCheck({
      id: "buyout_alignment",
      label: "Согласованность выкупов (funnel vs raw_sales)",
      status: buyoutStatus,
      expected: "Отклонение <= 5%",
      actual: `funnel=${Math.round(funnelBuyouts).toLocaleString("ru-RU")}, raw_sales=${Math.round(salesRaw).toLocaleString("ru-RU")}`,
      deltaPct: Number(buyoutDiffPct.toFixed(2)),
      details: !hasExactToplineSnapshot
        ? "Без точного snapshot сравнение носит диагностический характер."
        : buyoutStatus === "ok"
          ? "Выкупы согласованы."
          : "Выкупы между funnel и raw_sales расходятся.",
    });

    const catalogMissingRate = catalogGoodsRows > 0 ? (catalogMissingRows / catalogGoodsRows) * 100 : 0;
    const catalogStatus: DataTrustStatus = catalogMissingRate <= 0.5
      ? "ok"
      : catalogMissingRate <= 2
        ? "warning"
        : "critical";

    pushCheck({
      id: "catalog_coverage",
      label: "Покрытие realization строк карточками products",
      status: catalogStatus,
      expected: "Пропусков <= 0.5%",
      actual: `goods_rows=${catalogGoodsRows}, missing_rows=${catalogMissingRows}, goods_skus=${catalogGoodsSkus}, missing_skus=${catalogMissingSkus}`,
      deltaPct: Number(catalogMissingRate.toFixed(2)),
      details: catalogStatus === "ok"
        ? "Каталог полно покрывает реализацию."
        : "Часть realization строк не связана с products. Это ломает сводные отчеты и фильтры.",
    });

    const blockers = checks.filter((check) => check.status === "critical").map((check) => check.label);
    const diagnosticWarningIds = new Set(["ads_cross_check", "orders_alignment", "buyout_alignment"]);
    const hasBlockingWarning = checks.some((check) => check.status === "warning" && !diagnosticWarningIds.has(check.id));
    const status: DataTrustStatus = blockers.length > 0 ? "critical" : hasBlockingWarning ? "warning" : "ok";
    const scorePenalty = checks.reduce((sum, check) => {
      if (check.status === "critical") return sum + 25;
      if (check.status === "warning") {
        return sum + (diagnosticWarningIds.has(check.id) ? 3 : 10);
      }
      return sum;
    }, 0);
    const score = Math.max(0, 100 - scorePenalty);

    return {
      status,
      score,
      checkedAt: new Date().toISOString(),
      blockers,
      sources: {
        adsSource,
        toplineSource,
        calculationMode,
      },
      checks,
    };
  } catch (error) {
    logger.error({ err: error }, "[AnalyticsEngine.getDashboardDataTrust] SQL Error");
    return {
      status: "critical",
      score: 0,
      checkedAt: new Date().toISOString(),
      blockers: ["Аудит достоверности не смог выполниться из-за ошибки запроса."],
      sources: {
        adsSource: "none",
        toplineSource: "finance_only",
        calculationMode,
      },
      checks: [
        {
          id: "audit_runtime",
          label: "Выполнение аудита достоверности",
          status: "critical",
          expected: "SQL аудит выполняется без ошибок",
          actual: "query_failed",
          deltaPct: null,
          details: error instanceof Error ? error.message : "Неизвестная ошибка аудита",
        },
      ],
    };
  }
}
