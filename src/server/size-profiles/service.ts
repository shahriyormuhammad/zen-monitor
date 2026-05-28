/**
 * Size profiles ("Ростовки") service — direct port of Postal's
 * `ensureDefaultProfile` + family. Three things this module does:
 *
 *   1. `listProfiles(tenantId)`         — load all profiles
 *   2. `listArticleCatalog(tenantId)`   — products + photo for the picker
 *   3. `ensureProfilesForArticle()`     — idempotently materialise default
 *      and template-based profiles for one nmId (the wide-range split)
 *   4. CRUD: `upsertProfile`, `deleteProfile`, `setProfileDefault`
 *   5. `detectArticleSizes` — distinct sizes from order history (fallback
 *      until we sync the WB Content API into a dedicated `product_sizes`
 *      table)
 *
 * The whole point of `ensureProfilesForArticle` is to make widely-ranged
 * articles (e.g. 37-45) **auto-split** into multiple profiles: the user
 * doesn't pick a template — the system creates "37-41" AND "41-45"
 * profiles automatically on first page load. This is what the user
 * referred to as "разделить обувной артикул на 2 полноценные ростовки".
 */

import { and, eq, sql } from 'drizzle-orm';
import { db, withTenantContext } from '@/lib/db';
import { sizeProfiles, type SizeProfileSize } from '@/lib/db/schema';
import {
  buildSizesFromTemplate,
  findApplicableTemplates,
  findExactTemplate,
  sortSizesByValue,
  type SizeTemplate,
} from './templates';

