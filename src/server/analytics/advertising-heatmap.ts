import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { advertisingHourlyStats, productGroupMembers, productGroups } from '@/lib/db/schema';
import { getAdvertisingOverview } from '@/server/analytics/advertising';

export type AdvertisingHeatmapGranularity = 'hourly' | 'daily';

export type AdvertisingHeatmapPoint = {
  weekday: number;
  hour: number | null;
  day: string | null;
  adSpend: number;
  revenue: number;
  views: number;
  clicks: number;
  orders: number;
  acosPct: number | null;
  cpc: number | null;
  ctrPct: number | null;
};

export type AdvertisingHeatmapResponse = {
  generatedAt: string;
  granularity: AdvertisingHeatmapGranularity;
  source: 'advertising_hourly_stats' | 'advertising_overview_daily';
  scope: AdvertisingHeatmapScope;
  points: AdvertisingHeatmapPoint[];
};

export type AdvertisingHeatmapScope = {
  advertId: number | null;
  nmId: number | null;
  attributionScope: 'tenant' | 'campaign' | 'sku' | 'group';
  groupId: string | null;
  groupName: string | null;
  groupNmCount: number;
  matchedNmIds: number[];
};

export type AdvertisingHeatmapOptions = {
  advertId?: number | null;
  nmId?: number | null;
  includeGroup?: boolean;
};

