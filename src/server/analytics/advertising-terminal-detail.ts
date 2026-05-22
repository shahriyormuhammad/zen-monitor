import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';

export type AdvertisingTerminalDailyRow = {
  day: string;
  adSpend: number;
  revenue: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  acosPct: number | null;
  skuCount: number;
};

export type AdvertisingTerminalQueryDailyRow = {
  day: string;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  clickToOrderPct: number | null;
};

export type AdvertisingTerminalQueryRow = {
  cluster: string;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  clickToOrderPct: number | null;
  activeDays: number;
  daily: AdvertisingTerminalQueryDailyRow[];
};

export type AdvertisingTerminalPositionDailyRow = {
  day: string;
  avgPosition: number | null;
  bestPosition: number | null;
  samples: number;
  frequency: number | null;
  impressions: number;
};

export type AdvertisingTerminalPositionRow = {
  keyword: string;
  avgPosition: number | null;
  bestPosition: number | null;
  samples: number;
  activeDays: number;
  frequency: number | null;
  impressions: number;
  daily: AdvertisingTerminalPositionDailyRow[];
};

export type AdvertisingTerminalDetailResponse = {
  generatedAt: string;
  advertId: number;
  nmId: number | null;
  dateWindow: {
    from: string;
    to: string;
  };
  daily: AdvertisingTerminalDailyRow[];
  queries: AdvertisingTerminalQueryRow[];
  positions: AdvertisingTerminalPositionRow[];
};

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

function normalizeDay(value: unknown) {
  return String(value ?? '').slice(0, 10);
}

