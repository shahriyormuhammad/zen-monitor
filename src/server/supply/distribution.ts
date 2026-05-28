/**
 * Per-article distribution: aggregate orders by okrug (excluding окrugs that
 * already have stock — "local" zones) and pick warehouses by strategy.
 *
 * Port of Postal's `computeDeliveryDistribution(nmId, totalQty, strategy)`.
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
  orders: number;
  pct: number;
  qty: number;
  warehouse: string;
  tariffCoef: number;
};

export type DistributionResult =
  | { status: 'ok'; rows: DistributionRow[] }
  | { status: 'no-article'; rows: [] }
  | { status: 'no-history'; rows: [] };

/**
 * Compute distribution of `totalQty` units across federal districts for one nmId.
 *
 * Rules (ported from Postal):
 *   1. Look up the article's orders by region (last `days` days).
 *   2. Look up which okrugs currently host stock for this nmId.
 *   3. Drop "local" regions (regions whose okrug is paired with a stock-holding okrug).
 *   4. Aggregate the remaining orders by okrug, treating SF/DF and Yu/SK as merged zones.
 *   5. Distribute totalQty proportionally to the okrug share (correcting the last row to match the sum).
 *   6. Pick a warehouse per okrug according to strategy (speed = main hub, cost = cheapest tariff).
 */
export async function computeDistributionAction(
  tenantId: string,
  nmId: number,
  totalQty: number,
  strategy: SupplyStrategy,
  daysBack = 60,
): Promise<DistributionResult> {
  return withTenantContext(db, tenantId, async (tx) => {
    // Step 1: orders aggregated by detected okrug via oblast_okrug_name first,
    // then region_name fallback.
    const ordersRes = await tx.execute(sql`
      SELECT oblast_okrug_name, region_name, COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND is_cancel = false
        AND date >= NOW() - (${daysBack} || ' days')::interval
      GROUP BY oblast_okrug_name, region_name
    `);
    const orderRows = ordersRes as unknown as Array<{
      oblast_okrug_name: string | null;
      region_name: string | null;
      cnt: number;
    }>;

    if (orderRows.length === 0) {
      return { status: 'no-history', rows: [] };
    }

    // Step 2: which okrugs currently hold stock?
    const stocksRes = await tx.execute(sql`
      SELECT warehouse_name, SUM(amount)::int AS qty
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND date >= NOW() - INTERVAL '7 days'
      GROUP BY warehouse_name
      HAVING SUM(amount) > 0
    `);
    const stockRows = stocksRes as unknown as Array<{
      warehouse_name: string | null;
      qty: number;
    }>;
    const stockOkrugs = new Set<Okrug>();
    for (const r of stockRows) {
      const federal = warehouseToOkrug(r.warehouse_name);
      if (federal) {
        for (const zone of OKRUG_ZONES[federal] ?? [federal]) {
          stockOkrugs.add(zone);
        }
      }
    }

    // Step 3+4: aggregate non-local orders by okrug.
    const byOkrug = new Map<Okrug, number>();
    for (const o of orderRows) {
      const okrug =
        getOkrugForRegion(o.oblast_okrug_name)
        ?? getOkrugForRegion(o.region_name);
      if (!okrug) continue;
      if (stockOkrugs.has(okrug)) continue; // local — товар уже доезжает
      const zones = OKRUG_ZONES[okrug] ?? [okrug];
      // Aggregate into the first zone of the pair so СФО+ДФО don't double-count.
      const zoneKey = zones[0]!;
      byOkrug.set(zoneKey, (byOkrug.get(zoneKey) ?? 0) + o.cnt);
    }

    if (byOkrug.size === 0) {
      return { status: 'no-history', rows: [] };
    }

    const totalOrders = Array.from(byOkrug.values()).reduce((s, n) => s + n, 0);
    const entries = Array.from(byOkrug.entries())
      .sort((a, b) => b[1] - a[1]); // top okrugs first

    // Step 5: proportional allocation, ensure sum equals totalQty.
    const rows: DistributionRow[] = entries.map(([okrug, orders]) => {
      const pct = orders / totalOrders;
      const qty = Math.round(totalQty * pct);
      return { okrug, orders, pct, qty, warehouse: '', tariffCoef: 0 };
    });
    const assigned = rows.reduce((s, r) => s + r.qty, 0);
    const drift = totalQty - assigned;
    if (rows.length > 0 && drift !== 0) {
      rows[0]!.qty += drift; // correct the biggest okrug
    }

    // Step 6: warehouses by strategy.
    for (const r of rows) {
      const pick = strategy === 'cost'
        ? cheapestWarehouseInOkrug(r.okrug)
        : fastestWarehouseInOkrug(r.okrug);
      if (pick) {
        r.warehouse = pick.name;
        r.tariffCoef = pick.tariffCoef;
      }
    }

    return { status: 'ok', rows };
  });
}
