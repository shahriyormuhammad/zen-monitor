import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { eq, ne, sql } from 'drizzle-orm';

type Options = {
  tenantId?: string;
  dest: string;
};

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

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

  return {
    tenantId: args.get('tenant-id') || undefined,
    dest: args.get('dest') || process.env.WB_SPP_PUBLIC_DEST || '-1257786',
  };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function calculateImpliedSpp(sellerPriceAfterDiscount: number, customerPrice: number) {
  if (sellerPriceAfterDiscount <= 0 || customerPrice <= 0) {
    return 0;
  }

  return clampPercent(roundMoney(((sellerPriceAfterDiscount - customerPrice) / sellerPriceAfterDiscount) * 100));
}

function resolveMskSnapshotSlot(snapshotAt: Date) {
  const mskDate = new Date(snapshotAt.getTime() + MOSCOW_OFFSET_MS);
  const snapshotDate = mskDate.toISOString().slice(0, 10);
  const snapshotSlot = mskDate.getUTCHours() < 14 ? 'msk-09' : 'msk-18';
  return { snapshotDate, snapshotSlot };
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));

  const [{ db, withAdminContext, withTenantContext }, schema, encryption, wb] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('@/lib/encryption'),
    import('@/lib/wb-api'),
  ]);

  const { tenants, rawApiPrices, rawApiPriceSnapshots } = schema;
  const tenantRows = options.tenantId
    ? await withAdminContext(db, (tx) => tx.select().from(tenants).where(eq(tenants.id, options.tenantId)))
    : await withAdminContext(db, (tx) => tx.select().from(tenants).where(ne(tenants.wbTokenHealthStatus, 'invalid')));

  if (tenantRows.length === 0) {
    throw new Error('No tenants found for SPP snapshot');
  }

  const snapshotAt = new Date();
  const { snapshotDate, snapshotSlot } = resolveMskSnapshotSlot(snapshotAt);
  console.log(
    `[spp-snapshot] tenants=${tenantRows.length} snapshotDate=${snapshotDate} snapshotSlot=${snapshotSlot} dest=${options.dest}`,
  );

  for (const tenant of tenantRows) {
    const token = encryption.decryptIfNeeded(tenant.wbApiToken);
    if (!token || token.trim().length < 20) {
      console.warn(`[spp-snapshot] skip tenant=${tenant.id} name="${tenant.name}" reason=invalid_token`);
      continue;
    }

    console.log(`[spp-snapshot] tenant=${tenant.id} name="${tenant.name}" fetch_start`);
    const priceList = await wb.wbApi.getPrices(token.trim());
    if (priceList.length === 0) {
      console.log(`[spp-snapshot] tenant=${tenant.id} fetched=0`);
      continue;
    }

    const publicPrices = await wb.wbApi.getPublicCardPrices(
      priceList.map((item) => Number(item.nmID)).filter((nmId) => Number.isFinite(nmId) && nmId > 0),
      { dest: options.dest },
    );

    let batches = 0;
    let rows = 0;
    let publicRows = 0;
    let sppSum = 0;

    await withTenantContext(db, tenant.id, async (tx) => {
      for (const batch of chunkArray(priceList, 500)) {
        batches += 1;
        const now = new Date();
        const normalizedRows = batch
          .map((item) => {
            const nmId = Number(item.nmID);
            if (!Number.isFinite(nmId) || nmId <= 0) {
              return null;
            }

            const price = roundMoney(toFiniteNumber(item.price));
            const discount = Math.round(clampPercent(toFiniteNumber(item.discount)));
            const apiSpp = Math.round(clampPercent(toFiniteNumber(item.spp)));
            const sellerPriceAfterDiscount = roundMoney(price * (1 - discount / 100));
            const fallbackCustomerPrice = roundMoney(sellerPriceAfterDiscount * (1 - apiSpp / 100));
            const publicPrice = publicPrices.get(nmId);
            const customerPrice = publicPrice?.customerPrice && publicPrice.customerPrice > 0
              ? roundMoney(publicPrice.customerPrice)
              : fallbackCustomerPrice;
            const impliedSpp = publicPrice
              ? calculateImpliedSpp(sellerPriceAfterDiscount, customerPrice)
              : apiSpp;
            const snapshotSpp = Math.round(clampPercent(impliedSpp));

            rows += 1;
            publicRows += publicPrice ? 1 : 0;
            sppSum += snapshotSpp;

            return {
              tenantId: tenant.id,
              nmId,
              price,
              discount,
              apiSpp,
              sellerPriceAfterDiscount,
              customerPrice,
              impliedSpp,
              snapshotSpp,
              publicPriceSource: publicPrice ? 'wb_card_v4' : 'prices_api_fallback',
              updatedAt: now,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        if (normalizedRows.length === 0) {
          continue;
        }

        await tx.insert(rawApiPrices).values(normalizedRows.map((item) => ({
          tenantId: item.tenantId,
          nmId: item.nmId,
          price: item.price.toString(),
          discount: item.discount,
          spp: item.apiSpp,
          updatedAt: item.updatedAt,
        }))).onConflictDoUpdate({
          target: [rawApiPrices.tenantId, rawApiPrices.nmId],
          set: {
            price: sql`EXCLUDED.price`,
            discount: sql`EXCLUDED.discount`,
            spp: sql`EXCLUDED.spp`,
            updatedAt: sql`EXCLUDED.updated_at`,
          },
        });

        await tx.insert(rawApiPriceSnapshots).values(normalizedRows.map((item) => ({
          tenantId: item.tenantId,
          nmId: item.nmId,
          snapshotAt,
          snapshotDate,
          snapshotSlot,
          price: item.price.toString(),
          discount: item.discount,
          spp: item.snapshotSpp,
          sellerPriceAfterDiscount: item.sellerPriceAfterDiscount.toString(),
          customerPrice: item.customerPrice.toString(),
          priceAfterSpp: item.customerPrice.toString(),
          impliedSpp: item.impliedSpp.toString(),
          publicPriceSource: item.publicPriceSource,
          publicDest: options.dest,
          updatedAt: item.updatedAt,
        }))).onConflictDoUpdate({
          target: [
            rawApiPriceSnapshots.tenantId,
            rawApiPriceSnapshots.nmId,
            rawApiPriceSnapshots.snapshotDate,
            rawApiPriceSnapshots.snapshotSlot,
          ],
          set: {
            snapshotAt: sql`EXCLUDED.snapshot_at`,
            price: sql`EXCLUDED.price`,
            discount: sql`EXCLUDED.discount`,
            spp: sql`EXCLUDED.spp`,
            sellerPriceAfterDiscount: sql`EXCLUDED.seller_price_after_discount`,
            customerPrice: sql`EXCLUDED.customer_price`,
            priceAfterSpp: sql`EXCLUDED.price_after_spp`,
            impliedSpp: sql`EXCLUDED.implied_spp`,
            publicPriceSource: sql`EXCLUDED.public_price_source`,
            publicDest: sql`EXCLUDED.public_dest`,
            updatedAt: sql`EXCLUDED.updated_at`,
          },
        });
      }
    });

    const avgSpp = rows > 0 ? sppSum / rows : 0;
    console.log(
      `[spp-snapshot] tenant=${tenant.id} rows=${rows} publicRows=${publicRows} batches=${batches} avgSpp=${avgSpp.toFixed(2)}`,
    );
  }

  console.log('[spp-snapshot] finished');
}

main().catch((error) => {
  console.error('[spp-snapshot] failed', error);
  process.exit(1);
});
