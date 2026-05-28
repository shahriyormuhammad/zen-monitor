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
  findTwoTemplateSplit,
  GROUP_LABEL,
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
 * Detect which sizes a given article ships in. Single source of truth:
 * the `product_sizes` table, populated by `syncProductSizes` (WB Content
 * API). No order-history fallback — for ростовки we need ALL nomenclature
 * sizes including those that haven't shipped yet, not just those with
 * orders. Returns empty list until the user clicks «Подтянуть размеры из
 * WB» at least once.
 */
export type DetectedSize = { size: string; barcode: string };

export async function detectArticleSizes(
  tenantId: string,
  nmId: number,
): Promise<DetectedSize[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const synced = await tx.execute(sql`
      SELECT tech_size, MAX(barcode) AS barcode
      FROM product_sizes
      WHERE tenant_id = ${tenantId}
        AND nm_id = ${nmId}
      GROUP BY tech_size
    `);
    const rows = synced as unknown as Array<{ tech_size: string; barcode: string | null }>;
    const list = rows
      .map((r) => ({ size: r.tech_size.trim(), barcode: (r.barcode ?? '').trim() }))
      .filter((r) => r.size.length > 0 && r.size !== '0');
    return sortSizesByValue(list.map((r) => r.size))
      .map((s) => list.find((r) => r.size === s)!)
      .filter(Boolean);
  });
}

/** Bulk-detect sizes for many nmIds in one query — same single source. */
export async function detectSizesForMany(
  tenantId: string,
  nmIds: number[],
): Promise<Map<number, DetectedSize[]>> {
  const map = new Map<number, DetectedSize[]>();
  if (nmIds.length === 0) return map;
  return withTenantContext(db, tenantId, async (tx) => {
    const nmIdList = sql.join(nmIds.map((nm) => sql`${nm}::bigint`), sql`, `);
    const result = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, tech_size, MAX(barcode) AS barcode
      FROM product_sizes
      WHERE tenant_id = ${tenantId}
        AND nm_id IN (${nmIdList})
      GROUP BY nm_id, tech_size
    `);
    const rows = result as unknown as Array<{ nm_id: string; tech_size: string; barcode: string | null }>;
    const buckets = new Map<number, DetectedSize[]>();
    for (const r of rows) {
      const nm = Number(r.nm_id);
      const list = buckets.get(nm) ?? [];
      list.push({ size: r.tech_size.trim(), barcode: (r.barcode ?? '').trim() });
      buckets.set(nm, list);
    }
    for (const [nm, list] of buckets.entries()) {
      const sorted = sortSizesByValue(list.map((r) => r.size));
      map.set(nm, sorted.map((s) => list.find((r) => r.size === s)!).filter(Boolean));
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

  // 1) Exact template match (e.g. {41,42,43,44,45,46} → "Стандарт 41-46").
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

  // 2) Paired wide split: a teen + adult template pair whose union equals
  //    the article's size set (e.g. 36-46 → "Подростковая 36-41" +
  //    "Взрослая 41-46"). Two profiles, both default=false, BUT we mark
  //    the adult one as default for the dropdown.
  const split = findTwoTemplateSplit(articleSizes);
  if (split) {
    const teenSizes = buildSizesFromTemplate(split.teen, barcodeBySize);
    const adultSizes = buildSizesFromTemplate(split.adult, barcodeBySize);
    return [
      {
        name: `${GROUP_LABEL.adult} ${split.adult.name}`,
        sizes: adultSizes,
        totalPerBox: adultSizes.reduce((s, r) => s + r.perBox, 0),
        isDefault: true,
        sourceTemplate: split.adult.id,
      },
      {
        name: `${GROUP_LABEL.teen} ${split.teen.name}`,
        sizes: teenSizes,
        totalPerBox: teenSizes.reduce((s, r) => s + r.perBox, 0),
        isDefault: false,
        sourceTemplate: split.teen.id,
      },
    ];
  }

  // 3) No exact, no paired split — fall back to «Стандарт» (all perBox=1)
  //    plus every applicable template as a hint.
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
  const applicable = findApplicableTemplates(articleSizes);
  if (applicable.length === 0) {
    return [standard];
  }
  const extras: DesiredProfile[] = applicable.map((tpl: SizeTemplate) => {
    const sizes = buildSizesFromTemplate(tpl, barcodeBySize);
    return {
      name: `${GROUP_LABEL[tpl.group]} ${tpl.name}`,
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
        AND (
          source_template IS NOT NULL
          OR (is_default = true AND name LIKE 'Стандарт%')
        )
      RETURNING id
    `);
    return Array.isArray(result) ? result.length : 0;
  });
  const created = await ensureProfilesForArticle(tenantId, nmId, vendorCode, detected);
  return { deleted, created };
}

/**
 * Bulk-rebuild: walk every article in the catalogue, drop its auto-generated
 * profiles and recreate them from the latest detected sizes. Called right
 * after a WB Content API sync so stale «Стандарт» profiles (created before
 * sync, with partial sizes from order history) get replaced with fresh
 * ones that include WB barcodes per size.
 *
 * User-renamed profiles or fully manual entries stay intact because the
 * DELETE filter only catches auto-generated rows.
 */
export async function rebuildProfilesForTenant(tenantId: string): Promise<{
  articlesProcessed: number;
  deleted: number;
  created: number;
}> {
  const articles = await listArticleCatalog(tenantId);
  if (articles.length === 0) {
    return { articlesProcessed: 0, deleted: 0, created: 0 };
  }
  let deleted = 0;
  let created = 0;
  for (const article of articles) {
    const result = await rebuildProfilesForArticle(tenantId, article.nmId, article.vendorCode);
    deleted += result.deleted;
    created += result.created;
  }
  return { articlesProcessed: articles.length, deleted, created };
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
