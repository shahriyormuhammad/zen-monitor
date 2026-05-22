import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { eq, sql } from 'drizzle-orm';

type TariffType = 'acceptance' | 'box' | 'return' | 'commission';

type Options = {
  from: string;
  to: string;
  tenantId?: string;
  types: TariffType[];
  allowEmpty: boolean;
  strict: boolean;
};

function loadEnv() {
  const cwd = process.cwd();
  for (const rel of ['.env.runtime', '.env.production', '.env']) {
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
  const rawTypes = (args.get('types') ?? 'acceptance,box,return,commission')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const types = rawTypes.filter((item): item is TariffType => (
    item === 'acceptance' || item === 'box' || item === 'return' || item === 'commission'
  ));
  const allowEmptyRaw = args.get('allow-empty') ?? '0';
  const strictRaw = args.get('strict') ?? '0';
  const allowEmpty = allowEmptyRaw === '1' || allowEmptyRaw.toLowerCase() === 'true';
  const strict = strictRaw === '1' || strictRaw.toLowerCase() === 'true';

  if (!from || !to || types.length === 0) {
    throw new Error(
      'Usage: npx tsx scripts/backfill_wb_tariffs.ts --from YYYY-MM-DD --to YYYY-MM-DD [--tenant-id UUID] [--types acceptance,box,return,commission] [--allow-empty 1] [--strict 1]',
    );
  }

  return { from, to, tenantId, types, allowEmpty, strict };
}

function parseDateOnly(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return timestamp;
}

function enumerateDates(from: string, to: string) {
  const fromTs = parseDateOnly(from);
  const toTs = parseDateOnly(to);
  if (fromTs > toTs) {
    throw new Error('--from must be <= --to');
  }
  const dates: string[] = [];
  for (let ts = fromTs; ts <= toTs; ts += 86_400_000) {
    dates.push(new Date(ts).toISOString().slice(0, 10));
  }
  return dates;
}

function asDateOnly(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const dates = enumerateDates(options.from, options.to);
  const [{ db, withTenantContext }, schema, encryption, wb] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('@/lib/encryption'),
    import('@/lib/wb-api'),
  ]);

  const { tenants, wbTariffSnapshots, wbCategoryCommissionSnapshots } = schema;
  const tenantRows = options.tenantId
    ? await db.select().from(tenants).where(eq(tenants.id, options.tenantId))
    : await db.select().from(tenants);

  if (tenantRows.length === 0) {
    throw new Error('No tenants found for tariffs backfill');
  }

  console.log(
    `[tariffs-backfill] range=${options.from}..${options.to} tenants=${tenantRows.length} types=${options.types.join(',')} allowEmpty=${options.allowEmpty}`,
  );

  for (const tenant of tenantRows) {
    const token = encryption.decryptIfNeeded(tenant.wbApiToken);
    if (!token || token.trim().length < 20) {
      console.warn(`[tariffs-backfill] skip tenant=${tenant.id} reason=invalid_token`);
      continue;
    }

    let saved = 0;
    let failed = 0;
    console.log(`[tariffs-backfill] tenant=${tenant.id} name="${tenant.name}" fetch_start`);

    if (options.types.includes('acceptance')) {
      try {
        const acceptance = await wb.wbApi.getAcceptanceTariffs(token);
        const byDate = new Map<string, unknown[]>();
        for (const item of acceptance) {
          const date = asDateOnly((item as { date?: unknown }).date);
          if (!date || !dates.includes(date)) continue;
          const bucket = byDate.get(date) ?? [];
          bucket.push(item);
          byDate.set(date, bucket);
        }

        await withTenantContext(db, tenant.id, async (tx) => {
          for (const date of dates) {
            const data = byDate.get(date) ?? [];
            if (data.length === 0 && !options.allowEmpty) continue;
            await tx.insert(wbTariffSnapshots).values({
              tenantId: tenant.id,
              tariffType: 'acceptance',
              snapshotDate: date,
              data,
            }).onConflictDoUpdate({
              target: [wbTariffSnapshots.tenantId, wbTariffSnapshots.tariffType, wbTariffSnapshots.snapshotDate],
              set: { data: sql`EXCLUDED.data`, createdAt: sql`NOW()` },
            });
            saved += 1;
          }
        });
      } catch (error) {
        failed += 1;
        console.warn('[tariffs-backfill] acceptance failed', error);
        if (options.strict) throw error;
      }
    }

    if (options.types.includes('commission')) {
      try {
        const commissions = await wb.wbApi.getCategoryCommissions(token);
        if (commissions.length > 0 || options.allowEmpty) {
          await withTenantContext(db, tenant.id, async (tx) => {
            for (const date of dates) {
              await tx.insert(wbCategoryCommissionSnapshots).values({
                tenantId: tenant.id,
                snapshotDate: date,
                data: commissions,
              }).onConflictDoUpdate({
                target: [wbCategoryCommissionSnapshots.tenantId, wbCategoryCommissionSnapshots.snapshotDate],
                set: { data: sql`EXCLUDED.data`, createdAt: sql`NOW()` },
              });
              saved += 1;
            }
          });
        }
      } catch (error) {
        failed += 1;
        console.warn('[tariffs-backfill] commission failed', error);
        if (options.strict) throw error;
      }
    }

    for (const date of dates) {
      if (options.types.includes('box')) {
        try {
          const boxTariffs = await wb.wbApi.getBoxTariffs(token, date);
          if (boxTariffs.length > 0 || options.allowEmpty) {
            await withTenantContext(db, tenant.id, async (tx) => {
              await tx.insert(wbTariffSnapshots).values({
                tenantId: tenant.id,
                tariffType: 'box',
                snapshotDate: date,
                data: boxTariffs,
              }).onConflictDoUpdate({
                target: [wbTariffSnapshots.tenantId, wbTariffSnapshots.tariffType, wbTariffSnapshots.snapshotDate],
                set: { data: sql`EXCLUDED.data`, createdAt: sql`NOW()` },
              });
            });
            saved += 1;
          }
        } catch (error) {
          failed += 1;
          console.warn(`[tariffs-backfill] box failed date=${date}`, error);
          if (options.strict) throw error;
        }
      }

      if (options.types.includes('return')) {
        try {
          const returnTariffs = await wb.wbApi.getReturnTariffs(token, date);
          if (returnTariffs.length > 0 || options.allowEmpty) {
            await withTenantContext(db, tenant.id, async (tx) => {
              await tx.insert(wbTariffSnapshots).values({
                tenantId: tenant.id,
                tariffType: 'return',
                snapshotDate: date,
                data: returnTariffs,
              }).onConflictDoUpdate({
                target: [wbTariffSnapshots.tenantId, wbTariffSnapshots.tariffType, wbTariffSnapshots.snapshotDate],
                set: { data: sql`EXCLUDED.data`, createdAt: sql`NOW()` },
              });
            });
            saved += 1;
          }
        } catch (error) {
          failed += 1;
          console.warn(`[tariffs-backfill] return failed date=${date}`, error);
          if (options.strict) throw error;
        }
      }
    }

    console.log(`[tariffs-backfill] tenant=${tenant.id} saved_snapshots=${saved} failed_calls=${failed}`);
  }

  console.log('[tariffs-backfill] finished');
}

main().catch((error) => {
  console.error('[tariffs-backfill] failed', error);
  process.exit(1);
});
