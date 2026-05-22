import { eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { rawApiSalesFunnelDaily, rawApiSalesFunnelNmDaily, tenants } from '@/lib/db/schema';
import { decrypt } from '@/lib/encryption';
import {
  createWbLkReadSessionFromStorageState,
  fetchWbLkReadOnlyJson,
} from '@/server/wb/lk-refresh-flow';

// Дневная воронка продаж WB ЛК (показы/переходы/корзина/заказы/выкупы).
// Источник — внутренняя ручка портала seller-content (показов нет в публичном API).
// Авторизация — через ЛК-сессию (authorizev3 + cookies), как в lk-refresh-flow.
const SALES_FUNNEL_REPORT_URL =
  'https://seller-content.wildberries.ru/ns/analytics-api/content-analytics/api/v1/sales-funnel/report';

export type SalesFunnelDailyRow = {
  date: string; // YYYY-MM-DD
  viewCount: number;
  openCardCount: number;
  addToCartCount: number;
  addToWishlistCount: number;
  orderCount: number;
  orderSum: number;
  buyoutCount: number;
  buyoutSum: number;
  cancelCount: number;
  cancelSum: number;
};

type SalesFunnelReportResponse = {
  data?: { chart?: { byDay?: Array<Record<string, unknown>> } };
  error?: boolean;
  errorText?: string;
};

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// WB ограничивает период сравнения той же длиной; для бэкафилла нам важен только
// currentPeriod, prevPeriod ставим равной длины непосредственно перед ним.
function defaultPrevPeriod(period: { start: string; end: string }): { start: string; end: string } {
  const start = new Date(`${period.start}T00:00:00.000Z`);
  const end = new Date(`${period.end}T00:00:00.000Z`);
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - days * 86_400_000);
  return { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) };
}

