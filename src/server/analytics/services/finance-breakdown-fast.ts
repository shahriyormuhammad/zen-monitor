import { eq, sql, type SQL } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { calculateNetProfitFromOperating } from '@/server/analytics/helpers/net-profit';
import { buildNetProfitSql, buildTaxAmountSql } from '@/server/analytics/helpers/sql-builders';
import {
  buildWbCreditInterestDeductionSql,
  buildWbCreditPrincipalDeductionSql,
  buildWbDeductionExpenseSql,
  buildWbDeductionKindSql,
  buildFullLandedCostSql,
  buildOperationalTailComponentSql,
  buildOperationalTailOtherFeesSql,
  buildOperationalTailPayoutBeforeCostSql,
  buildOperationalTailRatesSelectSql,
} from '@/server/analytics/services/economics';

type AnalyticsScopeOptions = {
  calculationMode?: string | null;
  groupId?: string | null;
  costingScope?: 'all' | 'costed' | null;
};

type FastFinanceRow = {
  nmId: number;
  brand: string | null;
  vendorCode: string | null;
  barcode: string | null;
  category: string | null;
  photoUrl: string | null;
  soldQuantity: number;
  grossRevenue: number;
  taxBaseRevenue: number;
  commission: number;
  logistics: number;
  otherFees: number;
  wbStorageFee: number;
  wbPenalty: number;
  wbPaymentSchedule: number;
  wbDeduction: number;
  wbDeductionCreditPrincipal: number;
  wbDeductionCreditInterest: number;
  wbAcquiringFee: number;
  wbAdditionalPayment: number;
  provisionalOtherFees: number;
  costTotal: number;
  storageCost: number;
  adSpend: number;
  profitBeforeTax: number;
  taxAmount: number;
  netProfit: number;
};

type FastDeductionDetail = {
  date: string | null;
  reportId: string | number | null;
  operation: string | null;
  docType: string | null;
  reason: string | null;
  creditKind: string | null;
  nmId: number | null;
  vendorCode: string | null;
  rowCount: number;
  firstRrdId: string | number | null;
  amount: number;
  amountExpense: number;
  amountCreditPrincipal: number;
  amountCreditInterest: number;
};

