/**
 * Supply builder — accumulated shipment list. Port of Postal's
 * supplyList (Шаг 1 + Шаг 2 share the same array; Шаг 3 reads it for
 * box-barcode generation).
 *
 * Public API:
 *   listProfilesForArticle(tenantId, nmId, vendorCode) →
 *       SizeProfile[]   — feed the dropdown
 *   addSupplyItem(tenantId, input)        — append/replace one row
 *   addSupplyItemsBulk(tenantId, inputs)  — used by the накладная parser
 *   listSupplyItems(tenantId)             — full current list
 *   removeSupplyItem(tenantId, id)        — drop one row
 *   clearSupplyItems(tenantId)            — wipe all
 *   matchVendorCode(tenantId, query)      — fuzzy lookup for Шаг 2
 *
 * Dedup key matches Постал: `(vendor_code, profile_id)` — re-adding the
 * same article with the same profile overwrites the prior row, so the
 * UI feels like an idempotent upsert.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import {
  sizeProfiles,
  supplyItems,
  type SupplyItemRow,
} from '@/lib/db/schema';

export type SupplyItem = {
  id: string;
  vendorCode: string;
  nmId: number | null;
  profileId: string | null;
  profileName: string | null;
  boxes: number;
  sumPerBox: number;
  totalPieces: number;
  rows: SupplyItemRow[];
  missingBc: number;
  source: 'manual' | 'invoice';
  createdAt: Date;
  updatedAt: Date;
};

export type ProfileForDropdown = {
  id: string;
  name: string;
  isDefault: boolean;
  sourceTemplate: string | null;
  totalPerBox: number;
  rows: SupplyItemRow[];
};

export async function listProfilesForArticle(
  tenantId: string,
  nmId: number | null,
  vendorCode: string,
): Promise<ProfileForDropdown[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const profiles = nmId
      ? await tx
        .select()
        .from(sizeProfiles)
        .where(and(
          eq(sizeProfiles.tenantId, tenantId),
          eq(sizeProfiles.nmId, nmId),
        ))
      : await tx
        .select()
        .from(sizeProfiles)
        .where(and(
          eq(sizeProfiles.tenantId, tenantId),
          eq(sizeProfiles.vendorCode, vendorCode),
        ));
    profiles.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return profiles.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      sourceTemplate: p.sourceTemplate,
      totalPerBox: p.totalPerBox,
      rows: (p.sizes ?? []).map((s) => ({
        size: s.size,
        perBox: s.perBox,
        boxes: 0,
        total: 0,
        barcode: s.barcode ?? '',
      })),
    }));
  });
}

export type SupplyItemInput = {
  vendorCode: string;
  nmId?: number | null;
  profileId?: string | null;
  profileName?: string | null;
  boxes: number;
  /** Built from the chosen profile's sizes + boxes. */
  rows: SupplyItemRow[];
  source?: 'manual' | 'invoice';
};

export async function addSupplyItem(tenantId: string, input: SupplyItemInput): Promise<SupplyItem> {
  const boxes = Math.max(1, Math.floor(input.boxes));
  const rows = input.rows.map((r) => ({
    size: String(r.size).trim(),
    perBox: Math.max(0, Math.floor(r.perBox)),
    boxes,
    total: Math.max(0, Math.floor(r.perBox)) * boxes,
    barcode: (r.barcode ?? '').trim(),
  })).filter((r) => r.size.length > 0);
  if (rows.length === 0) {
    throw new Error('Ростовка пустая — выбери профиль или добавь хотя бы один размер');
  }
  const sumPerBox = rows.reduce((s, r) => s + r.perBox, 0);
  if (sumPerBox <= 0) {
    throw new Error('В коробке должно быть больше 0 пар');
  }
  const totalPieces = sumPerBox * boxes;
  const missingBc = rows.filter((r) => r.total > 0 && !r.barcode).length;

  return withTenantContext(db, tenantId, async (tx) => {
    // Dedup: same (vendorCode + profileId) → update existing row.
    const existing = input.profileId
      ? await tx.select({ id: supplyItems.id }).from(supplyItems).where(and(
        eq(supplyItems.tenantId, tenantId),
        eq(supplyItems.vendorCode, input.vendorCode.trim()),
        eq(supplyItems.profileId, input.profileId),
      )).limit(1)
      : await tx.select({ id: supplyItems.id }).from(supplyItems).where(and(
        eq(supplyItems.tenantId, tenantId),
        eq(supplyItems.vendorCode, input.vendorCode.trim()),
        isNull(supplyItems.profileId),
      )).limit(1);

    if (existing[0]) {
      const [updated] = await tx.update(supplyItems).set({
        nmId: input.nmId ?? null,
        profileName: input.profileName ?? null,
        boxes,
        sumPerBox,
        totalPieces,
        rows,
        missingBc,
        source: input.source ?? 'manual',
        updatedAt: new Date(),
      }).where(and(
        eq(supplyItems.tenantId, tenantId),
        eq(supplyItems.id, existing[0].id),
      )).returning();
      return toSupplyItem(updated!);
    }

    const [created] = await tx.insert(supplyItems).values({
      tenantId,
      vendorCode: input.vendorCode.trim(),
      nmId: input.nmId ?? null,
      profileId: input.profileId ?? null,
      profileName: input.profileName ?? null,
      boxes,
      sumPerBox,
      totalPieces,
      rows,
      missingBc,
      source: input.source ?? 'manual',
    }).returning();
    return toSupplyItem(created!);
  });
}

