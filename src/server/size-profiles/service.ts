/**
 * Size profiles ("Ростовки") service module.
 *
 *   listProfilesByArticle(tenantId)  → article → its profiles
 *   listArticleCatalog(tenantId)     → article catalog with vendorCode + photo
 *   upsertProfile(tenantId, data)    → create/update one profile
 *   deleteProfile(tenantId, id)      → delete (unless isDefault)
 */

import { and, eq, sql } from 'drizzle-orm';
import { db, withTenantContext } from '@/lib/db';
import { sizeProfiles, type SizeProfileSize } from '@/lib/db/schema';

export type SizeProfile = {
  id: string;
  tenantId: string;
  nmId: number;
  vendorCode: string;
  name: string;
  sizes: SizeProfileSize[];
  totalPerBox: number;
  isDefault: boolean;
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

/** Article catalogue from the products table (sync-fed). */
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

    // If this is the first profile for the article, mark it default.
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

    // Reset isDefault for every profile of this nmId, then set on the picked one.
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
