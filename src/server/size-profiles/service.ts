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
 * Detect which sizes a given article actually ships in. Postal pulls this
 * from `irp_nomenclature_v1` (WB Content API cache). We don't have that
 * synced yet — fall back to distinct tech_size values from order history.
 *
 * Barcodes are not available here; profiles materialised from this source
 * will have empty barcode fields until WB Content API sync is added.
 */
export async function detectArticleSizes(
  tenantId: string,
  nmId: number,
): Promise<string[]> {
  return withTenantContext(db, tenantId, async (tx) => {
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
    return sortSizesByValue(rows.map((r) => r.tech_size.trim()).filter((s) => s.length > 0));
  });
}

/** Bulk-detect sizes for many nmIds in one query — used by the snapshot loader. */
export async function detectSizesForMany(
  tenantId: string,
  nmIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (nmIds.length === 0) return map;
  return withTenantContext(db, tenantId, async (tx) => {
    const result = await tx.execute(sql`
      SELECT nm_id::text AS nm_id, tech_size
      FROM raw_api_orders
      WHERE tenant_id = ${tenantId}
        AND nm_id = ANY(${nmIds}::bigint[])
        AND tech_size IS NOT NULL
        AND tech_size <> ''
        AND tech_size <> '0'
      GROUP BY nm_id, tech_size
    `);
    const rows = result as unknown as Array<{ nm_id: string; tech_size: string }>;
    for (const r of rows) {
      const nm = Number(r.nm_id);
      const list = map.get(nm) ?? [];
      list.push(r.tech_size.trim());
      map.set(nm, list);
    }
    for (const [nm, list] of map.entries()) {
      map.set(nm, sortSizesByValue(list));
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

function planProfilesForArticle(articleSizes: string[]): DesiredProfile[] {
  if (articleSizes.length === 0) return [];
  const applicable = findApplicableTemplates(articleSizes);
  const exact = findExactTemplate(articleSizes);

  if (exact) {
    const sizes = buildSizesFromTemplate(exact);
    return [{
      name: `Стандарт ${exact.name}`,
      sizes,
      totalPerBox: sizes.reduce((s, r) => s + r.perBox, 0),
      isDefault: true,
      sourceTemplate: exact.id,
    }];
  }

  // No exact match — fallback Стандарт with perBox=1 each.
  const standard: DesiredProfile = {
    name: 'Стандарт',
    sizes: articleSizes.map((s) => ({ size: s, perBox: 1 })),
    totalPerBox: articleSizes.length,
    isDefault: true,
    sourceTemplate: null,
  };

  if (applicable.length === 0) {
    return [standard];
  }

  // Wide range — auto-split: one extra profile per applicable template.
  const extras: DesiredProfile[] = applicable.map((tpl: SizeTemplate) => {
    const sizes = buildSizesFromTemplate(tpl);
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
  detectedSizes: string[],
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
