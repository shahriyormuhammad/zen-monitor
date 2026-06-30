/**
 * План поставки ПО СКЛАДАМ — порт расчёта «Поставлено» на наши данные.
 *
 * В отличие от старого расчёта «по округу» (computeDeficitTable), здесь
 * «Отгрузить» считается на КАЖДЫЙ склад отдельно, формулой Поставлено:
 *   ship = (daysOnReturns×заказ/день + заказ/деньСВыкупом×(горизонт−daysOnReturns))×тренд − доступныйОстаток
 * (см. ./replenishment, сверено 1:1 со слепком).
 *
 * Гео-привязка БЕРЁТСЯ ИЗ ФАКТА: raw_api_orders.warehouse_name — это склад, с
 * которого WB реально отгрузил заказ. Значит «заказы склада» = сколько он
 * фактически обслужил → прогнозируем его потребность и держим его в стоке.
 * Никакой симуляции маршрутизации не нужно — она уже в истории отгрузок.
 *
 * %выкупа = выкупы(raw_api_sales, is_storno=false)/заказы по nm (правило
 * Поставлено: <10 заказов → 100%).
 */

import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { OKRUG_ZONES, warehouseToOkrug, type Okrug } from './geography';
import {
  calculateResult,
  forecastRemainder,
  ordersByDeliveryDays as ordersByDeliveryDaysFn,
} from './replenishment';

function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export type SupplyPlanCell = { ship: number; orders: number; stock: number };

export type WarehousePlanRow = {
  warehouse: string;
  okrug: Okrug | null;
  ship: number;
  orders: number;
  stock: number;
};

export type TopArticle = {
  nmId: number;
  vendorCode: string;
  photoUrl: string | null;
  ship: number;
  orders: number;
};

export type ArticleLeg = { warehouse: string; ship: number; orders: number; stock: number };

export type ArticlePlanRow = {
  nmId: number;
  vendorCode: string;
  photoUrl: string | null;
  brand: string | null;
  totalShip: number;
  totalOrders: number;
  totalStock: number;
  /** «Отгрузить» по складам (только склады с ship>0), по убыванию. */
  legs: ArticleLeg[];
};

export type SupplyPlanTotals = {
  /** Всего «Отгрузить», шт (Σ по складам). */
  total: number;
  /** Артикулов всего (с историей заказов/остатком). */
  modelsCount: number;
  /** Артикулов, которым что-то нужно довезти. */
  withPlan: number;
  /** Суммарно по зонам округов (для шапки). */
  byOkrug: Partial<Record<Okrug, SupplyPlanCell>>;
  /** По каждому складу (разнарядка), по убыванию «Отгрузить». */
  byWarehouse: WarehousePlanRow[];
  /** Топ артикулов к поставке (по убыванию «Отгрузить»). */
  topArticles: TopArticle[];
  /** Все артикулы к поставке (ship>0) с разбивкой по складам — для грида товар×склад. */
  articles: ArticlePlanRow[];
};

export type SupplyPlanInput = {
  /** Окно анализа заказов, дней. */
  periodDays?: number;
  /** Горизонт планирования, дней. */
  forecastDays?: number;
  /** Окно валовой скорости (по умолч. 3). */
  daysOnReturns?: number;
  /** Множитель тренда. */
  trendK?: number;
  /** Срок доставки до склада, дней (расход за время в пути). */
  deliveryDays?: number;
};

type Stock = { amount: number; inToClient: number; inFromClient: number };

