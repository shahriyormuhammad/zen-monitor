/**
 * Текущая локализация кабинета из НАШИХ данных (raw_api_orders).
 *
 * Порт модели «Поставлено» на нашу БД: в raw_api_orders есть и склад отгрузки
 * (warehouse_name), и регион доставки (oblast_okrug_name/region_name). Заказ
 * считается ЛОКАЛЬНЫМ, если зона склада отгрузки совпадает с зоной региона
 * доставки (WB-зоны: ЮФО+СКФО, СФО+ДФО — парные). По доле локализации каждого
 * артикула берём КТР/КРП и агрегируем в индексы проекта ИЛ/ИРП.
 *
 * Чистая математика индексов — в ./localization (сверена 1:1 со слепком).
 * Здесь только ЧТЕНИЕ и сопоставление склад↔регион.
 */

import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import {
  OKRUG_ZONES,
  getOkrugForRegion,
  warehouseToOkrug,
  type Okrug,
} from './geography';
import {
  aggregateIndices,
  breakdownRow,
  influencePct,
  type LocalizationRow,
} from './localization';

/** Каноничная зона округа (ЮФО+СКФО → ЮФО, СФО+ДФО → СФО). */
function zoneOf(okrug: Okrug): Okrug {
  const zones = OKRUG_ZONES[okrug] ?? [okrug];
  return zones[0]!;
}

export type ArticleLocalization = {
  nmId: number;
  vendorCode: string;
  brand: string | null;
  photoUrl: string | null;
  /** Всего заказов в зачёт (с распознанным регионом). */
  orders: number;
  /** Локальные заказы (склад в зоне региона). */
  localOrders: number;
  /** Доля локализации, %. */
  share: number;
  ktr: number;
  krp: number;
  /** Вклад в ИЛ = заказы×КТР. */
  ilContribution: number;
  /** Вклад в ИРП = заказы×КРП. */
  irpContribution: number;
  /** % влияния этого артикула на общий ИЛ. */
  ilInfluencePct: number;
  /** % влияния на общий ИРП. */
  irpInfluencePct: number;
};

export type CurrentLocalizationResult = {
  /** ИЛ проекта (орд-взвешенный КТР). */
  il: number;
  /** ИРП проекта. */
  irp: number;
  totalOrders: number;
  localOrders: number;
  /** Средняя доля локализации (справочно — на индексы НЕ влияет). */
  avgShare: number;
  /** Артикулов ниже порога 60% (генерят ИРП). */
  belowThreshold: number;
  /** Разбивка по артикулам, отсортирована по убыванию влияния на ИЛ. */
  articles: ArticleLocalization[];
};

export type LocalizationInput = {
  /** Окно анализа заказов, дней (Поставлено считает долю за ~13 недель = 91). */
  periodDays?: number;
};

/**
 * Считает текущие ИЛ/ИРП кабинета и разбивку по артикулам с «% влияния».
 * Аналог шапки «ИЛ 1,08 ИРП 1,59» в Поставлено, но на наших данных.
 */
export async function computeCurrentLocalization(
  tenantId: string,
  input: LocalizationInput = {},
): Promise<CurrentLocalizationResult> {
  const periodDays = Math.max(7, Math.min(180, Math.round(input.periodDays ?? 91)));

  return withTenantContext(db, tenantId, async (tx) => {
    // Заказы за период: склад отгрузки × регион доставки (нераспознанные отсеем в JS).
    const ordersRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id,
             warehouse_name,
             oblast_okrug_name,
             region_name,
             COUNT(*)::int AS cnt
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND is_cancel = false
        AND date >= NOW() - (${periodDays} || ' days')::interval
      GROUP BY nm_id, warehouse_name, oblast_okrug_name, region_name
    `);
    const orderRows = ordersRes as unknown as Array<{
      nm_id: string;
      warehouse_name: string | null;
      oblast_okrug_name: string | null;
      region_name: string | null;
      cnt: number;
    }>;

    // Per-nm накопление local/total.
    const byNm = new Map<number, { local: number; total: number }>();
    for (const r of orderRows) {
      const regionOkrug = getOkrugForRegion(r.oblast_okrug_name) ?? getOkrugForRegion(r.region_name);
      if (!regionOkrug) continue; // регион не распознан → в зачёт локализации не идёт
      const nm = Number(r.nm_id);
      const acc = byNm.get(nm) ?? { local: 0, total: 0 };
      acc.total += r.cnt;
      const shipOkrug = warehouseToOkrug(r.warehouse_name);
      if (shipOkrug && zoneOf(shipOkrug) === zoneOf(regionOkrug)) {
        acc.local += r.cnt;
      }
      byNm.set(nm, acc);
    }

    if (byNm.size === 0) {
      return { il: 0, irp: 0, totalOrders: 0, localOrders: 0, avgShare: 0, belowThreshold: 0, articles: [] };
    }

    // Карточки (фото/бренд/артикул продавца), только видимые.
    const productsRes = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, vendor_code, brand, photo_url
      FROM products
      WHERE tenant_id = ${tenantId}
        AND is_hidden = false
        AND is_archived = false
    `);
    const productMeta = new Map<number, { vendorCode: string; brand: string | null; photoUrl: string | null }>();
    for (const p of productsRes as unknown as Array<{ nm_id: string; vendor_code: string; brand: string | null; photo_url: string | null }>) {
      productMeta.set(Number(p.nm_id), { vendorCode: p.vendor_code, brand: p.brand, photoUrl: p.photo_url });
    }

    // Индексы проекта (для % влияния нужна сумма вкладов по всем артикулам).
    const rowsForAgg: LocalizationRow[] = Array.from(byNm.values()).map((v) => ({
      localOrders: v.local,
      totalOrders: v.total,
    }));
    const agg = aggregateIndices(rowsForAgg);

    let localOrders = 0;
    let belowThreshold = 0;
    const articles: ArticleLocalization[] = Array.from(byNm.entries()).map(([nmId, v]) => {
      const b = breakdownRow({ localOrders: v.local, totalOrders: v.total });
      localOrders += v.local;
      if (b.share < 60) belowThreshold += 1;
      const meta = productMeta.get(nmId);
      return {
        nmId,
        vendorCode: meta?.vendorCode ?? String(nmId),
        brand: meta?.brand ?? null,
        photoUrl: meta?.photoUrl ?? null,
        orders: v.total,
        localOrders: v.local,
        share: b.share,
        ktr: b.ktr,
        krp: b.krp,
        ilContribution: b.ilContribution,
        irpContribution: b.irpContribution,
        ilInfluencePct: influencePct(b.ilContribution, agg.ilSum),
        irpInfluencePct: influencePct(b.irpContribution, agg.irpSum),
      };
    });

    // Сортируем по влиянию на ИЛ — «что лечить в первую очередь».
    articles.sort((a, b) => b.ilInfluencePct - a.ilInfluencePct);

    return {
      il: agg.il,
      irp: agg.irp,
      totalOrders: agg.totalOrders,
      localOrders,
      avgShare: agg.totalOrders > 0 ? (localOrders / agg.totalOrders) * 100 : 0,
      belowThreshold,
      articles,
    };
  });
}
