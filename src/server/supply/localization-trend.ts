/**
 * Недельная динамика индексов локализации (для графиков «как у Поставлено»).
 *
 * Считает ИЛ/ИРП/долю локализации/нелокальные продажи по неделям из
 * raw_api_orders (та же модель локализации, что ./localization-data, но с
 * разбивкой по неделям). Локальный заказ = зона склада отгрузки совпадает с
 * зоной региона доставки.
 */

import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { OKRUG_ZONES, getOkrugForRegion, warehouseToOkrug, type Okrug } from './geography';
import { breakdownRow } from './localization';

function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export type TrendPoint = {
  /** Начало недели, YYYY-MM-DD. */
  week: string;
  il: number;
  irp: number;
  /** Доля локализации, %. */
  share: number;
  /** Нелокальные заказы за неделю, шт. */
  nonLocal: number;
  orders: number;
};

export type LocalizationTrendResult = { points: TrendPoint[] };

export type LocalizationTrendInput = { weeks?: number };

export async function computeLocalizationTrend(
  tenantId: string,
  input: LocalizationTrendInput = {},
): Promise<LocalizationTrendResult> {
  const weeks = Math.max(2, Math.min(26, Math.round(input.weeks ?? 13)));

  return withTenantContext(db, tenantId, async (tx) => {
    const res = await tx.execute(sql`
      SELECT to_char(date_trunc('week', date), 'YYYY-MM-DD') AS wk,
             nm_id::text AS nm_id,
             warehouse_name,
             oblast_okrug_name,
             region_name,
             COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND is_cancel = false
        AND date >= date_trunc('week', NOW()) - ((${weeks - 1}) || ' weeks')::interval
      GROUP BY wk, nm_id, warehouse_name, oblast_okrug_name, region_name
    `);
    const rows = res as unknown as Array<{
      wk: string;
      nm_id: string;
      warehouse_name: string | null;
      oblast_okrug_name: string | null;
      region_name: string | null;
      cnt: number;
    }>;

    // week → nm → {local,total}
    const byWeek = new Map<string, Map<number, { local: number; total: number }>>();
    for (const r of rows) {
      const regionOkrug = getOkrugForRegion(r.oblast_okrug_name) ?? getOkrugForRegion(r.region_name);
      if (!regionOkrug) continue;
      const wkMap = byWeek.get(r.wk) ?? new Map<number, { local: number; total: number }>();
      const nm = Number(r.nm_id);
      const acc = wkMap.get(nm) ?? { local: 0, total: 0 };
      acc.total += r.cnt;
      const shipOkrug = warehouseToOkrug(r.warehouse_name);
      if (shipOkrug && zoneOf(shipOkrug) === zoneOf(regionOkrug)) acc.local += r.cnt;
      wkMap.set(nm, acc);
      byWeek.set(r.wk, wkMap);
    }

    const points: TrendPoint[] = Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, nmMap]) => {
        let ilSum = 0;
        let irpSum = 0;
        let totalAll = 0;
        let localAll = 0;
        for (const v of nmMap.values()) {
          const b = breakdownRow({ localOrders: v.local, totalOrders: v.total });
          ilSum += b.ilContribution;
          irpSum += b.irpContribution;
          totalAll += v.total;
          localAll += v.local;
        }
        return {
          week,
          il: totalAll > 0 ? ilSum / totalAll : 0,
          irp: totalAll > 0 ? irpSum / totalAll : 0,
          share: totalAll > 0 ? (localAll / totalAll) * 100 : 0,
          nonLocal: totalAll - localAll,
          orders: totalAll,
        };
      });

    return { points };
  });
}
