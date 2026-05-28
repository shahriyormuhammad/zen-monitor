/**
 * Sync size catalogue (tech_size + barcode + chrt_id) from the WB Content
 * API into the `product_sizes` table. Port of Postal's
 * «Подтянуть размеры через WB API» (panel-plan, supPullApi handler).
 *
 * Process:
 *   1. Read the tenant's WB API token (encrypted in tenants.wbApiToken).
 *   2. Call wbApi.getAllCardsList(token) which paginates over all cards
 *      via /content/v2/get/cards/list with limit=100.
 *   3. For each card, walk its sizes[] array; every size has techSize +
 *      skus[] (one or more barcodes). Flatten into product_sizes rows.
 *   4. Replace the tenant's product_sizes via DELETE + INSERT (small set,
 *      ≤ low thousands per tenant, an atomic swap is fine).
 *
 * Returns a summary that the UI shows after the sync finishes.
 */

import { eq } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { productSizes, tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { wbApi, type WbProductCard } from '@/lib/wb-api';

export type ProductSizesSyncSummary = {
  cardsFetched: number;
  rowsInserted: number;
  nmIdsWithSizes: number;
  durationMs: number;
};

type WbCardSize = {
  techSize?: unknown;
  wbSize?: unknown;
  chrtID?: unknown;
  skus?: unknown;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

function asPositiveBigInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Extract {techSize, barcode, chrtId}[] from a card's raw sizes[] field. */
function extractCardSizes(card: WbProductCard): Array<{ techSize: string; barcode: string; chrtId: number | null }> {
  if (!Array.isArray(card.sizes)) return [];
  const out: Array<{ techSize: string; barcode: string; chrtId: number | null }> = [];
  for (const raw of card.sizes as WbCardSize[]) {
    if (!raw || typeof raw !== 'object') continue;
    const techSize = asTrimmedString(raw.techSize) ?? asTrimmedString(raw.wbSize);
    if (!techSize || techSize === '0') continue;
    const chrtId = asPositiveBigInt(raw.chrtID);
    const skus = Array.isArray(raw.skus) ? raw.skus : [];
    for (const sku of skus) {
      const barcode = asTrimmedString(sku);
      if (!barcode) continue;
      out.push({ techSize, barcode, chrtId });
    }
  }
  return out;
}

async function loadTenantWbToken(tenantId: string): Promise<string> {
  const [row] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const token = decryptIfNeeded(row?.wbApiToken ?? '').trim();
  if (!token) {
    throw new Error('Не найден API-токен Wildberries для этого кабинета. Добавьте токен в Настройках выше.');
  }
  return token;
}

/**
 * Full re-sync of the size catalogue for one tenant. ~10-30s for cabinets
 * with hundreds of cards (paginated through WB Content API).
 */
export async function syncProductSizes(tenantId: string): Promise<ProductSizesSyncSummary> {
  const startedAt = Date.now();
  const token = await loadTenantWbToken(tenantId);

  // Pull every card (paginated). limit=100 is the WB-recommended page size.
  // filter: { withPhoto: -1 } matches Постал — without it WB defaults to
  // { withRoot: true } which silently filters out a lot of cards (for the
  // ИП Шахриёр cabinet the default returned 0 cards in production).
  const cards = await wbApi.getAllCardsList(token, 100, {
    filter: { withPhoto: -1 },
  });

  // Flatten into product_sizes rows.
  const seen = new Set<string>();
  const rows: Array<{
    tenantId: string;
    nmId: number;
    techSize: string;
    barcode: string;
    chrtId: number | null;
  }> = [];
  let nmIdsWithSizes = 0;

  for (const card of cards) {
    const nmId = typeof card.nmID === 'number' && Number.isFinite(card.nmID) ? card.nmID : null;
    if (!nmId) continue;
    const sizes = extractCardSizes(card);
    if (sizes.length === 0) continue;
    nmIdsWithSizes += 1;
    for (const s of sizes) {
      const key = `${nmId}|${s.techSize}|${s.barcode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        tenantId,
        nmId,
        techSize: s.techSize,
        barcode: s.barcode,
        chrtId: s.chrtId,
      });
    }
  }

  // Atomic swap: delete then bulk-insert inside the tenant RLS context.
  await withTenantContext(db, tenantId, async (tx) => {
    await tx.delete(productSizes).where(eq(productSizes.tenantId, tenantId));
    if (rows.length === 0) return;
    // Drizzle's chunked insert keeps the query parameters under the
    // PostgreSQL limit (≈ 65535 placeholders); 500 rows × 5 cols = 2.5k.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await tx.insert(productSizes).values(chunk);
    }
  });

  return {
    cardsFetched: cards.length,
    rowsInserted: rows.length,
    nmIdsWithSizes,
    durationMs: Date.now() - startedAt,
  };
}
