import { inArray, sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { rawApiOrders } from '@/lib/db/schema';
import { wbApi } from '@/lib/wb-api';
import {
  type WbAdSpendHistoryEntry,
  wbGetAdSpendHistoryEntries,
} from '@/lib/wb-api/ads-balance';

type OrderWeightRow = {
  nmId: number;
  dayKey: string;
  orderCount: number;
  orderSum: number;
};

export type HistoricalAdCostInsert = {
  tenantId: string;
  nmId: number;
  date: Date;
  amount: string;
  orderCount: number;
  orderSum: string;
  views?: number;
  clicks?: number;
  type: string;
  placement: string;
};

export function dedupeAdCostRows(rows: HistoricalAdCostInsert[]) {
  const byKey = new Map<string, HistoricalAdCostInsert & {
    amountValue: number;
    orderSumValue: number;
    viewsValue: number;
    clicksValue: number;
  }>();

  for (const row of rows) {
    const dateKey = row.date.toISOString();
    const key = `${row.tenantId}:${row.nmId}:${dateKey}:${row.placement}`;
    const amountValue = toFiniteNumber(row.amount);
    const orderSumValue = toFiniteNumber(row.orderSum);
    const viewsValue = Math.max(0, Math.round(toFiniteNumber(row.views)));
    const clicksValue = Math.max(0, Math.round(toFiniteNumber(row.clicks)));
    const current = byKey.get(key);

    if (!current) {
      byKey.set(key, {
        ...row,
        amountValue,
        orderCount: Math.max(0, Math.round(row.orderCount || 0)),
        orderSumValue,
        viewsValue,
        clicksValue,
      });
      continue;
    }

    current.amountValue += amountValue;
    current.viewsValue += viewsValue;
    current.clicksValue += clicksValue;
    current.orderCount = Math.max(
      current.orderCount || 0,
      Math.max(0, Math.round(row.orderCount || 0)),
    );
    current.orderSumValue = Math.max(current.orderSumValue, orderSumValue);
  }

  return Array.from(byKey.values()).map(({ amountValue, orderSumValue, viewsValue, clicksValue, ...row }) => ({
    ...row,
    amount: roundMoney(amountValue).toFixed(2),
    orderSum: roundMoney(orderSumValue).toFixed(2),
    views: viewsValue,
    clicks: clicksValue,
  }));
}

export type HistoricalAdCostBuildResult = {
  rows: HistoricalAdCostInsert[];
  campaignCount: number;
  historyRowCount: number;
  totalAmountRub: number;
  unallocatedCampaignCount: number;
  unallocatedAmountRub: number;
};

type BuildHistoricalAdCostsParams = {
  tenantId: string;
  token: string;
  dateFrom: string;
  dateTo: string;
  signal?: AbortSignal;
};

const MAX_HISTORY_WINDOW_DAYS = 31;
const UNALLOCATED_AD_NM_ID = 0;

function normalizeDateOnly(value: string) {
  return value.slice(0, 10);
}

function toUtcStart(dateOnly: string) {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function toUtcExclusive(dateOnly: string) {
  const date = toUtcStart(dateOnly);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function splitDateRangeByMaxDays(fromDate: string, toDate: string, maxDays: number) {
  const windows: Array<{ from: string; to: string }> = [];
  const end = toUtcStart(toDate);
  const cursor = toUtcStart(fromDate);

  while (cursor <= end) {
    const windowEnd = new Date(cursor);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + Math.max(1, maxDays) - 1);
    if (windowEnd > end) {
      windowEnd.setTime(end.getTime());
    }

    windows.push({
      from: cursor.toISOString().slice(0, 10),
      to: windowEnd.toISOString().slice(0, 10),
    });

    cursor.setTime(windowEnd.getTime());
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }

  return windows;
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function extractLeadingNmId(value: string | null) {
  const match = value?.trim().match(/^(\d{5,})\b/);
  if (!match) {
    return null;
  }

  const nmId = Number(match[1]);
  return Number.isFinite(nmId) && nmId > 0 ? Math.trunc(nmId) : null;
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function fromCents(value: number) {
  return value / 100;
}

function resolveHistoryDay(
  entry: WbAdSpendHistoryEntry,
  dateFrom: string,
  dateTo: string,
) {
  if (entry.updTime) {
    return entry.updTime.slice(0, 10);
  }

  return dateFrom === dateTo ? dateFrom : dateTo;
}

function distributeCents(totalCents: number, weights: number[]) {
  if (weights.length === 0) {
    return [];
  }

  const sign = totalCents < 0 ? -1 : 1;
  const absoluteTotal = Math.abs(totalCents);
  const normalizedWeights = weights.map((weight) => Math.max(0, weight));
  const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);

  if (weightTotal <= 0) {
    const base = Math.floor(absoluteTotal / weights.length);
    let remainder = absoluteTotal - base * weights.length;
    return weights.map(() => {
      const next = base + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      return next * sign;
    });
  }

  const rawShares = normalizedWeights.map((weight) => (absoluteTotal * weight) / weightTotal);
  const floors = rawShares.map((value) => Math.floor(value));
  let remainder = absoluteTotal - floors.reduce((sum, value) => sum + value, 0);
  const rankedIndexes = rawShares
    .map((value, index) => ({ index, fraction: value - floors[index]! }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (const item of rankedIndexes) {
    if (remainder <= 0) {
      break;
    }
    floors[item.index] = floors[item.index]! + 1;
    remainder -= 1;
  }

  return floors.map((value) => value * sign);
}

async function loadOrderWeights(
  tenantId: string,
  fromDate: string,
  toDate: string,
  nmIds: number[],
): Promise<Map<string, OrderWeightRow>> {
  if (nmIds.length === 0) {
    return new Map();
  }

  const from = toUtcStart(fromDate);
  const toExclusive = toUtcExclusive(toDate);
  const fromIso = from.toISOString();
  const toExclusiveIso = toExclusive.toISOString();

  const rows = await withTenantContext(db, tenantId, async (tx) => tx.execute<OrderWeightRow>(sql`
    SELECT
      ${rawApiOrders.nmId} AS "nmId",
      TO_CHAR(DATE_TRUNC('day', ${rawApiOrders.date}), 'YYYY-MM-DD') AS "dayKey",
      COUNT(*)::int AS "orderCount",
      COALESCE(SUM(${rawApiOrders.totalPrice}), 0)::numeric AS "orderSum"
    FROM ${rawApiOrders}
    WHERE ${rawApiOrders.tenantId} = ${tenantId}
      AND ${rawApiOrders.isCancel} = FALSE
      AND ${rawApiOrders.date} >= ${fromIso}::timestamptz
      AND ${rawApiOrders.date} < ${toExclusiveIso}::timestamptz
      AND ${inArray(rawApiOrders.nmId, nmIds)}
    GROUP BY ${rawApiOrders.nmId}, DATE_TRUNC('day', ${rawApiOrders.date})
  `));

  const weights = new Map<string, OrderWeightRow>();
  for (const row of rows) {
    weights.set(`${row.dayKey}:${row.nmId}`, {
      nmId: Number(row.nmId),
      dayKey: String(row.dayKey),
      orderCount: Math.max(0, Math.trunc(toFiniteNumber(row.orderCount))),
      orderSum: toFiniteNumber(row.orderSum),
    });
  }

  return weights;
}

export async function buildHistoricalAdCostRows(
  params: BuildHistoricalAdCostsParams,
): Promise<HistoricalAdCostBuildResult> {
  const fromDate = normalizeDateOnly(params.dateFrom);
  const toDate = normalizeDateOnly(params.dateTo);
  const historyWindows = splitDateRangeByMaxDays(fromDate, toDate, MAX_HISTORY_WINDOW_DAYS);
  const historyEntries: WbAdSpendHistoryEntry[] = [];
  for (const window of historyWindows) {
    historyEntries.push(...await wbGetAdSpendHistoryEntries(
      params.token,
      window.from,
      window.to,
      { signal: params.signal },
    ));
  }
  const filteredEntries = historyEntries.filter((entry) => Number.isFinite(entry.updSum) && entry.updSum !== 0);
  const advertIds = Array.from(new Set(filteredEntries.map((entry) => entry.advertId)));
  const nmIdByAdvertIdFromName = new Map<number, number>();
  for (const entry of filteredEntries) {
    const nmId = extractLeadingNmId(entry.campName);
    if (nmId) {
      nmIdByAdvertIdFromName.set(entry.advertId, nmId);
    }
  }

  const unresolvedAdvertIds = advertIds.filter((advertId) => !nmIdByAdvertIdFromName.has(advertId));
  const campaigns = unresolvedAdvertIds.length > 0
    ? await wbApi.getAdCampaignsByAdvertIds(params.token, unresolvedAdvertIds, {
      signal: params.signal,
    })
    : [];

  const campaignById = new Map(campaigns.map((campaign) => [campaign.advertId, campaign]));
  const candidateNmIds = Array.from(new Set(
    [
      ...Array.from(nmIdByAdvertIdFromName.values()),
      ...campaigns.flatMap((campaign) => campaign.nmIds),
    ]
      .filter((nmId) => Number.isFinite(nmId) && nmId > 0)
      .map((nmId) => Math.trunc(nmId)),
  ));
  const orderWeights = await loadOrderWeights(params.tenantId, fromDate, toDate, candidateNmIds);

  const rows: HistoricalAdCostInsert[] = [];
  let totalAmountCents = 0;
  let unallocatedAmountCents = 0;
  let unallocatedCampaignCount = 0;

  for (const entry of filteredEntries) {
    const campaign = campaignById.get(entry.advertId);
    const nmIdFromName = nmIdByAdvertIdFromName.get(entry.advertId);
    const campaignNmIds = nmIdFromName
      ? [nmIdFromName]
      : Array.from(new Set(
        (campaign?.nmIds ?? [])
          .filter((nmId) => Number.isFinite(nmId) && nmId > 0)
          .map((nmId) => Math.trunc(nmId)),
      ));

    if (campaignNmIds.length === 0) {
      const dayKey = resolveHistoryDay(entry, fromDate, toDate);
      const amountCents = toCents(entry.updSum);
      unallocatedCampaignCount += 1;
      unallocatedAmountCents += amountCents;
      totalAmountCents += amountCents;
      rows.push({
        tenantId: params.tenantId,
        nmId: UNALLOCATED_AD_NM_ID,
        date: toUtcStart(dayKey),
        amount: fromCents(amountCents).toFixed(2),
        orderCount: 0,
        orderSum: '0.00',
        type: 'history_upd_unallocated',
        placement: `campaign:${entry.advertId}`,
      });
      continue;
    }

    const dayKey = resolveHistoryDay(entry, fromDate, toDate);
    const dayWeights = campaignNmIds.map((nmId) => (
      orderWeights.get(`${dayKey}:${nmId}`) ?? {
        nmId,
        dayKey,
        orderCount: 0,
        orderSum: 0,
      }
    ));
    const orderSumWeights = dayWeights.map((item) => Math.max(0, item.orderSum));
    const orderCountWeights = dayWeights.map((item) => Math.max(0, item.orderCount));
    const hasOrderSumWeights = orderSumWeights.some((value) => value > 0);
    const hasOrderCountWeights = orderCountWeights.some((value) => value > 0);
    const allocatedCents = distributeCents(
      toCents(entry.updSum),
      hasOrderSumWeights
        ? orderSumWeights
        : hasOrderCountWeights
          ? orderCountWeights
          : campaignNmIds.map(() => 1),
    );

    for (let index = 0; index < campaignNmIds.length; index += 1) {
      const nmId = campaignNmIds[index]!;
      const allocatedAmountRub = fromCents(allocatedCents[index] ?? 0);
      const weightRow = dayWeights[index]!;

      rows.push({
        tenantId: params.tenantId,
        nmId,
        date: toUtcStart(dayKey),
        amount: allocatedAmountRub.toFixed(2),
        orderCount: weightRow.orderCount,
        orderSum: weightRow.orderSum.toFixed(2),
        type: 'history_upd',
        placement: `campaign:${entry.advertId}`,
      });
      totalAmountCents += allocatedCents[index] ?? 0;
    }
  }

  return {
    rows: dedupeAdCostRows(rows),
    campaignCount: advertIds.length,
    historyRowCount: filteredEntries.length,
    totalAmountRub: fromCents(totalAmountCents),
    unallocatedCampaignCount,
    unallocatedAmountRub: fromCents(unallocatedAmountCents),
  };
}