export type SizeProfile = {
  id: string;
  tenantId: string;
  nmId: number;
  vendorCode: string;
  name: string;
  sizes: SizeProfileSize[];
  totalPerBox: number;
  isDefault: boolean;
  sourceTemplate: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SizeProfileInput = {
  id?: string;
  nmId: number;
  vendorCode: string;
  name: string;
  sizes: SizeProfileSize[];
  isDefault?: boolean;
};

export type ArticleCatalogEntry = {
  nmId: number;
  vendorCode: string;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
};

/* ─────────────── Article catalogue ─────────────── */

export async function listArticleCatalog(tenantId: string): Promise<ArticleCatalogEntry[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        p.nm_id::text                  AS nm_id,
        p.vendor_code                  AS vendor_code,
        p.brand                        AS brand,
        p.category                     AS category,
        p.photo_url                    AS photo_url
      FROM products p
      WHERE p.tenant_id = ${tenantId}
        AND p.is_hidden = false
        AND p.is_archived = false
      ORDER BY p.vendor_code ASC
      LIMIT 1000
    `);
    const rows = result as unknown as Array<{
      nm_id: string;
      vendor_code: string;
      brand: string | null;
      category: string | null;
      photo_url: string | null;
    }>;
    return rows.map((r) => ({
      nmId: Number(r.nm_id),
      vendorCode: r.vendor_code,
      brand: r.brand,
      category: r.category,
      photoUrl: r.photo_url,
    }));
  });
}

/**
 * Detect which sizes a given article ships in.
 *
 *   1. Preferred: `product_sizes` table — populated by the WB Content API
 *      sync (`syncProductSizes`). Includes barcodes per size.
 *   2. Fallback: distinct tech_size values from `raw_api_orders`. No
 *      barcodes, and missing sizes that haven't shipped yet.
 *
 * The Settings card has a "Подтянуть размеры из WB" button that triggers
 * the sync — once it runs, this function returns the full size set with
 * barcodes attached.
 */
export type DetectedSize = { size: string; barcode: string };

export async function detectArticleSizes(
  tenantId: string,
  nmId: number,
): Promise<DetectedSize[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    // Primary source — WB Content API synced rows.
    const synced = await tx.execute(sql`
      SELECT tech_size, MAX(barcode) AS barcode
      FROM product_sizes
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
      GROUP BY tech_size
    `);
    const syncedRows = synced as unknown as Array<{ tech_size: string; barcode: string | null }>;
    if (syncedRows.length > 0) {
      const list = syncedRows
        .map((r) => ({ size: r.tech_size.trim(), barcode: (r.barcode ?? '').trim() }))
        .filter((r) => r.size.length > 0 && r.size !== '0');
      return sortSizesByValue(list.map((r) => r.size))
        .map((s) => list.find((r) => r.size === s)!)
        .filter(Boolean);
    }

    // Fallback — order history (sizes only, no barcodes).
    const result = await tx.execute(sql`
      SELECT DISTINCT tech_size
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND tech_size IS NOT NULL
        AND tech_size <> ''
        AND tech_size <> '0'
    `);
    const rows = result as unknown as Array<{ tech_size: string }>;
    return sortSizesByValue(rows.map((r) => r.tech_size.trim()).filter((s) => s.length > 0))
      .map((size) => ({ size, barcode: '' }));
  });
}

/** Bulk-detect sizes for many nmIds in one query — used by the snapshot loader. */
export async function detectSizesForMany(
  tenantId: string,
  nmIds: number[],
): Promise<Map<number, DetectedSize[]>> {
  const map = new Map<number, DetectedSize[]>();
  if (nmIds.length === 0) return map;
  return withTenantContext(db, tenantId, async (tx) => {
    const nmIdList = sql.join(nmIds.map((nm) => sql`${nm}::bigint`), sql`, `);

    // Primary source — product_sizes (synced from WB Content API).
    const syncedResult = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, tech_size, MAX(barcode) AS barcode
      FROM product_sizes
      WHERE tenant_id = ${tenantId}
        AND nm_id IN (${nmIdList})
      GROUP BY nm_id, tech_size
    `);
    const syncedRows = syncedResult as unknown as Array<{ nm_id: string; tech_size: string; barcode: string | null }>;
    const synced = new Map<number, DetectedSize[]>();
    for (const r of syncedRows) {
      const nm = Number(r.nm_id);
      const list = synced.get(nm) ?? [];
      list.push({ size: r.tech_size.trim(), barcode: (r.barcode ?? '').trim() });
      synced.set(nm, list);
    }
    for (const [nm, list] of synced.entries()) {
      const sorted = sortSizesByValue(list.map((r) => r.size));
      synced.set(nm, sorted.map((s) => list.find((r) => r.size === s)!).filter(Boolean));
      map.set(nm, synced.get(nm)!);
    }

    // For nmIds without synced rows, fall back to order history.
    const missing = nmIds.filter((nm) => !synced.has(nm));
    if (missing.length > 0) {
      const missingList = sql.join(missing.map((nm) => sql`${nm}::bigint`), sql`, `);
      const ordersResult = await tx.execute(sql`
        SELECT nm_id::text AS nm_id, tech_size
        FROM raw_api_orders
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${missingList})
          AND tech_size IS NOT NULL
          AND tech_size <> ''
          AND tech_size <> '0'
        GROUP BY nm_id, tech_size
      `);
      const rows = ordersResult as unknown as Array<{ nm_id: string; tech_size: string }>;
      const buckets = new Map<number, string[]>();
      for (const r of rows) {
        const nm = Number(r.nm_id);
        const list = buckets.get(nm) ?? [];
        list.push(r.tech_size.trim());
        buckets.set(nm, list);
      }
      for (const [nm, list] of buckets.entries()) {
        map.set(nm, sortSizesByValue(list).map((size) => ({ size, barcode: '' })));
      }
    }
    return map;
  });
}

/* ─────────────── Profiles list / CRUD ─────────────── */

export async function listProfiles(tenantId: string): Promise<SizeProfile[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(sizeProfiles)
      .where(eq(sizeProfiles.tenantId, tenantId));
    return rows.map(toSizeProfile);
  });
}

export async function upsertProfile(
  tenantId: string,
  input: SizeProfileInput,
): Promise<SizeProfile> {
  return withTenantContext(db, tenantId, async (tx) => {
    const total = input.sizes.reduce((s, x) => s + (Number(x.perBox) || 0), 0);
    const cleanSizes: SizeProfileSize[] = input.sizes.map((s) => ({
      size: String(s.size).trim(),
      perBox: Math.max(0, Math.floor(Number(s.perBox) || 0)),
      barcode: s.barcode?.trim() || undefined,
    })).filter((s) => s.size.length > 0);

    if (cleanSizes.length === 0) {
      throw new Error('Профиль должен содержать хотя бы один размер');
    }
    if (!input.name.trim()) {
      throw new Error('Название профиля обязательно');
    }

    if (input.id) {
      const [updated] = await tx
        .update(sizeProfiles)
        .set({
          name: input.name.trim(),
          vendorCode: input.vendorCode.trim(),
          sizes: cleanSizes,
          totalPerBox: total,
          isDefault: input.isDefault ?? false,
          updatedAt: new Date(),
        })
        .where(and(
          eq(sizeProfiles.tenantId, tenantId),
          eq(sizeProfiles.id, input.id),
        ))
        .returning();
      if (!updated) throw new Error('Профиль не найден');
      return toSizeProfile(updated);
    }

    const existing = await tx
      .select({ id: sizeProfiles.id })
      .from(sizeProfiles)
      .where(and(
        eq(sizeProfiles.tenantId, tenantId),
        eq(sizeProfiles.nmId, input.nmId),
      ))
      .limit(1);

    const [created] = await tx
      .insert(sizeProfiles)
      .values({
        tenantId,
        nmId: input.nmId,
        vendorCode: input.vendorCode.trim(),
        name: input.name.trim(),
        sizes: cleanSizes,
        totalPerBox: total,
        isDefault: input.isDefault ?? existing.length === 0,
        sourceTemplate: null,
      })
      .returning();
    return toSizeProfile(created!);
  });
}