export async function addSupplyItemsBulk(
  tenantId: string,
  inputs: SupplyItemInput[],
): Promise<{ added: SupplyItem[]; failed: { input: SupplyItemInput; reason: string }[] }> {
  const added: SupplyItem[] = [];
  const failed: { input: SupplyItemInput; reason: string }[] = [];
  for (const input of inputs) {
    try {
      const item = await addSupplyItem(tenantId, input);
      added.push(item);
    } catch (e) {
      failed.push({ input, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { added, failed };
}

export async function listSupplyItems(tenantId: string): Promise<SupplyItem[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(supplyItems)
      .where(eq(supplyItems.tenantId, tenantId))
      .orderBy(desc(supplyItems.createdAt));
    return rows.map(toSupplyItem);
  });
}

export async function removeSupplyItem(tenantId: string, id: string): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    await tx
      .delete(supplyItems)
      .where(and(eq(supplyItems.tenantId, tenantId), eq(supplyItems.id, id)));
  });
}

export async function clearSupplyItems(tenantId: string): Promise<void> {
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.delete(supplyItems).where(eq(supplyItems.tenantId, tenantId));
  });
}

/**
 * Fuzzy match a free-form vendorCode entry from the накладная input.
 *
 * Rules (port of Постал findBestRostovkaMatch):
 *   - Strip non-alphanumeric chars from both query and candidates, then
 *     do case-insensitive substring containment in both directions.
 *   - If multiple candidates match, prefer the longest vendorCode (more
 *     specific) — e.g. "519-5" prefers "А519-5 ТН-10" over "А519".
 */
export async function matchVendorCode(
  tenantId: string,
  query: string,
): Promise<{ vendorCode: string; nmId: number | null } | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
  const q = norm(query);
  if (q.length === 0) return null;
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT p.vendor_code, p.nm_id::text AS nm_id
      FROM products p
      WHERE p.tenant_id = ${tenantId}
        AND p.is_hidden = false
        AND p.is_archived = false
    `);
    const candidates = rows as unknown as Array<{ vendor_code: string; nm_id: string }>;
    let best: { vendorCode: string; nmId: number | null } | null = null;
    let bestLen = -1;
    for (const c of candidates) {
      const normalized = norm(c.vendor_code);
      if (!normalized.includes(q) && !q.includes(normalized)) continue;
      if (c.vendor_code.length > bestLen) {
        best = { vendorCode: c.vendor_code, nmId: c.nm_id ? Number(c.nm_id) : null };
        bestLen = c.vendor_code.length;
      }
    }
    return best;
  });
}

function toSupplyItem(row: typeof supplyItems.$inferSelect): SupplyItem {
  return {
    id: row.id,
    vendorCode: row.vendorCode,
    nmId: row.nmId == null ? null : Number(row.nmId),
    profileId: row.profileId,
    profileName: row.profileName,
    boxes: row.boxes,
    sumPerBox: row.sumPerBox,
    totalPieces: row.totalPieces,
    rows: Array.isArray(row.rows) ? row.rows : [],
    missingBc: row.missingBc,
    source: row.source as 'manual' | 'invoice',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
