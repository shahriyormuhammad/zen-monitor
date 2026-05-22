import { and, desc, eq, lt, sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { advertisingHourlyStats, tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { wbApi } from '@/lib/wb-api';

const HOURLY_STATS_SOURCE = 'adv_v3_fullstats_delta';

type CumulativePoint = {
  adSpend: number;
  views: number;
  clicks: number;
  orderCount: number;
  orderSum: number;
};

export type AdvertisingHourlyDelta = CumulativePoint & {
  firstSnapshot: boolean;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function positiveMoneyDelta(current: number, previous: number) {
  return roundMoney(Math.max(0, current - previous));
}

function positiveIntDelta(current: number, previous: number) {
  return Math.max(0, Math.round(current - previous));
}

function truncateToUtcHour(date: Date) {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  return next;
}

function toMoscowDateParam(date: Date) {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeStatDate(value: string) {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? value;
}

export function computeAdvertisingHourlyDelta(
  current: CumulativePoint,
  previous: CumulativePoint | null,
): AdvertisingHourlyDelta {
  if (!previous) {
    return {
      firstSnapshot: true,
      adSpend: 0,
      views: 0,
      clicks: 0,
      orderCount: 0,
      orderSum: 0,
    };
  }

  return {
    firstSnapshot: false,
    adSpend: positiveMoneyDelta(current.adSpend, previous.adSpend),
    views: positiveIntDelta(current.views, previous.views),
    clicks: positiveIntDelta(current.clicks, previous.clicks),
    orderCount: positiveIntDelta(current.orderCount, previous.orderCount),
    orderSum: positiveMoneyDelta(current.orderSum, previous.orderSum),
  };
}

async function getTenantWbToken(tenantId: string) {
  const [tenant] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const token = decryptIfNeeded(tenant?.wbApiToken ?? '').trim();
  if (!token) {
    throw new AppError('Для кабинета не сохранён WB API токен. Добавьте токен в настройках.', 400);
  }
  return token;
}

export async function syncAdvertisingHourlyStats(
  tenantId: string,
  options?: {
    now?: Date;
    date?: string;
    signal?: AbortSignal;
  },
) {
  const now = options?.now ?? new Date();
  const statHour = truncateToUtcHour(now);
  const statDate = options?.date ?? toMoscowDateParam(now);
  const token = await getTenantWbToken(tenantId);
  const campaigns = await wbApi.getAdCampaigns(token, { signal: options?.signal });
  const spendItems = await wbApi.getAdSpend(token, statDate, statDate, {
    campaigns,
    signal: options?.signal,
    groupBy: 'advert_nm_date',
  });

  let synced = 0;
  let firstSnapshots = 0;

  await withTenantContext(db, tenantId, async (tx) => {
    for (const item of spendItems) {
      const itemStatDate = normalizeStatDate(item.date || statDate);
      const advertId = Math.max(0, Math.round(toNumber(item.advertId)));
      if (advertId <= 0) {
        continue;
      }

      const current: CumulativePoint = {
        adSpend: roundMoney(toNumber(item.sum)),
        views: Math.max(0, Math.round(toNumber(item.views))),
        clicks: Math.max(0, Math.round(toNumber(item.clicks))),
        orderCount: Math.max(0, Math.round(toNumber(item.orderCount))),
        orderSum: roundMoney(toNumber(item.orderSum)),
      };

      const [previousRow] = await tx
        .select({
          cumulativeAdSpend: advertisingHourlyStats.cumulativeAdSpend,
          cumulativeViews: advertisingHourlyStats.cumulativeViews,
          cumulativeClicks: advertisingHourlyStats.cumulativeClicks,
          cumulativeOrderCount: advertisingHourlyStats.cumulativeOrderCount,
          cumulativeOrderSum: advertisingHourlyStats.cumulativeOrderSum,
        })
        .from(advertisingHourlyStats)
        .where(and(
          eq(advertisingHourlyStats.tenantId, tenantId),
          eq(advertisingHourlyStats.advertId, advertId),
          eq(advertisingHourlyStats.nmId, item.nmId),
          eq(advertisingHourlyStats.statDate, itemStatDate),
          eq(advertisingHourlyStats.source, HOURLY_STATS_SOURCE),
          lt(advertisingHourlyStats.statHour, statHour),
        ))
        .orderBy(desc(advertisingHourlyStats.statHour))
        .limit(1);

      const previous = previousRow
        ? {
          adSpend: toNumber(previousRow.cumulativeAdSpend),
          views: toNumber(previousRow.cumulativeViews),
          clicks: toNumber(previousRow.cumulativeClicks),
          orderCount: toNumber(previousRow.cumulativeOrderCount),
          orderSum: toNumber(previousRow.cumulativeOrderSum),
        }
        : null;
      const delta = computeAdvertisingHourlyDelta(current, previous);
      if (delta.firstSnapshot) {
        firstSnapshots += 1;
      }

      await tx.insert(advertisingHourlyStats)
        .values({
          tenantId,
          advertId,
          nmId: item.nmId,
          statDate: itemStatDate,
          statHour,
          adSpend: String(delta.adSpend),
          views: delta.views,
          clicks: delta.clicks,
          orderCount: delta.orderCount,
          orderSum: String(delta.orderSum),
          cumulativeAdSpend: String(current.adSpend),
          cumulativeViews: current.views,
          cumulativeClicks: current.clicks,
          cumulativeOrderCount: current.orderCount,
          cumulativeOrderSum: String(current.orderSum),
          source: HOURLY_STATS_SOURCE,
        })
        .onConflictDoUpdate({
          target: [
            advertisingHourlyStats.tenantId,
            advertisingHourlyStats.advertId,
            advertisingHourlyStats.nmId,
            advertisingHourlyStats.statHour,
            advertisingHourlyStats.source,
          ],
          set: {
            adSpend: sql`EXCLUDED.ad_spend`,
            views: sql`EXCLUDED.views`,
            clicks: sql`EXCLUDED.clicks`,
            orderCount: sql`EXCLUDED.order_count`,
            orderSum: sql`EXCLUDED.order_sum`,
            cumulativeAdSpend: sql`EXCLUDED.cumulative_ad_spend`,
            cumulativeViews: sql`EXCLUDED.cumulative_views`,
            cumulativeClicks: sql`EXCLUDED.cumulative_clicks`,
            cumulativeOrderCount: sql`EXCLUDED.cumulative_order_count`,
            cumulativeOrderSum: sql`EXCLUDED.cumulative_order_sum`,
            updatedAt: new Date(),
          },
        });

      synced += 1;
    }
  });

  return {
    synced,
    firstSnapshots,
    statDate,
    statHour: statHour.toISOString(),
    source: HOURLY_STATS_SOURCE,
  };
}