export async function deleteProfile(tenantId: string, id: string): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    const row = await tx
      .select({ isDefault: sizeProfiles.isDefault })
      .from(sizeProfiles)
      .where(and(eq(sizeProfiles.tenantId, tenantId), eq(sizeProfiles.id, id)))
      .limit(1);
    if (!row[0]) return;
    if (row[0].isDefault) {
      throw new Error('Профиль по умолчанию нельзя удалить — выберите другой профиль по умолчанию');
    }
    await tx
      .delete(sizeProfiles)
      .where(and(eq(sizeProfiles.tenantId, tenantId), eq(sizeProfiles.id, id)));
  });
}

export async function setProfileDefault(tenantId: string, id: string): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    const row = await tx
      .select({ nmId: sizeProfiles.nmId })
      .from(sizeProfiles)
      .where(and(eq(sizeProfiles.tenantId, tenantId), eq(sizeProfiles.id, id)))
      .limit(1);
    if (!row[0]) throw new Error('Профиль не найден');
    const nmId = row[0].nmId;
    await tx
      .update(sizeProfiles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(sizeProfiles.tenantId, tenantId), eq(sizeProfiles.nmId, nmId)));
    await tx
      .update(sizeProfiles)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(sizeProfiles.tenantId, tenantId), eq(sizeProfiles.id, id)));
  });
}

/* ─────────────── Materialisation (the Postal ensureDefaultProfile port) ─────────────── */

/**
 * Build (in memory) the set of profiles that should exist for an article
 * given its detected sizes. Mirrors Postal's `ensureDefaultProfile`:
 *
 *   • exact match → ONE profile «Стандарт <name>» with template perBox map
 *   • applicable but not exact → fallback «Стандарт» (all perBox=1) +
 *     ONE profile per applicable template («37-41», «41-45», …)
 *   • no applicable templates → just the fallback «Стандарт»
 */
type DesiredProfile = {
  name: string;
  sizes: SizeProfileSize[];
  totalPerBox: number;
  isDefault: boolean;
  sourceTemplate: string | null;
};

function planProfilesForArticle(detected: DetectedSize[]): DesiredProfile[] {
  if (detected.length === 0) return [];
  const articleSizes = detected.map((s) => s.size);
  const barcodeBySize: Record<string, string> = {};
  for (const s of detected) {
    if (s.barcode) barcodeBySize[s.size] = s.barcode;
  }

  const applicable = findApplicableTemplates(articleSizes);
  const exact = findExactTemplate(articleSizes);

  if (exact) {
    const sizes = buildSizesFromTemplate(exact, barcodeBySize);
    return [{
      name: `Стандарт ${exact.name}`,
      sizes,
      totalPerBox: sizes.reduce((s, r) => s + r.perBox, 0),
      isDefault: true,
      sourceTemplate: exact.id,
    }];
  }

  // No exact match — fallback Стандарт with perBox=1 each (barcodes attached
  // when known).
  const standard: DesiredProfile = {
    name: 'Стандарт',
    sizes: detected.map((s) => ({
      size: s.size,
      perBox: 1,
      barcode: s.barcode || undefined,
    })),
    totalPerBox: detected.length,
    isDefault: true,
    sourceTemplate: null,
  };

  if (applicable.length === 0) {
    return [standard];
  }

  // Wide range — auto-split: one extra profile per applicable template.
  const extras: DesiredProfile[] = applicable.map((tpl: SizeTemplate) => {
    const sizes = buildSizesFromTemplate(tpl, barcodeBySize);
    return {
      name: tpl.name,
      sizes,
      totalPerBox: sizes.reduce((s, r) => s + r.perBox, 0),
      isDefault: false,
      sourceTemplate: tpl.id,
    };
  });

  return [standard, ...extras];
}

