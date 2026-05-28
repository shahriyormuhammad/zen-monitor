/**
 * Per-article distribution across federal districts ("кластеры").
 *
 * Strategy «по дефициту» (chosen by the user, May 2026): distribute the
 * shipment proportional to each okrug's NEED, where
 *     need(okrug) = max(0, ceil(sales/period × forecast) - stock)
 * so districts that are already covered get little/zero and the gaps get
 * the lion's share. Falls back to demand-share when nothing is in deficit
 * (so the user still gets a sensible split).
 */

import { sql } from 'drizzle-orm';
import { db, withTenantContext } from '@/lib/db';
import {
  OKRUG_ZONES,
  cheapestWarehouseInOkrug,
  fastestWarehouseInOkrug,
  getOkrugForRegion,
  warehouseToOkrug,
  type Okrug,
} from './geography';

export type SupplyStrategy = 'speed' | 'cost';

export type DistributionRow = {
  okrug: Okrug;
  /** Orders in the sales window (demand signal). */
  orders: number;
  /** Current stock units in this okrug. */
  stock: number;
  /** Forecast deficit = max(0, forecastSales - stock). */
  need: number;
  /** Share used for allocation (need-share, or demand-share fallback). */
  pct: number;
  qty: number;
  warehouse: string;
  tariffCoef: number;
};

export type DistributionResult =
  | { status: 'ok'; basis: 'deficit' | 'demand'; rows: DistributionRow[] }
  | { status: 'no-article'; basis: null; rows: [] }
  | { status: 'no-history'; basis: null; rows: [] };

/** Collapse paired okrugs (ЮФО+СКФО, СФО+ДФО) into the canonical first half. */
function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export async function computeDistributionAction(
  tenantId: string,
  nmId: number,
  totalQty: number,
  strategy: SupplyStrategy,
  opts?: { salesDays?: number; forecastDays?: number },
): Promise<DistributionResult> {
  const salesDays = Math.max(7, Math.min(180, opts?.salesDays ?? 30));
  const forecastDays = Math.max(7, Math.min(180, opts?.forecastDays ?? 30));

  return withTenantContext(db, tenantId, async (tx) => {
    // Sales by okrug over the window.
    const ordersRes = await tx.execute(sql`
      SELECT oblast_okrug_name, region_name, COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND is_cancel = false
        AND date >= NOW() - (${salesDays} || ' days')::interval
      GROUP BY oblast_okrug_name, region_name
    `);
    const orderRows = ordersRes as unknown as Array<{
      oblast_okrug_name: string | null;
      region_name: string | null;
      cnt: number;
    }>;
    if (orderRows.length === 0) {
      return { status: 'no-history', basis: null, rows: [] };
    }

    // Current stock by okrug.
    const stocksRes = await tx.execute(sql`
      SELECT warehouse_name, SUM(amount)::int AS qty
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND date >= NOW() - INTERVAL '7 days'
      GROUP BY warehouse_name
      HAVING SUM(amount) > 0
    `);
    const stockRows = stocksRes as unknown as Array<{ warehouse_name: string | null; qty: number }>;

    const salesByOkrug = new Map<Okrug, number>();
    for (const o of orderRows) {
      const okrug = getOkrugForRegion(o.oblast_okrug_name) ?? getOkrugForRegion(o.region_name);
      if (!okrug) continue;
      const zone = zoneOf(okrug);
      salesByOkrug.set(zone, (salesByOkrug.get(zone) ?? 0) + o.cnt);
    }
    if (salesByOkrug.size === 0) {
      return { status: 'no-history', basis: null, rows: [] };
    }

    const stockByOkrug = new Map<Okrug, number>();
    for (const r of stockRows) {
      const federal = warehouseToOkrug(r.warehouse_name);
      if (!federal) continue;
      const zone = zoneOf(federal);
      stockByOkrug.set(zone, (stockByOkrug.get(zone) ?? 0) + r.qty);
    }

    // Build per-okrug {orders, stock, need}.
    type Acc = { okrug: Okrug; orders: number; stock: number; need: number };
    const accs: Acc[] = [];
    for (const [okrug, orders] of salesByOkrug.entries()) {
      const stock = stockByOkrug.get(okrug) ?? 0;
      const forecastSales = Math.ceil((orders / salesDays) * forecastDays);
      const need = Math.max(0, forecastSales - stock);
      accs.push({ okrug, orders, stock, need });
    }

    // Allocation basis: deficit if any need > 0, else demand.
    const totalNeed = accs.reduce((s, a) => s + a.need, 0);
    const totalOrders = accs.reduce((s, a) => s + a.orders, 0);
    const basis: 'deficit' | 'demand' = totalNeed > 0 ? 'deficit' : 'demand';
    const weightOf = (a: Acc) => (basis === 'deficit' ? a.need : a.orders);
    const totalWeight = basis === 'deficit' ? totalNeed : totalOrders;

    // Only keep okrugs that carry weight (deficit basis drops covered ones).
    const active = accs.filter((a) => weightOf(a) > 0).sort((x, y) => weightOf(y) - weightOf(x));
    if (active.length === 0) {
      return { status: 'no-history', basis: null, rows: [] };
    }

    const rows: DistributionRow[] = active.map((a) => {
      const pct = weightOf(a) / totalWeight;
      return {
        okrug: a.okrug,
        orders: a.orders,
        stock: a.stock,
        need: a.need,
        pct,
        qty: Math.round(totalQty * pct),
        warehouse: '',
        tariffCoef: 0,
      };
    });

    // Drift correction so the qty sums to exactly totalQty.
    const assigned = rows.reduce((s, r) => s + r.qty, 0);
    const drift = totalQty - assigned;
    if (rows.length > 0 && drift !== 0) rows[0]!.qty += drift;

    // Warehouse pick by strategy.
    for (const r of rows) {
      const pick = strategy === 'cost'
        ? cheapestWarehouseInOkrug(r.okrug)
        : fastestWarehouseInOkrug(r.okrug);
      if (pick) {
        r.warehouse = pick.name;
        r.tariffCoef = pick.tariffCoef;
      }
    }

    return { status: 'ok', basis, rows };
  });
}