function toUtcDayStart(value: Date) {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function toDateParam(value: Date) {
  return toUtcDayStart(value).toISOString().slice(0, 10);
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

function weekdayIndex(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return (date.getUTCDay() + 6) % 7;
}

function normalizePositiveInt(value: number | null | undefined) {
  if (value == null) {
    return null;
  }
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function resolveHeatmapScope(
  tenantId: string,
  options?: AdvertisingHeatmapOptions,
): Promise<AdvertisingHeatmapScope> {
  const advertId = normalizePositiveInt(options?.advertId);
  const nmId = normalizePositiveInt(options?.nmId);
  const includeGroup = options?.includeGroup !== false;

  if (!nmId) {
    return {
      advertId,
      nmId: null,
      attributionScope: advertId ? 'campaign' : 'tenant',
      groupId: null,
      groupName: null,
      groupNmCount: 1,
      matchedNmIds: [],
    };
  }

  if (!includeGroup) {
    return {
      advertId,
      nmId,
      attributionScope: 'sku',
      groupId: null,
      groupName: null,
      groupNmCount: 1,
      matchedNmIds: [nmId],
    };
  }

  const [group] = await withTenantContext(db, tenantId, (tx) => tx
    .select({
      groupId: productGroups.id,
      groupName: productGroups.name,
    })
    .from(productGroupMembers)
    .innerJoin(productGroups, eq(productGroups.id, productGroupMembers.groupId))
    .where(and(
      eq(productGroups.tenantId, tenantId),
      eq(productGroupMembers.nmId, nmId),
    ))
    .limit(1));

  if (!group) {
    return {
      advertId,
      nmId,
      attributionScope: 'sku',
      groupId: null,
      groupName: null,
      groupNmCount: 1,
      matchedNmIds: [nmId],
    };
  }

  const members = await withTenantContext(db, tenantId, (tx) => tx
    .select({ nmId: productGroupMembers.nmId })
    .from(productGroupMembers)
    .where(eq(productGroupMembers.groupId, group.groupId)));
  const matchedNmIds = Array.from(new Set(members.map((member) => Number(member.nmId)).filter((item) => item > 0)));

  return {
    advertId,
    nmId,
    attributionScope: 'group',
    groupId: group.groupId,
    groupName: group.groupName,
    groupNmCount: Math.max(1, matchedNmIds.length),
    matchedNmIds: matchedNmIds.length > 0 ? matchedNmIds : [nmId],
  };
}

export async function getAdvertisingHeatmap(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  options?: AdvertisingHeatmapOptions,
): Promise<AdvertisingHeatmapResponse> {
  const fromParam = toDateParam(dateFrom);
  const toParam = toDateParam(dateTo);
  const scope = await resolveHeatmapScope(tenantId, options);
  const conditions = [
    eq(advertisingHourlyStats.tenantId, tenantId),
    gte(advertisingHourlyStats.statDate, fromParam),
    lte(advertisingHourlyStats.statDate, toParam),
  ];

  if (scope.advertId) {
    conditions.push(eq(advertisingHourlyStats.advertId, scope.advertId));
  }

  if (scope.matchedNmIds.length === 1) {
    conditions.push(eq(advertisingHourlyStats.nmId, scope.matchedNmIds[0]!));
  } else if (scope.matchedNmIds.length > 1) {
    conditions.push(inArray(advertisingHourlyStats.nmId, scope.matchedNmIds));
  }

  const hourlyRows = await withTenantContext(db, tenantId, (tx) => tx
    .select({
      weekday: sql<number>`((EXTRACT(DOW FROM (${advertisingHourlyStats.statHour} AT TIME ZONE 'Europe/Moscow'))::int + 6) % 7)`,
      hour: sql<number>`EXTRACT(HOUR FROM (${advertisingHourlyStats.statHour} AT TIME ZONE 'Europe/Moscow'))::int`,
      adSpend: sql<string>`COALESCE(SUM(${advertisingHourlyStats.adSpend}), 0)::numeric`,
      revenue: sql<string>`COALESCE(SUM(${advertisingHourlyStats.orderSum}), 0)::numeric`,
      views: sql<number>`COALESCE(SUM(${advertisingHourlyStats.views}), 0)::int`,
      clicks: sql<number>`COALESCE(SUM(${advertisingHourlyStats.clicks}), 0)::int`,
      orders: sql<number>`COALESCE(SUM(${advertisingHourlyStats.orderCount}), 0)::int`,
    })
    .from(advertisingHourlyStats)
    .where(and(...conditions))
    .groupBy(
      sql`((EXTRACT(DOW FROM (${advertisingHourlyStats.statHour} AT TIME ZONE 'Europe/Moscow'))::int + 6) % 7)`,
      sql`EXTRACT(HOUR FROM (${advertisingHourlyStats.statHour} AT TIME ZONE 'Europe/Moscow'))::int`,
    )
    .orderBy(
      sql`((EXTRACT(DOW FROM (${advertisingHourlyStats.statHour} AT TIME ZONE 'Europe/Moscow'))::int + 6) % 7)`,
      sql`EXTRACT(HOUR FROM (${advertisingHourlyStats.statHour} AT TIME ZONE 'Europe/Moscow'))::int`,
    ));

  const hourlyPoints: AdvertisingHeatmapPoint[] = hourlyRows
    .map((row) => {
      const adSpend = toNumber(row.adSpend);
      const revenue = toNumber(row.revenue);
      const views = toInt(row.views);
      const clicks = toInt(row.clicks);
      return {
        weekday: toInt(row.weekday),
        hour: toInt(row.hour),
        day: null,
        adSpend: round(adSpend, 2),
        revenue: round(revenue, 2),
        views,
        clicks,
        orders: toInt(row.orders),
        acosPct: pct(adSpend, revenue),
        cpc: ratio(adSpend, clicks),
        ctrPct: pct(clicks, views),
      };
    })
    .filter((point) => point.adSpend > 0 || point.revenue > 0 || point.views > 0 || point.clicks > 0 || point.orders > 0);

  if (hourlyPoints.length > 0) {
    return {
      generatedAt: new Date().toISOString(),
      granularity: 'hourly',
      source: 'advertising_hourly_stats',
      scope,
      points: hourlyPoints,
    };
  }

  if (scope.attributionScope !== 'tenant') {
    return {
      generatedAt: new Date().toISOString(),
      granularity: 'daily',
      source: 'advertising_overview_daily',
      scope,
      points: [],
    };
  }

  const overview = await getAdvertisingOverview(tenantId, dateFrom, dateTo);
  return {
    generatedAt: new Date().toISOString(),
    granularity: 'daily',
    source: 'advertising_overview_daily',
    scope,
    points: overview.daily.map((point) => ({
      weekday: weekdayIndex(point.day),
      hour: null,
      day: point.day,
      adSpend: point.adSpend,
      revenue: point.revenue,
      views: point.views,
      clicks: point.clicks,
      orders: point.orders,
      acosPct: point.acosPct,
      cpc: point.cpc,
      ctrPct: point.ctrPct,
    })),
  };
}
