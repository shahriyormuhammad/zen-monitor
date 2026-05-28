/**
 * Deficit-by-cluster table for the План поставки view.
 *
 * For every product in the tenant:
 *   • sales by okrug — sum of orders in the past `periodDays` days,
 *     grouped via raw_api_orders.oblast_okrug_name (fallback: region_name
 *     mapped through REGION_TO_OKRUG).
 *   • stock by okrug — current snapshot from raw_api_stocks, grouped via
 *     WAREHOUSE_TARIFFS[warehouse_name].federal.
 *   • need = max(0, ceil(sales / periodDays × forecastDays) - stock)
 *
 * Returns a row per product with an `byOkrug` map plus aggregated totals.
 * Okrug pairs (ЮФО+СКФО, СФО+ДФО) get merged into the first half of the
 * pair so the same trade zone isn't double-counted.
 */

import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import {
  OKRUG_ZONES,
  getOkrugForRegion,
  warehouseToOkrug,
  type Okrug,
} from './geography';

export type DeficitOkrugCell = {
  sales: number;
  stock: number;
  need: number;
};

export type DeficitRow = {
  nmId: number;
  vendorCode: string;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  overall: DeficitOkrugCell;
  byOkrug: Partial<Record<Okrug, DeficitOkrugCell>>;
  topNeedOkrug: Okrug | null;
};

export type DeficitTotals = {
  modelsCount: number;
  withDeficit: number;
  totalForecastNeed: number;
  byOkrug: Partial<Record<Okrug, DeficitOkrugCell>>;
};

export type DeficitInput = {
  periodDays: number;
  forecastDays: number;
};

export type DeficitResult = {
  rows: DeficitRow[];
  totals: DeficitTotals;
  okrugsWithData: Okrug[];
};

