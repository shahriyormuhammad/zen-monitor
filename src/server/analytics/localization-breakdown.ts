/**
 * «Индекс локализации» — per-article breakdown of how local an article's
 * fulfillment is, and what that costs in logistics.
 *
 * Definition (matches WB): an order is "local" when it shipped from a
 * warehouse in the SAME federal trade zone as the buyer's region. The
 * localization index ИЛ = local orders / total orders over the WB rolling
 * window (13 full weeks ≈ 91 days). The logistics coefficient КТР scales
 * delivery cost with ИЛ: КТР>1 means logistics is more expensive.
 *
 * Source: raw_api_orders (warehouse_name 100% populated, buyer okrug 96%).
 */

import { sql } from "drizzle-orm";

import { db, withTenantContext } from "@/lib/db";
import {
  OKRUG_ZONES,
  getOkrugForRegion,
  warehouseToOkrug,
  type Okrug,
} from "@/server/supply/geography";
import { resolveLocalityIndexMultiplierFromLocalization } from "@/components/economics/constants";

export type LocalizationArticleRow = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  orders: number;
  localOrders: number;
  localSharePct: number;
  ktr: number;
  /** (КТР − 1) × 100: >0 — логистика дороже, <0 — дешевле. */
  logisticsImpactPct: number;
};

export type LocalizationBreakdown = {
  windowDays: number;
  overall: {
    orders: number;
    localOrders: number;
    localSharePct: number;
    ktr: number;
    articlesCount: number;
  };
  rows: LocalizationArticleRow[];
};

function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export async function getLocalizationBreakdown(
  tenantId: string,
  windowDays = 91,
): Promise<LocalizationBreakdown> {
  const days = Math.max(7, Math.min(180, Math.round(windowDays)));

  return withTenantContext(db, tenantId, async (tx) => {
    const res = await tx.execute(sql`
      SELECT nm_id::text AS nm_id,
             warehouse_name,
             oblast_okrug_name,
             region_name,
             COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND is_cancel = false
        AND date >= NOW() - (${days} || ' days')::interval
      GROUP BY nm_id, warehouse_name, oblast_okrug_name, region_name
    `) as unknown as Array<{
      nm_id: string;
      warehouse_name: string | null;
      oblast_okrug_name: string | null;
      region_name: string | null;
      cnt: number;
    }>;

    // Aggregate per nmId: total orders + local orders.
    const byNm = new Map<number, { orders: number; local: number }>();
    let grandOrders = 0;
    let grandLocal = 0;
    for (const r of res) {
      const nm = Number(r.nm_id);
      const officeOkrug = warehouseToOkrug(r.warehouse_name);
      const buyerOkrug = getOkrugForRegion(r.oblast_okrug_name) ?? getOkrugForRegion(r.region_name);
      const isLocal = Boolean(
        officeOkrug && buyerOkrug && zoneOf(officeOkrug) === zoneOf(buyerOkrug),
      );
      const e = byNm.get(nm) ?? { orders: 0, local: 0 };
      e.orders += r.cnt;
      if (isLocal) e.local += r.cnt;
      byNm.set(nm, e);
      grandOrders += r.cnt;
      if (isLocal) grandLocal += r.cnt;
    }

    if (byNm.size === 0) {
      return {
        windowDays: days,
        overall: { orders: 0, localOrders: 0, localSharePct: 0, ktr: 1, articlesCount: 0 },
        rows: [],
      };
    }

    // Product metadata.
    const nmIds = Array.from(byNm.keys());
    const nmIdList = sql.join(nmIds.map((id) => sql`${id}::bigint`), sql`, `);
    const prodRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, vendor_code, brand, category, photo_url
      FROM products
      WHERE tenant_id = ${tenantId}
        AND nm_id IN (${nmIdList})
    `) as unknown as Array<{
      nm_id: string;
      vendor_code: string | null;
      brand: string | null;
      category: string | null;
      photo_url: string | null;
    }>;
    const prodByNm = new Map(prodRes.map((p) => [Number(p.nm_id), p]));

    const rows: LocalizationArticleRow[] = nmIds.map((nm) => {
      const agg = byNm.get(nm)!;
      const localSharePct = agg.orders > 0 ? (agg.local / agg.orders) * 100 : 0;
      const ktr = resolveLocalityIndexMultiplierFromLocalization(localSharePct);
      const p = prodByNm.get(nm);
      return {
        nmId: nm,
        vendorCode: p?.vendor_code ?? null,
        brand: p?.brand ?? null,
        category: p?.category ?? null,
        photoUrl: p?.photo_url ?? null,
        orders: agg.orders,
        localOrders: agg.local,
        localSharePct: round1(localSharePct),
        ktr: round2(ktr),
        logisticsImpactPct: Math.round((ktr - 1) * 100),
      };
    });

    // Sort by orders desc — biggest index movers first.
    rows.sort((a, b) => b.orders - a.orders);

    const overallSharePct = grandOrders > 0 ? (grandLocal / grandOrders) * 100 : 0;
    return {
      windowDays: days,
      overall: {
        orders: grandOrders,
        localOrders: grandLocal,
        localSharePct: round1(overallSharePct),
        ktr: round2(resolveLocalityIndexMultiplierFromLocalization(overallSharePct)),
        articlesCount: byNm.size,
      },
      rows,
    };
  });
}

function round1(v: number) { return Math.round(v * 10) / 10; }
function round2(v: number) { return Math.round(v * 100) / 100; }