function normalizeGroupId(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toDateParam(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toId(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return toText(value);
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

function costingScopeFilter(tenantId: string, nmExpression: string, enabled: boolean): SQL {
  if (!enabled) {
    return sql``;
  }

  return sql`
    AND EXISTS (
      SELECT 1
      FROM (
        SELECT nm_id
        FROM unit_economics_manual_inputs
        WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id
        FROM unit_economics_configs
        WHERE tenant_id = ${tenantId}
      ) costed_scope
      WHERE costed_scope.nm_id = ${sql.raw(nmExpression)}
    )
  `;
}

function nmFilter(alias: string, nmId: number | null) {
  return nmId ? sql`AND ${sql.raw(`${alias}.nm_id`)} = ${nmId}` : sql``;
}

export async function getFastNetProfitBreakdown(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  nmId?: number | null,
  options?: AnalyticsScopeOptions,
) {
  const from = toDateParam(dateFrom);
  const to = toDateParam(dateTo);
  const groupId = normalizeGroupId(options?.groupId);
  const useCostedScope = options?.costingScope === 'costed';
  const normalizedNmId = Number.isFinite(nmId) && Number(nmId) > 0 ? Math.trunc(Number(nmId)) : null;

  const mvGroupFilter = groupScopeFilter(tenantId, groupId, 'mv.nm_id');
  const realizationGroupFilter = groupScopeFilter(tenantId, groupId, 'r.nm_id');
  const storageGroupFilter = groupScopeFilter(tenantId, groupId, 'st.nm_id');
  const adCostsGroupFilter = groupScopeFilter(tenantId, groupId, 'a.nm_id');
  const adClustersGroupFilter = groupScopeFilter(tenantId, groupId, 'a.nm_id');
  const finalGroupFilter = groupScopeFilter(tenantId, groupId, 'b.nm_id');
  const skuBaseCostedFilter = costingScopeFilter(tenantId, 'sp.nm_id', useCostedScope);
  const deductionCostedFilter = costingScopeFilter(tenantId, 'r.nm_id', useCostedScope);
  const costNmFilter = normalizedNmId ? sql`AND nm_id = ${normalizedNmId}` : sql``;

  const profitBeforeTaxExpr = 'b.payout_before_cost - b.cost_total - b.ad_spend';
  const taxAmountExpr = buildTaxAmountSql({
    taxTypeExpr: 't.tax_type',
    taxRateExpr: 't.tax_rate',
    vatModeExpr: 't.vat_mode',
    vatRateExpr: 't.vat_rate',
    revenueExpr: 'b.tax_base_revenue',
    profitBeforeTaxExpr,
  });
  const netProfitExpr = buildNetProfitSql({
    taxTypeExpr: 't.tax_type',
    taxRateExpr: 't.tax_rate',
    vatModeExpr: 't.vat_mode',
    vatRateExpr: 't.vat_rate',
    revenueExpr: 'b.tax_base_revenue',
    profitBeforeTaxExpr,
  });

  const [tenantTaxRow] = await withTenantContext(db, tenantId, (tx) => (
    tx.select({
      taxType: tenants.taxType,
      taxRate: tenants.taxRate,
      vatMode: tenants.vatMode,
      vatRate: tenants.vatRate,
    })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  ));

  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH latest_costs AS MATERIALIZED (
      SELECT
        cost_source.tenant_id,
        cost_source.nm_id,
        (${sql.raw(buildFullLandedCostSql('mi', 'c.cost_price'))})::numeric AS full_cost
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
    reconciliation_cutoff AS MATERIALIZED (
      SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) AS cutoff
      FROM raw_api_realization_reports
      WHERE tenant_id = ${tenantId}
    ),
    operational_tail_window AS MATERIALIZED (
      SELECT
        GREATEST(${from}::date, (cutoff::date + 1)) AS tail_start,
        ${to}::date AS tail_end
      FROM reconciliation_cutoff
    ),
    sku_operational_tail_rates AS MATERIALIZED (
      SELECT
        r.nm_id,
        ${sql.raw(buildOperationalTailRatesSelectSql('r'))}
      FROM raw_api_realization_reports r
      WHERE r.tenant_id = ${tenantId}
        AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
        ${realizationGroupFilter}
      GROUP BY r.nm_id
    ),
    operational_tail_agg AS MATERIALIZED (
      SELECT
        s.nm_id,
        COUNT(*)::numeric AS sold_quantity,
        COALESCE(SUM(s.price_with_discount), 0)::numeric AS gross_revenue,
        COALESCE(SUM(s.price_with_discount), 0)::numeric AS tax_base_revenue,
        COALESCE(SUM((${sql.raw(buildOperationalTailPayoutBeforeCostSql('s.price_with_discount', 'm'))})), 0)::numeric AS payout_before_cost,
        COALESCE(SUM((${sql.raw(buildOperationalTailComponentSql('s.price_with_discount', 'm', 'commission_rate'))})), 0)::numeric AS commission,
        COALESCE(SUM((${sql.raw(buildOperationalTailComponentSql('s.price_with_discount', 'm', 'logistics_rate'))})), 0)::numeric AS logistics,
        COALESCE(SUM((${sql.raw(buildOperationalTailOtherFeesSql('s.price_with_discount', 'm'))})), 0)::numeric AS other_fees,
        COALESCE(SUM((${sql.raw(buildOperationalTailComponentSql('s.price_with_discount', 'm', 'wb_storage_fee_rate'))})), 0)::numeric AS wb_storage_fee,
        COALESCE(SUM(COALESCE(c.full_cost, 0)), 0)::numeric AS cost_total
      FROM raw_api_sales s
      CROSS JOIN operational_tail_window tw
      LEFT JOIN sku_operational_tail_rates m ON m.nm_id = s.nm_id
      LEFT JOIN latest_costs c ON c.tenant_id = s.tenant_id AND c.nm_id = s.nm_id
      LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
      WHERE s.tenant_id = ${tenantId}
        AND s.is_storno = false
        AND tw.tail_end >= tw.tail_start
        AND s.date::date >= tw.tail_start
        AND s.date::date <= tw.tail_end
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${nmFilter('s', normalizedNmId)}
        ${groupScopeFilter(tenantId, groupId, 's.nm_id')}
      GROUP BY s.nm_id
    ),
    mv_agg AS MATERIALIZED (
      SELECT
        mv.nm_id,
        COALESCE(SUM(mv.quantity_for_cost), 0)::numeric AS sold_quantity,
        COALESCE(SUM(mv.revenue), 0)::numeric AS gross_revenue,
        COALESCE(SUM(mv.tax_base_revenue), 0)::numeric AS tax_base_revenue,
        COALESCE(SUM(mv.payout_before_cost), 0)::numeric AS payout_before_cost,
        COALESCE(SUM(mv.commission), 0)::numeric AS commission,
        COALESCE(SUM(mv.logistics), 0)::numeric AS logistics,
        COALESCE(SUM(mv.other_fees), 0)::numeric AS other_fees,
        COALESCE(SUM(mv.storage_fee), 0)::numeric AS wb_storage_fee,
        COALESCE(SUM(mv.quantity_for_cost * COALESCE(c.full_cost, 0)), 0)::numeric AS cost_total
      FROM mv_daily_pnl_final mv
      LEFT JOIN latest_costs c ON c.tenant_id = mv.tenant_id AND c.nm_id = mv.nm_id
      LEFT JOIN products p ON p.tenant_id = mv.tenant_id AND p.nm_id = mv.nm_id
      WHERE mv.tenant_id = ${tenantId}
        AND mv.day >= ${from}::date
        AND mv.day < (${to}::date + INTERVAL '1 day')
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${nmFilter('mv', normalizedNmId)}
        ${mvGroupFilter}
      GROUP BY mv.nm_id
    ),
    fee_components AS MATERIALIZED (
      SELECT
        r.nm_id,
        COALESCE(SUM(r.storage_fee_rub), 0)::numeric AS wb_storage_fee,
        COALESCE(SUM(r.penalty_rub), 0)::numeric AS wb_penalty,
        COALESCE(SUM(r.payment_schedule_rub), 0)::numeric AS wb_payment_schedule,
        COALESCE(SUM(CASE
          WHEN (
            LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
              LIKE '%основного долга%'
            AND LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
              LIKE '%кредит%'
          ) THEN 0
          WHEN (
            LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
              LIKE '%продвиж%'
            AND (
              LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
                LIKE '%wb%'
              OR LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
                LIKE '%вб%'
            )
          ) THEN 0
          ELSE COALESCE(r.deduction, 0)
        END), 0)::numeric AS wb_deduction,
        COALESCE(SUM(CASE
          WHEN (
            LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
              LIKE '%основного долга%'
            AND LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
              LIKE '%кредит%'
          ) THEN COALESCE(r.deduction, 0)
          ELSE 0
        END), 0)::numeric AS wb_deduction_credit_principal,
        COALESCE(SUM(CASE
          WHEN (
            LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
              LIKE '%процент%'
            AND LOWER(COALESCE(NULLIF(r.bonus_type_name, ''), NULLIF(r.supplier_oper_name, ''), NULLIF(r.doc_type_name, ''), ''))
              LIKE '%кредит%'
          ) THEN COALESCE(r.deduction, 0)
          ELSE 0
        END), 0)::numeric AS wb_deduction_credit_interest,
        COALESCE(SUM(r.acquiring_fee), 0)::numeric AS wb_acquiring_fee,
        0::numeric AS wb_additional_payment -- возмещение перевозки исключено из P&L (см. migration 0107)
      FROM raw_api_realization_reports r
      LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
      WHERE r.tenant_id = ${tenantId}
        AND COALESCE(r.sale_dt, r.date_from) >= ${from}::timestamp
        AND COALESCE(r.sale_dt, r.date_from) < (${to}::date + INTERVAL '1 day')
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${nmFilter('r', normalizedNmId)}
        ${realizationGroupFilter}
      GROUP BY r.nm_id
    ),
    storage_agg AS MATERIALIZED (
      SELECT
        st.nm_id,
        COALESCE(SUM(st.storage_amount), 0)::numeric AS storage_cost
      FROM raw_api_paid_storage st
      LEFT JOIN products p ON p.tenant_id = st.tenant_id AND p.nm_id = st.nm_id
      WHERE st.tenant_id = ${tenantId}
        AND st.date >= ${from}::timestamp
        AND st.date < (${to}::date + INTERVAL '1 day')
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${nmFilter('st', normalizedNmId)}
        ${storageGroupFilter}
      GROUP BY st.nm_id
    ),
    storage_source AS (
      SELECT COUNT(*)::int AS storage_rows FROM storage_agg
    ),
    ad_costs AS MATERIALIZED (
      SELECT
        a.nm_id,
        COALESCE(SUM(a.amount), 0)::numeric AS ad_spend
      FROM raw_api_ad_costs a
      LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${from}::timestamp
        AND a.date < (${to}::date + INTERVAL '1 day')
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${nmFilter('a', normalizedNmId)}
        ${adCostsGroupFilter}
      GROUP BY a.nm_id
    ),
    ad_clusters AS MATERIALIZED (
      SELECT
        a.nm_id,
        COALESCE(SUM(a.amount), 0)::numeric AS ad_spend
      FROM raw_api_ad_clusters a
      LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
      WHERE a.tenant_id = ${tenantId}
        AND a.date >= ${from}::timestamp
        AND a.date < (${to}::date + INTERVAL '1 day')
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${nmFilter('a', normalizedNmId)}
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
    ad_agg AS MATERIALIZED (
      SELECT c.nm_id, c.ad_spend
      FROM ad_costs c
      CROSS JOIN ad_source src
      WHERE src.source = 'ad_costs'
      UNION ALL
      SELECT cl.nm_id, cl.ad_spend
      FROM ad_clusters cl
      CROSS JOIN ad_source src
      WHERE src.source = 'ad_clusters'
    ),
    sku_pool AS (
      SELECT nm_id FROM mv_agg
      UNION
      SELECT nm_id FROM operational_tail_agg
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
        p.barcode,
        p.category,
        p.photo_url,
        (COALESCE(m.sold_quantity, 0) + COALESCE(tail.sold_quantity, 0))::numeric AS sold_quantity,
        (COALESCE(m.gross_revenue, 0) + COALESCE(tail.gross_revenue, 0))::numeric AS gross_revenue,
        (COALESCE(m.tax_base_revenue, 0) + COALESCE(tail.tax_base_revenue, 0))::numeric AS tax_base_revenue,
        (COALESCE(m.payout_before_cost, 0) + COALESCE(tail.payout_before_cost, 0))::numeric AS payout_before_cost,
        (COALESCE(m.commission, 0) + COALESCE(tail.commission, 0))::numeric AS commission,
        (COALESCE(m.logistics, 0) + COALESCE(tail.logistics, 0))::numeric AS logistics,
        (
          COALESCE(m.other_fees, 0)
          + COALESCE(tail.other_fees, 0)
          - COALESCE(fc.wb_storage_fee, m.wb_storage_fee, 0)
          - COALESCE(tail.wb_storage_fee, 0)
        )::numeric AS other_fees,
        (COALESCE(fc.wb_storage_fee, m.wb_storage_fee, 0) + COALESCE(tail.wb_storage_fee, 0))::numeric AS wb_storage_fee,
        COALESCE(fc.wb_penalty, 0)::numeric AS wb_penalty,
        COALESCE(fc.wb_payment_schedule, 0)::numeric AS wb_payment_schedule,
        COALESCE(fc.wb_deduction, 0)::numeric AS wb_deduction,
        COALESCE(fc.wb_deduction_credit_principal, 0)::numeric AS wb_deduction_credit_principal,
        COALESCE(fc.wb_deduction_credit_interest, 0)::numeric AS wb_deduction_credit_interest,
        COALESCE(fc.wb_acquiring_fee, 0)::numeric AS wb_acquiring_fee,
        COALESCE(fc.wb_additional_payment, 0)::numeric AS wb_additional_payment,
        0::numeric AS provisional_other_fees,
        (COALESCE(m.cost_total, 0) + COALESCE(tail.cost_total, 0))::numeric AS cost_total,
        CASE
          WHEN (SELECT storage_rows FROM storage_source) > 0
            THEN COALESCE(st.storage_cost, 0)
          ELSE COALESCE(fc.wb_storage_fee, m.wb_storage_fee, 0) + COALESCE(tail.wb_storage_fee, 0)
        END::numeric AS storage_cost,
        COALESCE(a.ad_spend, 0)::numeric AS ad_spend
      FROM sku_pool sp
      LEFT JOIN mv_agg m ON m.nm_id = sp.nm_id
      LEFT JOIN operational_tail_agg tail ON tail.nm_id = sp.nm_id
      LEFT JOIN fee_components fc ON fc.nm_id = sp.nm_id
      LEFT JOIN storage_agg st ON st.nm_id = sp.nm_id
      LEFT JOIN ad_agg a ON a.nm_id = sp.nm_id
      LEFT JOIN products p ON p.tenant_id = ${tenantId} AND p.nm_id = sp.nm_id
      WHERE COALESCE(p.is_hidden, FALSE) = FALSE
        ${skuBaseCostedFilter}
    )
    SELECT
      b.nm_id AS "nmId",
      b.brand,
      b.vendor_code AS "vendorCode",
      b.barcode,
      b.category,
      b.photo_url AS "photoUrl",
      b.sold_quantity AS "soldQuantity",
      b.gross_revenue AS "grossRevenue",
      b.tax_base_revenue AS "taxBaseRevenue",
      b.commission,
      b.logistics,
      b.other_fees AS "otherFees",
      b.wb_storage_fee AS "wbStorageFee",
      b.wb_penalty AS "wbPenalty",
      b.wb_payment_schedule AS "wbPaymentSchedule",
      b.wb_deduction AS "wbDeduction",
      b.wb_deduction_credit_principal AS "wbDeductionCreditPrincipal",
      b.wb_deduction_credit_interest AS "wbDeductionCreditInterest",
      b.wb_acquiring_fee AS "wbAcquiringFee",
      b.wb_additional_payment AS "wbAdditionalPayment",
      b.provisional_other_fees AS "provisionalOtherFees",
      b.cost_total AS "costTotal",
      b.storage_cost AS "storageCost",
      b.ad_spend AS "adSpend",
      ${sql.raw(`(${profitBeforeTaxExpr})::numeric`)} AS "profitBeforeTax",
      ${sql.raw(`(${taxAmountExpr})::numeric`)} AS "taxAmount",
      ${sql.raw(`(${netProfitExpr})::numeric`)} AS "netProfit"
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
      + ABS(b.cost_total)
      + ABS(b.storage_cost)
      + ABS(b.ad_spend)
    ) > 0
    ${finalGroupFilter}
    ORDER BY "netProfit" ASC, "grossRevenue" DESC, "nmId" ASC
    LIMIT 1000
  `)) as Array<Record<string, unknown>>;

  const items: FastFinanceRow[] = rows.map((row) => ({
    nmId: Math.trunc(toNumber(row.nmId)),
    brand: typeof row.brand === 'string' ? row.brand : null,
    vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
    barcode: typeof row.barcode === 'string' ? row.barcode : null,
    category: typeof row.category === 'string' ? row.category : null,
    photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
    soldQuantity: toNumber(row.soldQuantity),
    grossRevenue: toNumber(row.grossRevenue),
    taxBaseRevenue: toNumber(row.taxBaseRevenue),
    commission: toNumber(row.commission),
    logistics: toNumber(row.logistics),
    otherFees: toNumber(row.otherFees),
    wbStorageFee: toNumber(row.wbStorageFee),
    wbPenalty: toNumber(row.wbPenalty),
    wbPaymentSchedule: toNumber(row.wbPaymentSchedule),
    wbDeduction: toNumber(row.wbDeduction),
    wbDeductionCreditPrincipal: toNumber(row.wbDeductionCreditPrincipal),
    wbDeductionCreditInterest: toNumber(row.wbDeductionCreditInterest),
    wbAcquiringFee: toNumber(row.wbAcquiringFee),
    wbAdditionalPayment: toNumber(row.wbAdditionalPayment),
    provisionalOtherFees: toNumber(row.provisionalOtherFees),
    costTotal: toNumber(row.costTotal),
    storageCost: toNumber(row.storageCost),
    adSpend: toNumber(row.adSpend),
    profitBeforeTax: toNumber(row.profitBeforeTax),
    taxAmount: toNumber(row.taxAmount),
    netProfit: toNumber(row.netProfit),
  }));

  const deductionRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
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
      (${sql.raw(buildWbDeductionKindSql('r'))})::text AS "creditKind",
      r.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      COUNT(*)::int AS "rowCount",
      MIN(r.rrd_id)::text AS "firstRrdId",
      COALESCE(SUM(r.deduction), 0)::numeric AS "amount",
      COALESCE(SUM((${sql.raw(buildWbDeductionExpenseSql('r'))})), 0)::numeric AS "amountExpense",
      COALESCE(SUM((${sql.raw(buildWbCreditPrincipalDeductionSql('r'))})), 0)::numeric AS "amountCreditPrincipal",
      COALESCE(SUM((${sql.raw(buildWbCreditInterestDeductionSql('r'))})), 0)::numeric AS "amountCreditInterest"
    FROM raw_api_realization_reports r
    LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
    WHERE r.tenant_id = ${tenantId}
      AND COALESCE(r.sale_dt, r.date_from) >= ${from}::timestamp
      AND COALESCE(r.sale_dt, r.date_from) < (${to}::date + INTERVAL '1 day')
      AND COALESCE(r.deduction, 0) <> 0
      AND COALESCE(p.is_hidden, FALSE) = FALSE
      ${nmFilter('r', normalizedNmId)}
      ${realizationGroupFilter}
      ${deductionCostedFilter}
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
      (${sql.raw(buildWbDeductionKindSql('r'))}),
      r.nm_id,
      p.vendor_code
    ORDER BY SUM(r.deduction) DESC, COALESCE(r.sale_dt, r.date_from)::date DESC
    LIMIT 300
  `)) as Array<Record<string, unknown>>;

  const deductionDetails: FastDeductionDetail[] = deductionRows.map((row) => {
    const rowNmId = Math.trunc(toNumber(row.nmId));

    return {
      reportId: toId(row.reportId),
      date: toText(row.date),
      operation: toText(row.operation),
      docType: toText(row.docType),
      reason: toText(row.reason) ?? 'Без расшифровки в сохраненных данных',
      creditKind: toText(row.creditKind) ?? 'other',
      nmId: rowNmId > 0 ? rowNmId : null,
      vendorCode: toText(row.vendorCode),
      rowCount: Math.trunc(toNumber(row.rowCount)),
      firstRrdId: toId(row.firstRrdId),
      amount: toNumber(row.amount),
      amountExpense: toNumber(row.amountExpense),
      amountCreditPrincipal: toNumber(row.amountCreditPrincipal),
      amountCreditInterest: toNumber(row.amountCreditInterest),
    };
  });

  const totals = items.reduce((acc, item) => {
    acc.grossRevenue += item.grossRevenue;
    acc.taxBaseRevenue += item.taxBaseRevenue;
    acc.commission += item.commission;
    acc.logistics += item.logistics;
    acc.otherFees += item.otherFees;
    acc.wbStorageFee += item.wbStorageFee;
    acc.wbPenalty += item.wbPenalty;
    acc.wbPaymentSchedule += item.wbPaymentSchedule;
    acc.wbDeduction += item.wbDeduction;
    acc.wbDeductionCreditPrincipal += item.wbDeductionCreditPrincipal;
    acc.wbDeductionCreditInterest += item.wbDeductionCreditInterest;
    acc.wbAcquiringFee += item.wbAcquiringFee;
    acc.wbAdditionalPayment += item.wbAdditionalPayment;
    acc.provisionalOtherFees += item.provisionalOtherFees;
    acc.costTotal += item.costTotal;
    acc.storageCost += item.storageCost;
    acc.adSpend += item.adSpend;
    acc.profitBeforeTax += item.profitBeforeTax;
    acc.taxAmount += item.taxAmount;
    acc.netProfit += item.netProfit;
    return acc;
  }, {
    grossRevenue: 0,
    taxBaseRevenue: 0,
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

  const netProfitCalc = calculateNetProfitFromOperating({
    taxType: tenantTaxRow?.taxType ?? 'usn_income',
    taxRatePercent: toNumber(tenantTaxRow?.taxRate),
    vatMode: tenantTaxRow?.vatMode ?? 'none',
    vatRatePercent: toNumber(tenantTaxRow?.vatRate),
    taxBaseRevenue: totals.taxBaseRevenue,
    operatingProfit: totals.profitBeforeTax + totals.adSpend,
    adSpend: totals.adSpend,
  });
  totals.profitBeforeTax = netProfitCalc.profitBeforeTax;
  totals.taxAmount = netProfitCalc.taxAmount;
  totals.netProfit = netProfitCalc.netProfit;

  return {
    taxType: tenantTaxRow?.taxType ?? 'usn_income',
    taxRatePercent: toNumber(tenantTaxRow?.taxRate),
    vatMode: tenantTaxRow?.vatMode ?? 'none',
    vatRatePercent: toNumber(tenantTaxRow?.vatRate),
    totals,
    deductionDetails,
    items,
  };
}