/** Считает план поставки по складам формулой Поставлено на наших данных. */
export async function computeSupplyPlan(
  tenantId: string,
  input: SupplyPlanInput = {},
): Promise<SupplyPlanTotals> {
  const periodDays = Math.max(7, Math.min(180, Math.round(input.periodDays ?? 30)));
  const forecastDays = Math.max(7, Math.min(180, Math.round(input.forecastDays ?? 30)));
  const daysOnReturns = Math.max(0, Math.min(forecastDays, Math.round(input.daysOnReturns ?? 3)));
  const trendK = input.trendK && input.trendK > 0 ? input.trendK : 1;
  const deliveryDays = Math.max(0, Math.round(input.deliveryDays ?? 0));

  return withTenantContext(db, tenantId, async (tx) => {
    // Заказы по (nm × склад отгрузки) за период.
    const ordersRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, warehouse_name, COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND is_cancel = false
        AND warehouse_name IS NOT NULL
        AND date >= NOW() - (${periodDays} || ' days')::interval
      GROUP BY nm_id, warehouse_name
    `);
    const orderRows = ordersRes as unknown as Array<{ nm_id: string; warehouse_name: string | null; cnt: number }>;
    if (orderRows.length === 0) {
      return { total: 0, modelsCount: 0, withPlan: 0, byOkrug: {}, byWarehouse: [], topArticles: [], articles: [] };
    }

    // Выкупы по nm за период (для %выкупа).
    const salesRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, COUNT(*)::int AS cnt
      FROM raw_api_sales
      WHERE tenant_id = ${tenantId}
        AND is_storno = false
        AND date >= NOW() - (${periodDays} || ' days')::interval
      GROUP BY nm_id
    `);
    const salesByNm = new Map<number, number>();
    for (const r of salesRes as unknown as Array<{ nm_id: string; cnt: number }>) {
      salesByNm.set(Number(r.nm_id), r.cnt);
    }

    // Остатки + в пути по (nm × склад) — свежий снимок.
    const stocksRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, warehouse_name,
             SUM(amount)::int AS amount,
             SUM(in_way_to_client)::int AS in_to_client,
             SUM(in_way_from_client)::int AS in_from_client
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
        AND date >= NOW() - INTERVAL '7 days'
      GROUP BY nm_id, warehouse_name
    `);

    // Аккумуляторы
    const ordersByNm = new Map<number, number>();
    const ordersByNmWh = new Map<number, Map<string, number>>();
    for (const r of orderRows) {
      if (!r.warehouse_name) continue;
      const nm = Number(r.nm_id);
      ordersByNm.set(nm, (ordersByNm.get(nm) ?? 0) + r.cnt);
      const m = ordersByNmWh.get(nm) ?? new Map<string, number>();
      m.set(r.warehouse_name, (m.get(r.warehouse_name) ?? 0) + r.cnt);
      ordersByNmWh.set(nm, m);
    }
    const stockByNmWh = new Map<number, Map<string, Stock>>();
    for (const r of stocksRes as unknown as Array<{ nm_id: string; warehouse_name: string | null; amount: number; in_to_client: number; in_from_client: number }>) {
      if (!r.warehouse_name) continue;
      const nm = Number(r.nm_id);
      const m = stockByNmWh.get(nm) ?? new Map<string, Stock>();
      m.set(r.warehouse_name, {
        amount: r.amount ?? 0,
        inToClient: r.in_to_client ?? 0,
        inFromClient: r.in_from_client ?? 0,
      });
      stockByNmWh.set(nm, m);
    }

    // %выкупа по nm (правило Поставлено: <10 заказов → 100%).
    const buyoutPct = (nm: number): number => {
      const ord = ordersByNm.get(nm) ?? 0;
      if (ord < 10) return 100;
      const sl = salesByNm.get(nm) ?? 0;
      return Math.max(0, Math.min(100, (sl / ord) * 100));
    };

    const byWarehouse = new Map<string, WarehousePlanRow>();
    const byOkrug = new Map<Okrug, SupplyPlanCell>();
    const perNm = new Map<number, { ship: number; orders: number }>();
    const articleLegs = new Map<number, ArticleLeg[]>();
    let total = 0;
    let withPlan = 0;

    const allNm = new Set<number>([...ordersByNm.keys(), ...stockByNmWh.keys()]);
    for (const nm of allNm) {
      const buyout = buyoutPct(nm);
      const whOrders = ordersByNmWh.get(nm) ?? new Map<string, number>();
      const whStock = stockByNmWh.get(nm) ?? new Map<string, Stock>();
      const whs = new Set<string>([...whOrders.keys(), ...whStock.keys()]);
      let nmShip = 0;
      for (const wh of whs) {
        const ord = whOrders.get(wh) ?? 0;
        const st = whStock.get(wh) ?? { amount: 0, inToClient: 0, inFromClient: 0 };
        const oavg = ord / periodDays;
        const oavgBuyout = oavg * (buyout / 100);
        const fr = forecastRemainder(st.amount, st.inToClient, st.inFromClient, buyout);
        const ship = calculateResult({
          daysOnReturns,
          forecastOrdersDays: forecastDays,
          ordersAverage: oavg,
          ordersAverageWithBuyout: oavgBuyout,
          trendK,
          inWayToFBO: 0,
          forecastRemainder: fr,
          ordersByDeliveryDays: ordersByDeliveryDaysFn(oavg, buyout, deliveryDays),
        });
        if (ship <= 0 && ord === 0) continue; // склад без спроса и без отгрузки — пропускаем
        nmShip += ship;
        const okrugRaw = warehouseToOkrug(wh);
        const zone = okrugRaw ? zoneOf(okrugRaw) : null;
        const wrow = byWarehouse.get(wh) ?? { warehouse: wh, okrug: zone, ship: 0, orders: 0, stock: 0 };
        wrow.ship += ship;
        wrow.orders += ord;
        wrow.stock += st.amount;
        byWarehouse.set(wh, wrow);
        if (zone) {
          const cell = byOkrug.get(zone) ?? { ship: 0, orders: 0, stock: 0 };
          cell.ship += ship;
          cell.orders += ord;
          cell.stock += st.amount;
          byOkrug.set(zone, cell);
        }
        if (ship > 0) {
          const legs = articleLegs.get(nm) ?? [];
          legs.push({ warehouse: wh, ship, orders: ord, stock: st.amount });
          articleLegs.set(nm, legs);
        }
      }
      total += nmShip;
      if (nmShip > 0) {
        withPlan += 1;
        perNm.set(nm, { ship: nmShip, orders: ordersByNm.get(nm) ?? 0 });
      }
    }

    // Метаданные карточек для топа артикулов.
    const prodRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, vendor_code, photo_url, brand
      FROM products
      WHERE tenant_id = ${tenantId} AND is_hidden = false AND is_archived = false
    `);
    const meta = new Map<number, { vendorCode: string; photoUrl: string | null; brand: string | null }>();
    for (const p of prodRes as unknown as Array<{ nm_id: string; vendor_code: string; photo_url: string | null; brand: string | null }>) {
      meta.set(Number(p.nm_id), { vendorCode: p.vendor_code, photoUrl: p.photo_url, brand: p.brand });
    }
    const topArticles: TopArticle[] = Array.from(perNm.entries())
      .sort((a, b) => b[1].ship - a[1].ship)
      .slice(0, 15)
      .map(([nm, v]) => ({
        nmId: nm,
        vendorCode: meta.get(nm)?.vendorCode ?? String(nm),
        photoUrl: meta.get(nm)?.photoUrl ?? null,
        ship: v.ship,
        orders: v.orders,
      }));

    const articles: ArticlePlanRow[] = Array.from(perNm.entries())
      .filter(([, v]) => v.ship > 0)
      .sort((a, b) => b[1].ship - a[1].ship)
      .map(([nm, v]) => ({
        nmId: nm,
        vendorCode: meta.get(nm)?.vendorCode ?? String(nm),
        photoUrl: meta.get(nm)?.photoUrl ?? null,
        brand: meta.get(nm)?.brand ?? null,
        totalShip: v.ship,
        totalOrders: v.orders,
        totalStock: Array.from(stockByNmWh.get(nm)?.values() ?? []).reduce((s, st) => s + st.amount, 0),
        legs: (articleLegs.get(nm) ?? []).slice().sort((a, b) => b.ship - a.ship),
      }));

    return {
      total,
      modelsCount: allNm.size,
      withPlan,
      byOkrug: Object.fromEntries(byOkrug.entries()) as Partial<Record<Okrug, SupplyPlanCell>>,
      byWarehouse: Array.from(byWarehouse.values()).sort((a, b) => b.ship - a.ship),
      topArticles,
      articles,
    };
  });
}
