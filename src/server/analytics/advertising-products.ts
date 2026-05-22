import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import type {
  AdvertisingProductListRow,
  AdvertisingProductsResponse,
} from '@/components/advertising/_shared/types';

function toUtcDayStart(value: Date) {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: unknown) {
  return Math.max(0, Math.round(toNumber(value)));
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round((numerator / denominator) * 100, 2);
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, 2);
}

function classifyRow(row: Pick<AdvertisingProductListRow, 'adSpend' | 'revenue' | 'orders' | 'clicks' | 'views' | 'acosPct' | 'ctrPct'>) {
  if ((row.adSpend >= 500 && row.revenue <= 0) || (row.clicks >= 20 && row.orders === 0)) {
    return {
      risk: 'danger' as const,
      reason: 'Есть расход, но нет продажного результата.',
    };
  }

  if ((row.acosPct !== null && row.acosPct >= 40) || (row.views >= 1000 && (row.ctrPct === null || row.ctrPct < 0.4))) {
    return {
      risk: 'warning' as const,
      reason: row.acosPct !== null && row.acosPct >= 40
        ? 'ДРР выше рабочего уровня.'
        : 'Много показов, но слабый CTR.',
    };
  }

  return {
    risk: 'good' as const,
    reason: 'Критичных рекламных отклонений нет.',
  };
}

export async function getAdvertisingProducts(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<AdvertisingProductsResponse> {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const rowsRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH group_map AS (
      SELECT
        gm.nm_id,
        pg.id AS group_id,
        pg.name AS group_name,
        COUNT(*) OVER (PARTITION BY pg.id)::int AS group_nm_count,
        ROW_NUMBER() OVER (PARTITION BY gm.nm_id ORDER BY pg.created_at, pg.id) AS rn
      FROM product_group_members gm
      JOIN product_groups pg
        ON pg.id = gm.group_id
       AND pg.tenant_id = ${tenantId}
    ),
    scoped AS (
      SELECT
        COALESCE(gm.group_id::text, 'sku:' || h.nm_id::text) AS scope_key,
        gm.group_id,
        gm.group_name,
        COALESCE(gm.group_nm_count, 1)::int AS group_nm_count,
        h.nm_id,
        SUM(h.ad_spend)::numeric AS ad_spend,
        SUM(h.views)::bigint AS views,
        SUM(h.clicks)::bigint AS clicks,
        SUM(h.order_count)::bigint AS orders,
        SUM(h.order_sum)::numeric AS revenue
      FROM advertising_hourly_stats h
      LEFT JOIN group_map gm
        ON gm.nm_id = h.nm_id
       AND gm.rn = 1
      WHERE h.tenant_id = ${tenantId}
        AND h.stat_date >= ${fromDate}::date
        AND h.stat_date <= ${toDate}::date
      GROUP BY
        COALESCE(gm.group_id::text, 'sku:' || h.nm_id::text),
        gm.group_id,
        gm.group_name,
        COALESCE(gm.group_nm_count, 1),
        h.nm_id
    ),
    scope_totals AS (
      SELECT
        scope_key,
        group_id,
        group_name,
        MAX(group_nm_count)::int AS group_nm_count,
        COUNT(DISTINCT nm_id)::int AS advertised_nm_count,
        SUM(ad_spend)::numeric AS ad_spend,
        SUM(views)::bigint AS views,
        SUM(clicks)::bigint AS clicks,
        SUM(orders)::bigint AS orders,
        SUM(revenue)::numeric AS revenue
      FROM scoped
      GROUP BY scope_key, group_id, group_name
    ),
    primary_nm AS (
      SELECT DISTINCT ON (scope_key)
        scope_key,
        nm_id
      FROM scoped
      ORDER BY scope_key, ad_spend DESC, nm_id
    )
    SELECT
      pnm.nm_id,
      st.group_id,
      st.group_name,
      st.group_nm_count,
      st.advertised_nm_count,
      st.ad_spend,
      st.views,
      st.clicks,
      st.orders,
      st.revenue,
      p.vendor_code,
      p.brand,
      p.photo_url,
      meta.title
    FROM scope_totals st
    JOIN primary_nm pnm
      ON pnm.scope_key = st.scope_key
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = pnm.nm_id
     AND COALESCE(p.is_hidden, FALSE) = FALSE
    LEFT JOIN raw_api_product_metadata meta
      ON meta.tenant_id = ${tenantId}
     AND meta.nm_id = pnm.nm_id
    WHERE st.ad_spend > 0 OR st.views > 0 OR st.clicks > 0 OR st.orders > 0 OR st.revenue > 0
    ORDER BY st.ad_spend DESC
    LIMIT 80
  `));

  const rows: AdvertisingProductListRow[] = rowsRaw.map((row) => {
    const record = row as Record<string, unknown>;
    const adSpend = round(toNumber(record.ad_spend), 2);
    const revenue = round(toNumber(record.revenue), 2);
    const views = toInt(record.views);
    const clicks = toInt(record.clicks);
    const orders = toInt(record.orders);
    const groupId = (record.group_id as string | null) ?? null;
    const base = {
      nmId: toInt(record.nm_id),
      vendorCode: (record.vendor_code as string | null) ?? null,
      brand: (record.brand as string | null) ?? null,
      photoUrl: (record.photo_url as string | null) ?? null,
      title: (record.title as string | null) ?? null,
      attributionScope: groupId ? 'group' as const : 'sku' as const,
      groupId,
      groupName: (record.group_name as string | null) ?? null,
      groupNmCount: Math.max(1, toInt(record.group_nm_count)),
      advertisedNmCount: Math.max(1, toInt(record.advertised_nm_count)),
      adSpend,
      views,
      clicks,
      orders,
      revenue,
      acosPct: pct(adSpend, revenue),
      roas: ratio(revenue, adSpend),
      ctrPct: pct(clicks, views),
      cpc: ratio(adSpend, clicks),
    };
    return {
      ...base,
      ...classifyRow(base),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    hasData: rows.length > 0,
    total: rows.length,
    rows,
  };
}