export async function getAdvertisingTerminalDetail(
  tenantId: string,
  params: {
    advertId: number;
    nmId: number | null;
    dateFrom: Date;
    dateTo: Date;
  },
): Promise<AdvertisingTerminalDetailResponse> {
  const from = toUtcDayStart(params.dateFrom);
  const to = toUtcDayStart(params.dateTo);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const dailyRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      h.stat_date::text AS day,
      COALESCE(SUM(h.ad_spend), 0)::numeric AS ad_spend,
      COALESCE(SUM(h.order_sum), 0)::numeric AS revenue,
      COALESCE(SUM(h.views), 0)::bigint AS views,
      COALESCE(SUM(h.clicks), 0)::bigint AS clicks,
      COALESCE(SUM(h.order_count), 0)::bigint AS orders,
      COUNT(DISTINCT h.nm_id)::int AS sku_count
    FROM advertising_hourly_stats h
    WHERE h.tenant_id = ${tenantId}
      AND h.advert_id = ${params.advertId}
      AND h.stat_date >= ${fromDate}::date
      AND h.stat_date <= ${toDate}::date
    GROUP BY h.stat_date
    ORDER BY h.stat_date DESC
  `));

  const daily = dailyRaw.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    const adSpend = round(toNumber(row.ad_spend), 2);
    const revenue = round(toNumber(row.revenue), 2);
    const views = toInt(row.views);
    const clicks = toInt(row.clicks);
    const orders = toInt(row.orders);
    return {
      day: normalizeDay(row.day),
      adSpend,
      revenue,
      views,
      clicks,
      orders,
      ctrPct: pct(clicks, views),
      cpc: ratio(adSpend, clicks),
      acosPct: pct(adSpend, revenue),
      skuCount: Math.max(1, toInt(row.sku_count)),
    };
  });

  const queryRowsRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH campaign_nm AS (
      SELECT DISTINCT h.nm_id
      FROM advertising_hourly_stats h
      WHERE h.tenant_id = ${tenantId}
        AND h.advert_id = ${params.advertId}
        AND h.stat_date >= ${fromDate}::date
        AND h.stat_date <= ${toDate}::date
        ${params.nmId === null ? sql`` : sql`AND h.nm_id = ${params.nmId}`}
    )
    SELECT
      c.cluster,
      (c.date AT TIME ZONE 'Europe/Moscow')::date::text AS day,
      COALESCE(SUM(c.amount), 0)::numeric AS ad_spend,
      COALESCE(SUM(c.views), 0)::bigint AS views,
      COALESCE(SUM(c.clicks), 0)::bigint AS clicks,
      COALESCE(SUM(c.order_count), 0)::bigint AS orders
    FROM raw_api_ad_clusters c
    WHERE c.tenant_id = ${tenantId}
      AND (c.date AT TIME ZONE 'Europe/Moscow')::date >= ${fromDate}::date
      AND (c.date AT TIME ZONE 'Europe/Moscow')::date <= ${toDate}::date
      AND EXISTS (
        SELECT 1
        FROM campaign_nm n
        WHERE n.nm_id = c.nm_id
      )
    GROUP BY c.cluster, day
  `));

  const queryMap = new Map<string, {
    cluster: string;
    adSpend: number;
    views: number;
    clicks: number;
    orders: number;
    daily: AdvertisingTerminalQueryDailyRow[];
  }>();

  for (const rawRow of queryRowsRaw) {
    const row = rawRow as Record<string, unknown>;
    const cluster = String(row.cluster ?? '').trim();
    if (!cluster) {
      continue;
    }

    const adSpend = round(toNumber(row.ad_spend), 2);
    const views = toInt(row.views);
    const clicks = toInt(row.clicks);
    const orders = toInt(row.orders);
    const dayRow = {
      day: normalizeDay(row.day),
      adSpend,
      views,
      clicks,
      orders,
      ctrPct: pct(clicks, views),
      cpc: ratio(adSpend, clicks),
      clickToOrderPct: pct(orders, clicks),
    };
    const existing = queryMap.get(cluster) ?? {
      cluster,
      adSpend: 0,
      views: 0,
      clicks: 0,
      orders: 0,
      daily: [],
    };
    existing.adSpend = round(existing.adSpend + adSpend, 2);
    existing.views += views;
    existing.clicks += clicks;
    existing.orders += orders;
    existing.daily.push(dayRow);
    queryMap.set(cluster, existing);
  }

  const queries = [...queryMap.values()]
    .map((row) => ({
      ...row,
      ctrPct: pct(row.clicks, row.views),
      cpc: ratio(row.adSpend, row.clicks),
      clickToOrderPct: pct(row.orders, row.clicks),
      activeDays: row.daily.length,
      daily: row.daily.sort((left, right) => right.day.localeCompare(left.day)),
    }))
    .sort((left, right) => {
      if (right.adSpend !== left.adSpend) {
        return right.adSpend - left.adSpend;
      }
      if (right.clicks !== left.clicks) {
        return right.clicks - left.clicks;
      }
      return right.views - left.views;
    })
    .slice(0, 80);

  const positionRowsRaw = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH campaign_nm AS (
      SELECT DISTINCT h.nm_id
      FROM advertising_hourly_stats h
      WHERE h.tenant_id = ${tenantId}
        AND h.advert_id = ${params.advertId}
        AND h.stat_date >= ${fromDate}::date
        AND h.stat_date <= ${toDate}::date
        ${params.nmId === null ? sql`` : sql`AND h.nm_id = ${params.nmId}`}
    )
    SELECT
      p.keyword,
      p.observed_date::text AS day,
      AVG(p.position) FILTER (WHERE p.position IS NOT NULL AND p.position > 0)::numeric AS avg_position,
      MIN(p.position) FILTER (WHERE p.position IS NOT NULL AND p.position > 0)::int AS best_position,
      COUNT(p.position) FILTER (WHERE p.position IS NOT NULL AND p.position > 0)::int AS samples,
      MAX(p.frequency)::int AS frequency,
      COALESCE(SUM(p.impressions), 0)::bigint AS impressions
    FROM procifry_search_positions p
    WHERE p.tenant_id = ${tenantId}
      AND p.observed_date >= ${fromDate}::date
      AND p.observed_date <= ${toDate}::date
      AND EXISTS (
        SELECT 1
        FROM campaign_nm n
        WHERE n.nm_id = p.nm_id
      )
    GROUP BY p.keyword, p.observed_date
    HAVING COUNT(p.position) FILTER (WHERE p.position IS NOT NULL AND p.position > 0) > 0
  `));

  const positionMap = new Map<string, {
    keyword: string;
    weightedPositionSum: number;
    samples: number;
    bestPosition: number | null;
    frequency: number | null;
    impressions: number;
    daily: AdvertisingTerminalPositionDailyRow[];
  }>();

  for (const rawRow of positionRowsRaw) {
    const row = rawRow as Record<string, unknown>;
    const keyword = String(row.keyword ?? '').trim();
    if (!keyword) {
      continue;
    }

    const samples = toInt(row.samples);
    const avgPosition = row.avg_position === null ? null : round(toNumber(row.avg_position), 2);
    const bestPosition = row.best_position === null ? null : toInt(row.best_position);
    const frequency = row.frequency === null ? null : toInt(row.frequency);
    const impressions = toInt(row.impressions);
    const dayRow = {
      day: normalizeDay(row.day),
      avgPosition,
      bestPosition,
      samples,
      frequency,
      impressions,
    };
    const existing = positionMap.get(keyword) ?? {
      keyword,
      weightedPositionSum: 0,
      samples: 0,
      bestPosition: null,
      frequency: null,
      impressions: 0,
      daily: [],
    };
    if (avgPosition !== null && samples > 0) {
      existing.weightedPositionSum += avgPosition * samples;
      existing.samples += samples;
    }
    if (bestPosition !== null) {
      existing.bestPosition = existing.bestPosition === null
        ? bestPosition
        : Math.min(existing.bestPosition, bestPosition);
    }
    if (frequency !== null) {
      existing.frequency = existing.frequency === null ? frequency : Math.max(existing.frequency, frequency);
    }
    existing.impressions += impressions;
    existing.daily.push(dayRow);
    positionMap.set(keyword, existing);
  }

  const positions = [...positionMap.values()]
    .map((row) => ({
      keyword: row.keyword,
      avgPosition: row.samples > 0 ? round(row.weightedPositionSum / row.samples, 2) : null,
      bestPosition: row.bestPosition,
      samples: row.samples,
      activeDays: row.daily.length,
      frequency: row.frequency,
      impressions: row.impressions,
      daily: row.daily.sort((left, right) => right.day.localeCompare(left.day)),
    }))
    .sort((left, right) => {
      if (left.bestPosition !== null && right.bestPosition !== null && left.bestPosition !== right.bestPosition) {
        return left.bestPosition - right.bestPosition;
      }
      if (left.bestPosition !== null && right.bestPosition === null) {
        return -1;
      }
      if (left.bestPosition === null && right.bestPosition !== null) {
        return 1;
      }
      if (right.samples !== left.samples) {
        return right.samples - left.samples;
      }
      return right.impressions - left.impressions;
    })
    .slice(0, 80);

  return {
    generatedAt: new Date().toISOString(),
    advertId: params.advertId,
    nmId: params.nmId,
    dateWindow: {
      from: fromDate,
      to: toDate,
    },
    daily,
    queries,
    positions,
  };
}
