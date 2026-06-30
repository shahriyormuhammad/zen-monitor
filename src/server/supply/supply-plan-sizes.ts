/**
 * Разбивка плана поставки ПО РАЗМЕРАМ для одного артикула (раскрытие строки).
 *
 * Как у «Поставлено»: артикул × РАЗМЕР × склад. По каждому размеру — заказы,
 * остаток, доля локализации, КТР/КРП и «Отгрузить» по каждому складу.
 *
 * Остаток на (размер × склад) у нас в сырых данных раздельно (raw_api_stocks —
 * по складу без размера; raw_api_stock_sizes — по размеру без склада), поэтому
 * остаток склада распределяется по размерам пропорционально размерному остатку
 * (приближение; точный размер×склад потребует доп. синка). Формула «Отгрузить» —
 * та же, что в ./replenishment (сверена со слепком).
 */

import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { OKRUG_ZONES, getOkrugForRegion, warehouseToOkrug, type Okrug } from './geography';
import { breakdownRow } from './localization';
import { calculateResult, forecastRemainder } from './replenishment';

function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export type SizeLeg = { warehouse: string; ship: number; orders: number; stock: number };

export type SizeRow = {
  size: string;
  orders: number;
  stock: number;
  /** Доля локализации размера, %. */
  share: number;
  ktr: number;
  krp: number;
  totalShip: number;
  legs: SizeLeg[];
};

export type ArticleSizesResult = { sizes: SizeRow[]; buyout: number };

export type ArticleSizesInput = { periodDays?: number; forecastDays?: number; daysOnReturns?: number };

export async function computeArticleSizes(
  tenantId: string,
  nmId: number,
  input: ArticleSizesInput = {},
): Promise<ArticleSizesResult> {
  const periodDays = Math.max(7, Math.min(180, Math.round(input.periodDays ?? 30)));
  const forecastDays = Math.max(7, Math.min(180, Math.round(input.forecastDays ?? 30)));
  const daysOnReturns = Math.max(0, Math.min(forecastDays, Math.round(input.daysOnReturns ?? 3)));

  return withTenantContext(db, tenantId, async (tx) => {
    const ordersRes = await tx.execute(sql`
      SELECT tech_size AS size, warehouse_name, oblast_okrug_name, region_name, COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId} AND nm_id = ${nmId} AND is_cancel = false
        AND warehouse_name IS NOT NULL
        AND tech_size IS NOT NULL AND tech_size <> '' AND tech_size <> '0'
        AND date >= NOW() - (${periodDays} || ' days')::interval
      GROUP BY tech_size, warehouse_name, oblast_okrug_name, region_name
    `);
    const orderRows = ordersRes as unknown as Array<{ size: string; warehouse_name: string | null; oblast_okrug_name: string | null; region_name: string | null; cnt: number }>;

    const stkWhRes = await tx.execute(sql`
      SELECT warehouse_name, SUM(amount)::int AS amount
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId} AND nm_id = ${nmId} AND date >= NOW() - INTERVAL '7 days'
      GROUP BY warehouse_name
    `);
    const stockByWh = new Map<string, number>();
    for (const r of stkWhRes as unknown as Array<{ warehouse_name: string | null; amount: number }>) {
      if (r.warehouse_name) stockByWh.set(r.warehouse_name, r.amount ?? 0);
    }

    const stkSzRes = await tx.execute(sql`
      SELECT size_name AS size, SUM(stock_count)::int AS qty
      FROM raw_api_stock_sizes
      WHERE tenant_id = ${tenantId} AND nm_id = ${nmId}
        AND size_name IS NOT NULL AND size_name <> '' AND size_name <> '0'
      GROUP BY size_name
    `);
    const stockBySize = new Map<string, number>();
    for (const r of stkSzRes as unknown as Array<{ size: string; qty: number }>) {
      stockBySize.set(r.size.trim(), r.qty ?? 0);
    }
    const totalSizeStock = Array.from(stockBySize.values()).reduce((s, n) => s + n, 0);

    const salesRes = await tx.execute(sql`SELECT COUNT(*)::int AS cnt FROM raw_api_sales WHERE tenant_id=${tenantId} AND nm_id=${nmId} AND is_storno=false AND date >= NOW() - (${periodDays} || ' days')::interval`);
    const ordTotRes = await tx.execute(sql`SELECT COUNT(*)::int AS cnt FROM raw_api_orders WHERE tenant_id=${tenantId} AND nm_id=${nmId} AND is_cancel=false AND date >= NOW() - (${periodDays} || ' days')::interval`);
    const salesCnt = Number((salesRes as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    const ordTot = Number((ordTotRes as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    const buyout = ordTot < 10 ? 100 : Math.max(0, Math.min(100, (salesCnt / ordTot) * 100));

    type Acc = { byWh: Map<string, number>; total: number; local: number };
    const sizeMap = new Map<string, Acc>();
    for (const r of orderRows) {
      const size = (r.size ?? '').trim();
      if (!size) continue;
      const acc = sizeMap.get(size) ?? { byWh: new Map<string, number>(), total: 0, local: 0 };
      acc.total += r.cnt;
      if (r.warehouse_name) acc.byWh.set(r.warehouse_name, (acc.byWh.get(r.warehouse_name) ?? 0) + r.cnt);
      const regionOkrug = getOkrugForRegion(r.oblast_okrug_name) ?? getOkrugForRegion(r.region_name);
      const shipOkrug = warehouseToOkrug(r.warehouse_name);
      if (regionOkrug && shipOkrug && zoneOf(shipOkrug) === zoneOf(regionOkrug)) acc.local += r.cnt;
      sizeMap.set(size, acc);
    }
    for (const size of stockBySize.keys()) {
      if (!sizeMap.has(size)) sizeMap.set(size, { byWh: new Map<string, number>(), total: 0, local: 0 });
    }

    const sizes: SizeRow[] = Array.from(sizeMap.entries()).map(([size, acc]) => {
      const stockSize = stockBySize.get(size) ?? 0;
      const share = acc.total > 0 ? (acc.local / acc.total) * 100 : 0;
      const b = breakdownRow({ localOrders: acc.local, totalOrders: acc.total });
      const legs: SizeLeg[] = [];
      for (const [wh, ordSW] of acc.byWh.entries()) {
        const whStock = stockByWh.get(wh) ?? 0;
        const stockSW = totalSizeStock > 0 ? whStock * (stockSize / totalSizeStock) : 0;
        const oavg = ordSW / periodDays;
        const ship = calculateResult({
          daysOnReturns,
          forecastOrdersDays: forecastDays,
          ordersAverage: oavg,
          ordersAverageWithBuyout: oavg * (buyout / 100),
          trendK: 1,
          inWayToFBO: 0,
          forecastRemainder: forecastRemainder(stockSW, 0, 0, buyout),
          ordersByDeliveryDays: 0,
        });
        if (ship > 0) legs.push({ warehouse: wh, ship, orders: ordSW, stock: Math.round(stockSW) });
      }
      legs.sort((x, y) => y.ship - x.ship);
      return {
        size,
        orders: acc.total,
        stock: stockSize,
        share,
        ktr: b.ktr,
        krp: b.krp,
        totalShip: legs.reduce((s, l) => s + l.ship, 0),
        legs,
      };
    });

    sizes.sort((a, b2) => {
      const an = parseFloat(a.size);
      const bn = parseFloat(b2.size);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return a.size.localeCompare(b2.size, 'ru');
    });

    return { sizes, buyout };
  });
}
