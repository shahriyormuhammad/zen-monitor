import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant, requireGroupAccess } from '@/lib/auth/tenant-access';
import { db, withTenantContext } from '@/lib/db';
import { parseApiDateParam } from '@/lib/date-range';
import { getFastNetProfitBreakdown } from '@/server/analytics/services/finance-breakdown-fast';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DrilldownMetric = 'finance' | 'orders' | 'buyouts' | 'ads' | 'storage' | 'stocks' | 'spp' | 'conversion';

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeMetric(value: string | null): DrilldownMetric | null {
  return value === 'finance'
    || value === 'orders'
    || value === 'buyouts'
    || value === 'ads'
    || value === 'storage'
    || value === 'stocks'
    || value === 'spp'
    || value === 'conversion'
    ? value
    : null;
}

function normalizeGroupId(value: string | null) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function groupScopeFilter(tenantId: string, groupId: string | null, nmExpression: string) {
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

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const metric = normalizeMetric(searchParams.get('metric'));
  const groupId = normalizeGroupId(searchParams.get('groupId'));

  if (!from || !to || !metric) {
    return NextResponse.json({ error: 'Нужны параметры from, to и metric' }, { status: 400 });
  }

  const parsedDateFrom = parseApiDateParam(from);
  const parsedDateTo = parseApiDateParam(to);
  if (!parsedDateFrom || !parsedDateTo) {
    return NextResponse.json({ error: 'Неверные параметры даты' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const groupAccess = groupId ? await requireGroupAccess(groupId) : null;
  if (groupAccess && groupAccess.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Склейка не относится к активному кабинету' }, { status: 403 });
  }

  const scopeOptions = { calculationMode: 'FACT_WB' as const, groupId };
  const adsGroupFilter = groupScopeFilter(tenantId, groupId, 'a.nm_id');
  const financeGroupFilter = groupScopeFilter(tenantId, groupId, 'mv.nm_id');
  const storageGroupFilter = groupScopeFilter(tenantId, groupId, 'st.nm_id');
  const stocksGroupFilter = groupScopeFilter(tenantId, groupId, 's.nm_id');
  const funnelGroupFilter = groupScopeFilter(tenantId, groupId, 'f.nm_id');
  const kpi = await AnalyticsEngine.getKpis(tenantId, parsedDateFrom, parsedDateTo, scopeOptions);

  if (metric === 'orders') {
    const orderRows = await AnalyticsEngine.getOrderHighlights(tenantId, parsedDateFrom, parsedDateTo, { groupId });
    const rows = (orderRows as Array<Record<string, unknown>>)
      .map((row) => ({
        nmId: toNumber(row.nmId),
        brand: typeof row.brand === 'string' ? row.brand : null,
        vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
        photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
        quantity: toNumber(row.soldQuantity),
        amount: roundMoney(toNumber(row.grossRevenue)),
      }))
      .filter((row) => row.nmId > 0 && row.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity || b.amount - a.amount);

    return NextResponse.json({
      metric,
      title: 'Заказы',
      period: { from, to },
      totals: {
        quantity: toNumber(kpi.orders?.value),
        amount: roundMoney(toNumber(kpi.orderSum?.value)),
        source: kpi.ordersSource ?? 'none',
      },
      rows,
    });
  }

  if (metric === 'ads') {
    const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
      WITH ad_costs AS (
        SELECT
          a.nm_id,
          SUM(a.amount)::numeric AS amount,
          SUM(a.order_sum)::numeric AS order_sum,
          SUM(a.order_count)::numeric AS order_count,
          COUNT(*)::int AS source_rows
        FROM raw_api_ad_costs a
        LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
        WHERE a.tenant_id = ${tenantId}
          AND a.date >= ${from}::date
          AND a.date < (${to}::date + INTERVAL '1 day')
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${adsGroupFilter}
        GROUP BY a.nm_id
      ),
      ad_clusters AS (
        SELECT
          a.nm_id,
          SUM(a.amount)::numeric AS amount,
          0::numeric AS order_sum,
          SUM(a.order_count)::numeric AS order_count,
          COUNT(*)::int AS source_rows
        FROM raw_api_ad_clusters a
        LEFT JOIN products p ON p.tenant_id = a.tenant_id AND p.nm_id = a.nm_id
        WHERE a.tenant_id = ${tenantId}
          AND a.date >= ${from}::date
          AND a.date < (${to}::date + INTERVAL '1 day')
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${adsGroupFilter}
        GROUP BY a.nm_id
      ),
      source AS (
        SELECT COALESCE(SUM(source_rows), 0)::int AS cost_rows FROM ad_costs
      ),
      chosen AS (
        SELECT 'ad_costs'::text AS source, * FROM ad_costs WHERE (SELECT cost_rows FROM source) > 0
        UNION ALL
        SELECT 'ad_clusters'::text AS source, * FROM ad_clusters WHERE (SELECT cost_rows FROM source) = 0
      )
      SELECT
        c.nm_id AS "nmId",
        p.brand,
        p.vendor_code AS "vendorCode",
        p.photo_url AS "photoUrl",
        c.amount,
        c.order_sum AS "orderSum",
        c.order_count AS "orderCount",
        CASE WHEN c.order_sum > 0 THEN c.amount / NULLIF(c.order_sum, 0) * 100 ELSE NULL END::numeric AS "drr",
        c.source,
        c.source_rows AS "sourceRows"
      FROM chosen c
      LEFT JOIN products p ON p.tenant_id = ${tenantId} AND p.nm_id = c.nm_id
      WHERE c.amount <> 0 OR c.order_count <> 0 OR c.order_sum <> 0
      ORDER BY c.amount DESC
      LIMIT 500
    `)) as Array<Record<string, unknown>>;

    return NextResponse.json({
      metric,
      title: 'Реклама',
      period: { from, to },
      totals: {
        spend: roundMoney(toNumber(kpi.ads?.value)),
        drr: toNumber(kpi.acos?.value),
        source: kpi.adsDrrSource ?? 'revenue_proxy',
      },
      rows: rows.map((row) => ({
        nmId: toNumber(row.nmId),
        brand: typeof row.brand === 'string' ? row.brand : null,
        vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
        photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
        amount: roundMoney(toNumber(row.amount)),
        orderSum: roundMoney(toNumber(row.orderSum)),
        orderCount: toNumber(row.orderCount),
        drr: row.drr === null ? null : toNumber(row.drr),
        source: typeof row.source === 'string' ? row.source : 'none',
      })),
    });
  }

  if (metric === 'storage') {
    const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
      SELECT
        st.nm_id AS "nmId",
        p.brand,
        p.vendor_code AS "vendorCode",
        p.photo_url AS "photoUrl",
        SUM(st.storage_amount)::numeric AS storage,
        COUNT(*)::int AS "sourceRows",
        COUNT(DISTINCT st.date::date)::int AS "sourceDays"
      FROM raw_api_paid_storage st
      LEFT JOIN products p ON p.tenant_id = st.tenant_id AND p.nm_id = st.nm_id
      WHERE st.tenant_id = ${tenantId}
        AND st.date >= ${from}::timestamp
        AND st.date < (${to}::date + INTERVAL '1 day')
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${storageGroupFilter}
      GROUP BY st.nm_id, p.brand, p.vendor_code, p.photo_url
      HAVING SUM(st.storage_amount) <> 0
      ORDER BY SUM(st.storage_amount) DESC
      LIMIT 500
    `)) as Array<Record<string, unknown>>;

    return NextResponse.json({
      metric,
      title: 'Хранение',
      period: { from, to },
      totals: {
        storage: roundMoney(toNumber(kpi.storage?.value)),
        share: toNumber(kpi.storageShare?.value),
        source: kpi.storageSource ?? 'finance',
      },
      rows: rows.map((row) => ({
        nmId: toNumber(row.nmId),
        brand: typeof row.brand === 'string' ? row.brand : null,
        vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
        photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
        storage: roundMoney(toNumber(row.storage)),
        sourceRows: toNumber(row.sourceRows),
        sourceDays: toNumber(row.sourceDays),
      })),
    });
  }

  if (metric === 'stocks') {
    const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
      SELECT
        s.nm_id AS "nmId",
        p.brand,
        p.vendor_code AS "vendorCode",
        p.photo_url AS "photoUrl",
        SUM(s.amount)::numeric AS stock,
        SUM(s.in_way_to_client + s.in_way_from_client)::numeric AS "inWay",
        SUM(s.in_way_to_client)::numeric AS "inWayToClient",
        SUM(s.in_way_from_client)::numeric AS "inWayFromClient",
        COUNT(DISTINCT s.warehouse_name)::int AS "warehouseCount",
        MAX(s.created_at) AS "snapshotAt"
      FROM raw_api_stocks s
      LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
      WHERE s.tenant_id = ${tenantId}
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${stocksGroupFilter}
      GROUP BY s.nm_id, p.brand, p.vendor_code, p.photo_url
      HAVING SUM(s.amount) <> 0 OR SUM(s.in_way_to_client + s.in_way_from_client) <> 0
      ORDER BY SUM(s.amount) DESC
      LIMIT 500
    `)) as Array<Record<string, unknown>>;

    return NextResponse.json({
      metric,
      title: 'Остатки WB',
      period: { from, to },
      totals: {
        stock: toNumber(kpi.stocks?.value),
        inWay: toNumber(kpi.stocksInWayToClient?.value) + toNumber(kpi.stocksInWayFromClient?.value),
        source: 'последний snapshot',
      },
      rows: rows.map((row) => ({
        nmId: toNumber(row.nmId),
        brand: typeof row.brand === 'string' ? row.brand : null,
        vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
        photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
        stock: toNumber(row.stock),
        inWay: toNumber(row.inWay),
        inWayToClient: toNumber(row.inWayToClient),
        inWayFromClient: toNumber(row.inWayFromClient),
        warehouseCount: toNumber(row.warehouseCount),
        snapshotAt: row.snapshotAt instanceof Date ? row.snapshotAt.toISOString() : String(row.snapshotAt ?? ''),
      })),
    });
  }

  if (metric === 'spp') {
    const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
      WITH finance_spp AS (
        SELECT
          mv.nm_id,
          SUM(mv.spp_rub)::numeric AS spp_rub,
          SUM(mv.revenue + mv.spp_rub)::numeric AS spp_base
        FROM mv_daily_pnl_final mv
        LEFT JOIN products p ON p.tenant_id = mv.tenant_id AND p.nm_id = mv.nm_id
        WHERE mv.tenant_id = ${tenantId}
          AND mv.day >= ${from}::date
          AND mv.day < (${to}::date + INTERVAL '1 day')
          AND COALESCE(p.is_hidden, FALSE) = FALSE
          ${financeGroupFilter}
        GROUP BY mv.nm_id
      )
      SELECT
        f.nm_id AS "nmId",
        p.brand,
        p.vendor_code AS "vendorCode",
        p.photo_url AS "photoUrl",
        f.spp_rub AS "sppRub",
        f.spp_base AS "sppBase",
        CASE WHEN f.spp_base > 0 THEN f.spp_rub / NULLIF(f.spp_base, 0) * 100 ELSE 0 END::numeric AS "sppPct"
      FROM finance_spp f
      LEFT JOIN products p ON p.tenant_id = ${tenantId} AND p.nm_id = f.nm_id
      WHERE f.spp_rub <> 0 OR f.spp_base <> 0
      ORDER BY "sppRub" DESC
      LIMIT 500
    `)) as Array<Record<string, unknown>>;

    return NextResponse.json({
      metric,
      title: 'SPP WB',
      period: { from, to },
      totals: {
        spp: toNumber(kpi.spp?.value),
        source: kpi.sppSource ?? 'none',
        mode: kpi.sppMode ?? 'avg',
      },
      rows: rows.map((row) => ({
        nmId: toNumber(row.nmId),
        brand: typeof row.brand === 'string' ? row.brand : null,
        vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
        photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
        sppPct: toNumber(row.sppPct),
        sppRub: roundMoney(toNumber(row.sppRub)),
        sppBase: roundMoney(toNumber(row.sppBase)),
      })),
    });
  }

  if (metric === 'conversion') {
    const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
      SELECT
        f.nm_id AS "nmId",
        p.brand,
        p.vendor_code AS "vendorCode",
        p.photo_url AS "photoUrl",
        SUM(f.open_card_count)::numeric AS views,
        SUM(f.order_count)::numeric AS orders,
        SUM(f.order_sum)::numeric AS "orderSum",
        SUM(f.buyout_count)::numeric AS buyouts,
        SUM(f.buyout_sum)::numeric AS "buyoutSum",
        CASE
          WHEN SUM(f.open_card_count) > 0 THEN SUM(f.order_count)::numeric / NULLIF(SUM(f.open_card_count), 0) * 100
          ELSE 0
        END::numeric AS "conversionPct"
      FROM raw_api_funnel_stats f
      LEFT JOIN products p ON p.tenant_id = f.tenant_id AND p.nm_id = f.nm_id
      WHERE f.tenant_id = ${tenantId}
        AND f.period_start::date = f.period_end::date
        AND f.period_start::date >= ${from}::date
        AND f.period_start::date <= ${to}::date
        AND COALESCE(p.is_hidden, FALSE) = FALSE
        ${funnelGroupFilter}
      GROUP BY f.nm_id, p.brand, p.vendor_code, p.photo_url
      HAVING SUM(f.open_card_count) > 0 OR SUM(f.order_count) > 0
      ORDER BY SUM(f.order_count) DESC, SUM(f.open_card_count) DESC
      LIMIT 500
    `)) as Array<Record<string, unknown>>;

    return NextResponse.json({
      metric,
      title: 'Воронка: просмотр → заказ',
      period: { from, to },
      totals: {
        conversion: toNumber(kpi.conversion?.value),
        orders: toNumber(kpi.orders?.value),
        source: kpi.toplineSource ?? 'none',
      },
      rows: rows.map((row) => ({
        nmId: toNumber(row.nmId),
        brand: typeof row.brand === 'string' ? row.brand : null,
        vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
        photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
        views: toNumber(row.views),
        quantity: toNumber(row.orders),
        amount: roundMoney(toNumber(row.orderSum)),
        buyouts: toNumber(row.buyouts),
        buyoutSum: roundMoney(toNumber(row.buyoutSum)),
        conversionPct: toNumber(row.conversionPct),
      })),
    });
  }

  if (metric === 'buyouts') {
    const { financeRows } = await loadFinanceDrilldownRows(tenantId, parsedDateFrom, parsedDateTo, scopeOptions);

    return NextResponse.json({
      metric,
      title: 'Выкупы',
      period: { from, to },
      totals: {
        quantity: toNumber(kpi.buyouts?.value),
        amount: roundMoney(toNumber(kpi.buyoutSum?.value)),
        buyoutRate: toNumber(kpi.buyoutRate?.value),
        source: (kpi as Record<string, unknown>).buyoutsSource ?? 'finance',
      },
      rows: financeRows
        .filter((row) => row.quantity > 0)
        .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue),
    });
  }

  const { financeRows, totals } = await loadFinanceDrilldownRows(tenantId, parsedDateFrom, parsedDateTo, scopeOptions);

  return NextResponse.json({
    metric,
    title: 'Финансы',
    period: { from, to },
    totals: {
      revenue: roundMoney(totals.revenue),
      profit: roundMoney(totals.profit),
      expenses: roundMoney(totals.expenses),
      ads: roundMoney(totals.ads),
      cogs: roundMoney(totals.cogs),
      tax: roundMoney(totals.tax),
    },
    rows: financeRows
      .filter((row) => row.revenue > 0 || row.profit !== 0 || row.expenses > 0)
      .sort((a, b) => b.revenue - a.revenue || a.profit - b.profit),
  });
});

async function loadFinanceDrilldownRows(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  scopeOptions: { calculationMode: 'FACT_WB'; groupId: string | null },
) {
  const rows = (await getFastNetProfitBreakdown(tenantId, dateFrom, dateTo, null, scopeOptions)).items;

  const financeRows = (rows as Array<Record<string, unknown>>).map((item) => {
    const revenue = toNumber(item.grossRevenue);
    const realizedRevenue = toNumber(item.realizedRevenue ?? item.grossRevenue);
    const profit = toNumber(item.netProfit);
    const cogs = toNumber(item.costTotal ?? item.totalCost);
    return {
      nmId: toNumber(item.nmId),
      brand: typeof item.brand === 'string' ? item.brand : null,
      category: typeof item.category === 'string' ? item.category : null,
      vendorCode: typeof item.vendorCode === 'string' ? item.vendorCode : null,
      photoUrl: typeof item.photoUrl === 'string' ? item.photoUrl : null,
      quantity: toNumber(item.soldQuantity),
      revenue: roundMoney(revenue),
      expenses: roundMoney(Math.max(realizedRevenue - profit, 0)),
      profit: roundMoney(profit),
      ads: roundMoney(toNumber(item.adSpend)),
      cogs: roundMoney(cogs),
      costPrice: roundMoney(toNumber(item.costPrice ?? item.purchasePrice)),
      currentStock: toNumber(item.currentStock),
      daysOfStock: toNumber(item.daysOfStock),
      lostOrders: toNumber(item.lostOrdersCount ?? item.lostOrders),
      lostOrdersSum: roundMoney(toNumber(item.lostOrdersSum)),
      stockAnalyticsDays: toNumber(item.stockAnalyticsDays),
      stockTurnoverDays: toNumber(item.stockTurnoverDays),
      stockSizeAvailable: Boolean(item.stockSizeAvailable),
      orders: toNumber(item.orderCount ?? item.orders),
      buyouts: toNumber(item.buyoutCount ?? item.buyouts),
      cancels: toNumber(item.cancelCount ?? item.cancels),
      buyoutRate: toNumber(item.buyoutRate),
      tax: roundMoney(toNumber(item.taxAmount)),
    };
  });

  const totals = financeRows.reduce((acc, row) => {
    acc.revenue += row.revenue;
    acc.profit += row.profit;
    acc.expenses += row.expenses;
    acc.ads += row.ads;
    acc.cogs += row.cogs;
    acc.tax += row.tax;
    return acc;
  }, { revenue: 0, profit: 0, expenses: 0, ads: 0, cogs: 0, tax: 0 });

  return { financeRows, totals };
}
