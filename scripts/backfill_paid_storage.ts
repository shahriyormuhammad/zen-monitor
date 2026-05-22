import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { dedupePaidStorageItems } from '@/lib/wb-sync-utils';

type Options = {
  from: string;
  to: string;
  tenantId?: string;
  clearRange: boolean;
};

function loadEnv() {
  const cwd = process.cwd();
  const candidates = ['.env.runtime', '.env.production', '.env'];
  for (const rel of candidates) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: false });
    }
  }
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    i += 1;
  }

  const from = args.get('from');
  const to = args.get('to');
  const tenantId = args.get('tenant-id') || undefined;
  const clearRangeRaw = args.get('clear-range') ?? '0';
  const clearRange = clearRangeRaw === '1' || clearRangeRaw.toLowerCase() === 'true';

  if (!from || !to) {
    throw new Error(
      'Usage: npx tsx scripts/backfill_paid_storage.ts --from YYYY-MM-DD --to YYYY-MM-DD [--tenant-id UUID] [--clear-range 1]',
    );
  }

  return { from, to, tenantId, clearRange };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function asUtcDayStart(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function asUtcDayExclusive(dateOnly: string): Date {
  return new Date(asUtcDayStart(dateOnly).getTime() + 86_400_000);
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));

  const [{ db, withTenantContext }, schema, encryption, wb] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('@/lib/encryption'),
    import('@/lib/wb-api'),
  ]);

  const { tenants, rawApiPaidStorage } = schema;

  const tenantRows = options.tenantId
    ? await db.select().from(tenants).where(eq(tenants.id, options.tenantId))
    : await db.select().from(tenants);

  if (tenantRows.length === 0) {
    throw new Error('No tenants found for paid_storage backfill');
  }

  const rangeFrom = asUtcDayStart(options.from);
  const rangeToExclusive = asUtcDayExclusive(options.to);

  console.log(
    `[paid-storage-backfill] range=${options.from}..${options.to} tenants=${tenantRows.length} clearRange=${options.clearRange}`,
  );

  for (const tenant of tenantRows) {
    const token = encryption.decryptIfNeeded(tenant.wbApiToken);
    if (!token || token.trim().length < 20) {
      console.warn(`[paid-storage-backfill] skip tenant=${tenant.id} reason=invalid_token`);
      continue;
    }

    console.log(`[paid-storage-backfill] tenant=${tenant.id} name="${tenant.name}" fetch_start`);
    const rawItems = await wb.wbApi.getPaidStorage(token, options.from, options.to);
    const dedupedItems = dedupePaidStorageItems(rawItems);
    console.log(
      `[paid-storage-backfill] tenant=${tenant.id} fetched=${rawItems.length} deduped=${dedupedItems.length}`,
    );

    let batches = 0;
    const summary = await withTenantContext(db, tenant.id, async (tx) => {
      if (options.clearRange) {
        await tx.delete(rawApiPaidStorage).where(and(
          eq(rawApiPaidStorage.tenantId, tenant.id),
          gte(rawApiPaidStorage.date, rangeFrom),
          lt(rawApiPaidStorage.date, rangeToExclusive),
        ));
        console.log(`[paid-storage-backfill] tenant=${tenant.id} cleared_existing_range`);
      }

      if (dedupedItems.length === 0) {
        const [emptySummary] = await tx
          .select({
            rows: sql<number>`COUNT(*)::int`,
            amount: sql<string>`COALESCE(SUM(${rawApiPaidStorage.storageAmount}), 0)::text`,
          })
          .from(rawApiPaidStorage)
          .where(and(
            eq(rawApiPaidStorage.tenantId, tenant.id),
            gte(rawApiPaidStorage.date, rangeFrom),
            lt(rawApiPaidStorage.date, rangeToExclusive),
          ));
        return emptySummary ?? { rows: 0, amount: '0' };
      }

      for (const batch of chunkArray(dedupedItems, 500)) {
        batches += 1;
        await tx.insert(rawApiPaidStorage).values(batch.map((item) => ({
          tenantId: tenant.id,
          nmId: item.nmId,
          warehouseName: item.warehouseName?.trim() || 'Unknown',
          storageAmount: (item.storageAmount || 0).toString(),
          date: new Date(item.date),
        }))).onConflictDoUpdate({
          target: [
            rawApiPaidStorage.tenantId,
            rawApiPaidStorage.nmId,
            rawApiPaidStorage.warehouseName,
            rawApiPaidStorage.date,
          ],
          set: {
            storageAmount: sql`EXCLUDED.storage_amount`,
          },
        });
      }

      const [rangeSummary] = await tx
        .select({
          rows: sql<number>`COUNT(*)::int`,
          amount: sql<string>`COALESCE(SUM(${rawApiPaidStorage.storageAmount}), 0)::text`,
        })
        .from(rawApiPaidStorage)
        .where(and(
          eq(rawApiPaidStorage.tenantId, tenant.id),
          gte(rawApiPaidStorage.date, rangeFrom),
          lt(rawApiPaidStorage.date, rangeToExclusive),
        ));

      return rangeSummary ?? { rows: 0, amount: '0' };
    });

    if (dedupedItems.length === 0) {
      console.log(`[paid-storage-backfill] tenant=${tenant.id} nothing_to_insert`);
    }

    console.log(
      `[paid-storage-backfill] tenant=${tenant.id} batches=${batches} range_rows=${summary?.rows ?? 0} range_amount=${summary?.amount ?? '0'}`,
    );
  }

  console.log('[paid-storage-backfill] finished');
}

main().catch((error) => {
  console.error('[paid-storage-backfill] failed', error);
  process.exit(1);
});