/**
 * Idempotent: ensure every desired profile exists for the article.
 * Will NEVER overwrite a user-modified profile — checks by
 * `(nmId, sourceTemplate)` (or `(nmId, isDefault=true, sourceTemplate IS NULL)`
 * for the fallback Стандарт).
 *
 * Returns the number of profiles created.
 */
export async function ensureProfilesForArticle(
  tenantId: string,
  nmId: number,
  vendorCode: string,
  detectedSizes: DetectedSize[],
): Promise<number> {
  const desired = planProfilesForArticle(detectedSizes);
  if (desired.length === 0) return 0;

  return withTenantContext(db, tenantId, async (tx) => {
    const existing = await tx
      .select({
        id: sizeProfiles.id,
        sourceTemplate: sizeProfiles.sourceTemplate,
        isDefault: sizeProfiles.isDefault,
      })
      .from(sizeProfiles)
      .where(and(
        eq(sizeProfiles.tenantId, tenantId),
        eq(sizeProfiles.nmId, nmId),
      ));

    const existingByTemplate = new Set<string>();
    let hasFallbackStandard = false;
    for (const row of existing) {
      if (row.sourceTemplate) {
        existingByTemplate.add(row.sourceTemplate);
      } else if (row.isDefault) {
        hasFallbackStandard = true;
      }
    }

    let created = 0;
    for (const profile of desired) {
      if (profile.sourceTemplate) {
        if (existingByTemplate.has(profile.sourceTemplate)) continue;
      } else if (profile.isDefault) {
        // Fallback Стандарт: skip if any default profile already exists.
        if (hasFallbackStandard || existing.some((r) => r.isDefault)) continue;
      }
      await tx.insert(sizeProfiles).values({
        tenantId,
        nmId,
        vendorCode,
        name: profile.name,
        sizes: profile.sizes,
        totalPerBox: profile.totalPerBox,
        isDefault: profile.isDefault,
        sourceTemplate: profile.sourceTemplate,
      });
      created += 1;
    }
    return created;
  });
}

/**
 * Materialise profiles for every article in the tenant's catalogue using
 * the detected sizes from order history. Returns total created count.
 */
export async function ensureProfilesForTenant(tenantId: string): Promise<{
  articlesProcessed: number;
  profilesCreated: number;
}> {
  const articles = await listArticleCatalog(tenantId);
  if (articles.length === 0) return { articlesProcessed: 0, profilesCreated: 0 };

  const sizesByNm = await detectSizesForMany(tenantId, articles.map((a) => a.nmId));

  let created = 0;
  for (const article of articles) {
    const sizes = sizesByNm.get(article.nmId) ?? [];
    if (sizes.length === 0) continue; // no order history → skip
    const n = await ensureProfilesForArticle(tenantId, article.nmId, article.vendorCode, sizes);
    created += n;
  }
  return { articlesProcessed: articles.length, profilesCreated: created };
}

/**
 * Delete all auto-generated profiles for one article (those with
 * `sourceTemplate IS NOT NULL` OR the fallback default «Стандарт»). Manually
 * created profiles are kept. Then re-run `ensureProfilesForArticle` so the
 * latest WB Content API sizes/barcodes are used.
 */
export async function rebuildProfilesForArticle(
  tenantId: string,
  nmId: number,
  vendorCode: string,
): Promise<{ deleted: number; created: number }> {
  const detected = await detectArticleSizes(tenantId, nmId);
  const deleted = await withTenantContext(db, tenantId, async (tx) => {
    const result = await tx.execute(sql`
      DELETE FROM size_profiles
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
        AND (source_template IS NOT NULL OR (is_default = true AND name LIKE 'Стандарт%'))
      RETURNING id
    `);
    return Array.isArray(result) ? result.length : 0;
  });
  const created = await ensureProfilesForArticle(tenantId, nmId, vendorCode, detected);
  return { deleted, created };
}

/* ─────────────── helpers ─────────────── */

function toSizeProfile(row: typeof sizeProfiles.$inferSelect): SizeProfile {
  return {
    id: row.id,
    tenantId: row.tenantId,
    nmId: Number(row.nmId),
    vendorCode: row.vendorCode,
    name: row.name,
    sizes: Array.isArray(row.sizes) ? row.sizes : [],
    totalPerBox: row.totalPerBox,
    isDefault: row.isDefault,
    sourceTemplate: row.sourceTemplate ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