export async function fetchSalesFunnelDaily(
  tenantId: string,
  period: { start: string; end: string },
  prevPeriod?: { start: string; end: string },
): Promise<SalesFunnelDailyRow[]> {
  const [tenant] = await db
    .select({ storage: tenants.wbLkStorageState })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.storage) {
    throw new Error('WB ЛК storageState не сохранён для тенанта');
  }

  const session = await createWbLkReadSessionFromStorageState(decrypt(tenant.storage));
  const res = await fetchWbLkReadOnlyJson<SalesFunnelReportResponse>(session, SALES_FUNNEL_REPORT_URL, {
    method: 'POST',
    body: {
      currentPeriod: { start: period.start, end: period.end },
      prevPeriod: prevPeriod ?? defaultPrevPeriod(period),
      subjects: [],
      brands: [],
      nms: [],
      tagIds: [],
      skipDeletedNm: false,
      orderBy: { field: 'orders', mode: 'desc' },
    },
    timeoutMs: 30_000,
  });

  if (res.error) {
    throw new Error(`WB sales-funnel report error: ${res.errorText ?? 'unknown'}`);
  }

  const byDay = res.data?.chart?.byDay ?? [];
  return byDay
    .map((row) => ({
      date: String(row.date ?? '').slice(0, 10),
      viewCount: num(row.viewCount),
      openCardCount: num(row.openCardCount),
      addToCartCount: num(row.addToCartCount),
      addToWishlistCount: num(row.addToWishlistCount),
      orderCount: num(row.orderCount),
      orderSum: num(row.orderSum),
      buyoutCount: num(row.buyoutCount),
      buyoutSum: num(row.buyoutSum),
      cancelCount: num(row.cancelCount),
      cancelSum: num(row.cancelSum),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

export async function saveSalesFunnelDaily(tenantId: string, rows: SalesFunnelDailyRow[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const values = rows.map((row) => ({
    tenantId,
    date: new Date(`${row.date}T00:00:00.000Z`),
    viewCount: row.viewCount,
    openCardCount: row.openCardCount,
    addToCartCount: row.addToCartCount,
    addToWishlistCount: row.addToWishlistCount,
    orderCount: row.orderCount,
    orderSum: row.orderSum.toFixed(2),
    buyoutCount: row.buyoutCount,
    buyoutSum: row.buyoutSum.toFixed(2),
    cancelCount: row.cancelCount,
    cancelSum: row.cancelSum.toFixed(2),
    updatedAt: new Date(),
  }));

  await db
    .insert(rawApiSalesFunnelDaily)
    .values(values)
    .onConflictDoUpdate({
      target: [rawApiSalesFunnelDaily.tenantId, rawApiSalesFunnelDaily.date],
      set: {
        viewCount: sql`excluded.view_count`,
        openCardCount: sql`excluded.open_card_count`,
        addToCartCount: sql`excluded.add_to_cart_count`,
        addToWishlistCount: sql`excluded.add_to_wishlist_count`,
        orderCount: sql`excluded.order_count`,
        orderSum: sql`excluded.order_sum`,
        buyoutCount: sql`excluded.buyout_count`,
        buyoutSum: sql`excluded.buyout_sum`,
        cancelCount: sql`excluded.cancel_count`,
        cancelSum: sql`excluded.cancel_sum`,
        updatedAt: sql`now()`,
      },
    });

  return values.length;
}

export async function syncSalesFunnelDaily(
  tenantId: string,
  period: { start: string; end: string },
  prevPeriod?: { start: string; end: string },
): Promise<{ fetched: number; saved: number; totalViews: number }> {
  const rows = await fetchSalesFunnelDaily(tenantId, period, prevPeriod);
  const saved = await saveSalesFunnelDaily(tenantId, rows);
  const totalViews = rows.reduce((sum, row) => sum + row.viewCount, 0);
  return { fetched: rows.length, saved, totalViews };
}

// ───────────────────────── per-SKU (по товарам) ─────────────────────────
// WB отдаёт per-nm только за период (groups[].itemsGroup), без байд-разбивки.
// Поэтому для дневной per-nm детализации бьём report c currentPeriod = один день.

type SalesFunnelItemMetric = { current?: number | string; dynamics?: number | string };
type SalesFunnelItemRow = {
  nmId?: number | string;
  viewCount?: SalesFunnelItemMetric;
  openCard?: SalesFunnelItemMetric;
  addToCart?: SalesFunnelItemMetric;
  orders?: SalesFunnelItemMetric;
  ordersSum?: SalesFunnelItemMetric;
  buyoutCount?: SalesFunnelItemMetric;
  buyoutSum?: SalesFunnelItemMetric;
  cancelCount?: SalesFunnelItemMetric;
};
type SalesFunnelReportNmResponse = {
  data?: { groups?: Array<{ itemsGroup?: SalesFunnelItemRow[] }> };
  error?: boolean;
  errorText?: string;
};

export type SalesFunnelNmDailyRow = {
  nmId: number;
  viewCount: number;
  openCardCount: number;
  addToCartCount: number;
  orderCount: number;
  orderSum: number;
  buyoutCount: number;
  buyoutSum: number;
  cancelCount: number;
};

function cur(metric: SalesFunnelItemMetric | undefined): number {
  return num(metric?.current);
}

function prevDayIso(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function fetchSalesFunnelNmDaily(tenantId: string, day: string): Promise<SalesFunnelNmDailyRow[]> {
  const [tenant] = await db
    .select({ storage: tenants.wbLkStorageState })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.storage) {
    throw new Error('WB ЛК storageState не сохранён для тенанта');
  }

  const session = await createWbLkReadSessionFromStorageState(decrypt(tenant.storage));
  const prev = prevDayIso(day);
  const res = await fetchWbLkReadOnlyJson<SalesFunnelReportNmResponse>(session, SALES_FUNNEL_REPORT_URL, {
    method: 'POST',
    body: {
      currentPeriod: { start: day, end: day },
      prevPeriod: { start: prev, end: prev },
      subjects: [],
      brands: [],
      nms: [],
      tagIds: [],
      skipDeletedNm: false,
      orderBy: { field: 'orders', mode: 'desc' },
    },
    timeoutMs: 30_000,
  });

  if (res.error) {
    throw new Error(`WB sales-funnel nm report error: ${res.errorText ?? 'unknown'}`);
  }

  const byNm = new Map<number, SalesFunnelNmDailyRow>();
  for (const group of res.data?.groups ?? []) {
    for (const item of group.itemsGroup ?? []) {
      const nmId = Number(item.nmId);
      if (!Number.isFinite(nmId) || nmId <= 0) continue;
      const row = byNm.get(nmId) ?? {
        nmId,
        viewCount: 0,
        openCardCount: 0,
        addToCartCount: 0,
        orderCount: 0,
        orderSum: 0,
        buyoutCount: 0,
        buyoutSum: 0,
        cancelCount: 0,
      };
      row.viewCount += cur(item.viewCount);
      row.openCardCount += cur(item.openCard);
      row.addToCartCount += cur(item.addToCart);
      row.orderCount += cur(item.orders);
      row.orderSum += cur(item.ordersSum);
      row.buyoutCount += cur(item.buyoutCount);
      row.buyoutSum += cur(item.buyoutSum);
      row.cancelCount += cur(item.cancelCount);
      byNm.set(nmId, row);
    }
  }
  return [...byNm.values()];
}

export async function saveSalesFunnelNmDaily(
  tenantId: string,
  day: string,
  rows: SalesFunnelNmDailyRow[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  const values = rows.map((row) => ({
    tenantId,
    nmId: row.nmId,
    date,
    viewCount: row.viewCount,
    openCardCount: row.openCardCount,
    addToCartCount: row.addToCartCount,
    orderCount: row.orderCount,
    orderSum: row.orderSum.toFixed(2),
    buyoutCount: row.buyoutCount,
    buyoutSum: row.buyoutSum.toFixed(2),
    cancelCount: row.cancelCount,
    updatedAt: new Date(),
  }));

  await db
    .insert(rawApiSalesFunnelNmDaily)
    .values(values)
    .onConflictDoUpdate({
      target: [rawApiSalesFunnelNmDaily.tenantId, rawApiSalesFunnelNmDaily.nmId, rawApiSalesFunnelNmDaily.date],
      set: {
        viewCount: sql`excluded.view_count`,
        openCardCount: sql`excluded.open_card_count`,
        addToCartCount: sql`excluded.add_to_cart_count`,
        orderCount: sql`excluded.order_count`,
        orderSum: sql`excluded.order_sum`,
        buyoutCount: sql`excluded.buyout_count`,
        buyoutSum: sql`excluded.buyout_sum`,
        cancelCount: sql`excluded.cancel_count`,
        updatedAt: sql`now()`,
      },
    });

  return values.length;
}

export async function syncSalesFunnelNmDaily(
  tenantId: string,
  day: string,
): Promise<{ nms: number; saved: number; totalViews: number }> {
  const rows = await fetchSalesFunnelNmDaily(tenantId, day);
  const saved = await saveSalesFunnelNmDaily(tenantId, day, rows);
  const totalViews = rows.reduce((sum, row) => sum + row.viewCount, 0);
  return { nms: rows.length, saved, totalViews };
}
