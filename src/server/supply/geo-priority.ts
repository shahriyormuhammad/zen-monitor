/**
 * Гео-приоритеты складов — «карта скоростей» из НАШИХ отгрузок.
 *
 * Идея «Поставлено» (уровень 3): WB везёт заказ с быстрейшего склада с
 * остатком, а не из «своего» округа. Прямой таблицы скоростей у нас нет, но
 * её можно ВОССТАНОВИТЬ эмпирически: в raw_api_orders видно, с какого склада
 * (warehouse_name) реально уехал заказ в какой регион (region). Доля отгрузок
 * склада по региону ≈ его приоритет/скорость до этого региона.
 *
 * На выходе — по каждой зоне региона упорядоченный список складов с долей и
 * флагом «локальный» (склад в зоне региона) / «воришка» (нелокальный, но
 * с заметной долей — тянет локализацию вниз).
 */

import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import {
  OKRUG_ZONES,
  getOkrugForRegion,
  warehouseToOkrug,
  type Okrug,
} from './geography';

function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export type WarehousePriority = {
  warehouse: string;
  /** Сколько заказов этого региона уехало с этого склада за период. */
  shipped: number;
  /** Доля отгрузок региона с этого склада, 0..1. */
  share: number;
  /** Склад в зоне региона (обслуживает локально). */
  local: boolean;
  /** Нелокальный склад с заметной долей (≥10%) — «воришка» локализации. */
  thief: boolean;
};

export type RegionPriority = {
  zone: Okrug;
  totalOrders: number;
  /** Склады по убыванию доли отгрузок (priority-1 первым). */
  warehouses: WarehousePriority[];
};

export type GeoPriorityResult = {
  periodDays: number;
  regions: RegionPriority[];
};

const THIEF_SHARE = 0.1;

export type GeoPriorityInput = { periodDays?: number };

/** Строит приоритеты складов по каждой зоне региона из истории отгрузок. */
export async function buildRegionPriorities(
  tenantId: string,
  input: GeoPriorityInput = {},
): Promise<GeoPriorityResult> {
  const periodDays = Math.max(7, Math.min(180, Math.round(input.periodDays ?? 30)));

  return withTenantContext(db, tenantId, async (tx) => {
    const res = await tx.execute(sql`
      SELECT warehouse_name,
             oblast_okrug_name,
             region_name,
             COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND is_cancel = false
        AND warehouse_name IS NOT NULL
        AND date >= NOW() - (${periodDays} || ' days')::interval
      GROUP BY warehouse_name, oblast_okrug_name, region_name
    `);
    const rows = res as unknown as Array<{
      warehouse_name: string | null;
      oblast_okrug_name: string | null;
      region_name: string | null;
      cnt: number;
    }>;

    // zone → warehouse → shipped
    const byZone = new Map<Okrug, Map<string, number>>();
    for (const r of rows) {
      const regionOkrug = getOkrugForRegion(r.oblast_okrug_name) ?? getOkrugForRegion(r.region_name);
      if (!regionOkrug || !r.warehouse_name) continue;
      const zone = zoneOf(regionOkrug);
      const whMap = byZone.get(zone) ?? new Map<string, number>();
      whMap.set(r.warehouse_name, (whMap.get(r.warehouse_name) ?? 0) + r.cnt);
      byZone.set(zone, whMap);
    }

    const regions: RegionPriority[] = Array.from(byZone.entries()).map(([zone, whMap]) => {
      const totalOrders = Array.from(whMap.values()).reduce((s, n) => s + n, 0);
      const warehouses: WarehousePriority[] = Array.from(whMap.entries())
        .map(([warehouse, shipped]) => {
          const whOkrug = warehouseToOkrug(warehouse);
          const local = whOkrug != null && zoneOf(whOkrug) === zone;
          const share = totalOrders > 0 ? shipped / totalOrders : 0;
          return { warehouse, shipped, share, local, thief: !local && share >= THIEF_SHARE };
        })
        .sort((a, b) => b.shipped - a.shipped);
      return { zone, totalOrders, warehouses };
    });

    // Зоны по объёму заказов (где больше всего — выше).
    regions.sort((a, b) => b.totalOrders - a.totalOrders);
    return { periodDays, regions };
  });
}