/** Resolve a paired-okrug into its canonical first-half code (the "zone"). */
function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export async function computeDeficitTable(
  tenantId: string,
  input: DeficitInput,
): Promise<DeficitResult> {
  const periodDays = Math.max(7, Math.min(180, Math.round(input.periodDays)));
  const forecastDays = Math.max(7, Math.min(180, Math.round(input.forecastDays)));

  return withTenantContext(db, tenantId, async (tx) => {
    // Step 1: products
    const productsRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, vendor_code, brand, category, photo_url
      FROM products
      WHERE tenant_id = ${tenantId}
        AND is_hidden = false
        AND is_archived = false
      ORDER BY vendor_code ASC
    `);
    const products = productsRes as unknown as Array<{
      nm_id: string;
      vendor_code: string;
      brand: string | null;
      category: string | null;
      photo_url: string | null;
    }>;
    if (products.length === 0) {
      return { rows: [], totals: emptyTotals(), okrugsWithData: [] };
    }

    // Step 2: sales (orders count) per nm × okrug for the period
    const salesRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id,
             oblast_okrug_name AS okrug_name,
             region_name,
             COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND is_cancel = false
        AND date >= NOW() - (${periodDays} || ' days')::interval
      GROUP BY nm_id, oblast_okrug_name, region_name
    `);
    const salesRows = salesRes as unknown as Array<{
      nm_id: string;
      okrug_name: string | null;
      region_name: string | null;
      cnt: number;
    }>;

    // Step 3: stocks per nm × warehouse → okrug
    const stocksRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, warehouse_name, SUM(amount)::int AS qty
      FROM raw_api_stocks
      WHERE tenant_id = ${tenantId}
        AND date >= NOW() - INTERVAL '7 days'
      GROUP BY nm_id, warehouse_name
      HAVING SUM(amount) > 0
    `);
    const stockRows = stocksRes as unknown as Array<{
      nm_id: string;
      warehouse_name: string | null;
      qty: number;
    }>;

    // Aggregate into per-nm × okrug
    const byNm = new Map<number, { sales: Map<Okrug, number>; stock: Map<Okrug, number> }>();
    const getBucket = (nm: number) => {
      let b = byNm.get(nm);
      if (!b) { b = { sales: new Map(), stock: new Map() }; byNm.set(nm, b); }
      return b;
    };

    for (const row of salesRows) {
      const nm = Number(row.nm_id);
      const okrug = getOkrugForRegion(row.okrug_name) ?? getOkrugForRegion(row.region_name);
      if (!okrug) continue;
      const zone = zoneOf(okrug);
      const bucket = getBucket(nm);
      bucket.sales.set(zone, (bucket.sales.get(zone) ?? 0) + row.cnt);
    }
    for (const row of stockRows) {
      const nm = Number(row.nm_id);
      const federal = warehouseToOkrug(row.warehouse_name);
      if (!federal) continue;
      const zone = zoneOf(federal);
      const bucket = getBucket(nm);
      bucket.stock.set(zone, (bucket.stock.get(zone) ?? 0) + row.qty);
    }

    // Step 4: build rows with need = max(0, ceil(sales/periodDays * forecastDays) - stock)
    const okrugsSeen = new Set<Okrug>();
    const totalsByOkrug = new Map<Okrug, DeficitOkrugCell>();
    let withDeficit = 0;
    let totalForecastNeed = 0;

    const rows: DeficitRow[] = products.map((p) => {
      const nm = Number(p.nm_id);
      const b = byNm.get(nm);
      const byOkrug: Partial<Record<Okrug, DeficitOkrugCell>> = {};
      let overallSales = 0;
      let overallStock = 0;
      let overallNeed = 0;
      let topNeed = 0;
      let topNeedOkrug: Okrug | null = null;

      const okrugSet = new Set<Okrug>();
      if (b) {
        for (const okrug of b.sales.keys()) okrugSet.add(okrug);
        for (const okrug of b.stock.keys()) okrugSet.add(okrug);
      }
      for (const okrug of okrugSet) {
        okrugsSeen.add(okrug);
        const sales = b!.sales.get(okrug) ?? 0;
        const stock = b!.stock.get(okrug) ?? 0;
        const forecastSales = Math.ceil((sales / periodDays) * forecastDays);
        const need = Math.max(0, forecastSales - stock);
        byOkrug[okrug] = { sales, stock, need };
        overallSales += sales;
        overallStock += stock;
        overallNeed += need;
        if (need > topNeed) { topNeed = need; topNeedOkrug = okrug; }

        const t = totalsByOkrug.get(okrug) ?? { sales: 0, stock: 0, need: 0 };
        t.sales += sales;
        t.stock += stock;
        t.need += need;
        totalsByOkrug.set(okrug, t);
      }

      if (overallNeed > 0) {
        withDeficit += 1;
        totalForecastNeed += overallNeed;
      }

      return {
        nmId: nm,
        vendorCode: p.vendor_code,
        brand: p.brand,
        category: p.category,
        photoUrl: p.photo_url,
        overall: { sales: overallSales, stock: overallStock, need: overallNeed },
        byOkrug,
        topNeedOkrug,
      };
    });

    rows.sort((a, b) => b.overall.need - a.overall.need);

    const totals: DeficitTotals = {
      modelsCount: products.length,
      withDeficit,
      totalForecastNeed,
      byOkrug: Object.fromEntries(totalsByOkrug.entries()),
    };

    return {
      rows,
      totals,
      okrugsWithData: Array.from(okrugsSeen).sort(),
    };
  });
}

function emptyTotals(): DeficitTotals {
  return { modelsCount: 0, withDeficit: 0, totalForecastNeed: 0, byOkrug: {} };
}

/* ── Size breakdown for one article (row expand) ─────────── */

export type SizeDeficitRow = {
  size: string;
  sales: number;
  stock: number;
  need: number;
};

/**
 * Per-size deficit for one nmId: sales from raw_api_orders.tech_size,
 * stock from raw_api_stock_sizes.stock_count, need = max(0,
 * ceil(sales/period × forecast) − stock). Sizes sorted numerically.
 */
export async function computeSizeBreakdown(
  tenantId: string,
  nmId: number,
  input: DeficitInput,
): Promise<SizeDeficitRow[]> {
  const periodDays = Math.max(7, Math.min(180, Math.round(input.periodDays)));
  const forecastDays = Math.max(7, Math.min(180, Math.round(input.forecastDays)));

  return withTenantContext(db, tenantId, async (tx) => {
    const salesRes = await tx.execute(sql`
      SELECT tech_size AS size, COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND is_cancel = false
        AND tech_size IS NOT NULL AND tech_size <> '' AND tech_size <> '0'
        AND date >= NOW() - (${periodDays} || ' days')::interval
      GROUP BY tech_size
    `);
    const salesRows = salesRes as unknown as Array<{ size: string; cnt: number }>;

    const stockRes = await tx.execute(sql`
      SELECT size_name AS size, SUM(stock_count)::int AS qty
      FROM raw_api_stock_sizes
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND size_name IS NOT NULL AND size_name <> '' AND size_name <> '0'
      GROUP BY size_name
    `);
    const stockRows = stockRes as unknown as Array<{ size: string; qty: number }>;

    const sizes = new Map<string, { sales: number; stock: number }>();
    for (const r of salesRows) {
      const s = r.size.trim();
      const e = sizes.get(s) ?? { sales: 0, stock: 0 };
      e.sales += r.cnt;
      sizes.set(s, e);
    }
    for (const r of stockRows) {
      const s = r.size.trim();
      const e = sizes.get(s) ?? { sales: 0, stock: 0 };
      e.stock += r.qty;
      sizes.set(s, e);
    }

    return Array.from(sizes.entries())
      .map(([size, v]) => {
        const forecastSales = Math.ceil((v.sales / periodDays) * forecastDays);
        return { size, sales: v.sales, stock: v.stock, need: Math.max(0, forecastSales - v.stock) };
      })
      .sort((a, b) => {
        const an = parseFloat(a.size);
        const bn = parseFloat(b.size);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        return a.size.localeCompare(b.size, 'ru');
      });
  });
}
