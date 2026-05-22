import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { eq, ilike, or } from 'drizzle-orm';

type Options = {
  tenantId?: string;
  tenantName?: string;
  supplyIds: number[];
  preorderIds: number[];
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

function parseIdList(value: string | undefined) {
  if (!value) return [];
  return [...new Set(value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item > 0))];
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    index += 1;
  }

  const tenantId = args.get('tenant-id') || undefined;
  const tenantName = args.get('tenant-name') || undefined;
  const supplyIds = parseIdList(args.get('supply-ids'));
  const preorderIds = parseIdList(args.get('preorder-ids'));

  if ((!tenantId && !tenantName) || (supplyIds.length === 0 && preorderIds.length === 0)) {
    throw new Error(
      'Usage: npx tsx scripts/backfill_wb_supply_writeoffs.ts --tenant-id UUID|--tenant-name TEXT --supply-ids 39101815,39101849 [--preorder-ids ...]',
    );
  }

  return { tenantId, tenantName, supplyIds, preorderIds };
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const [{ db }, schema, service] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('@/server/analytics/stocks-v2/supply-writeoffs'),
  ]);
  const { tenants } = schema;

  const tenantRows = options.tenantId
    ? await db.select({
        id: tenants.id,
        name: tenants.name,
        shopName: tenants.shopName,
      })
        .from(tenants)
        .where(eq(tenants.id, options.tenantId))
    : await db.select({
        id: tenants.id,
        name: tenants.name,
        shopName: tenants.shopName,
      })
        .from(tenants)
        .where(or(
          ilike(tenants.name, `%${options.tenantName ?? ''}%`),
          ilike(tenants.shopName, `%${options.tenantName ?? ''}%`),
        ));

  if (tenantRows.length !== 1) {
    throw new Error(`Expected exactly one tenant, found ${tenantRows.length}`);
  }

  const tenant = tenantRows[0]!;
  console.log(`[wb-supply-writeoffs] tenant=${tenant.id} name="${tenant.shopName ?? tenant.name}" target_supplies=${options.supplyIds.join(',') || '-'} target_preorders=${options.preorderIds.join(',') || '-'}`);

  const summary = await service.reconcileWbSupplyWriteoffsForTenant(tenant.id, {
    supplyIds: options.supplyIds,
    preorderIds: options.preorderIds,
  });

  console.log(`[wb-supply-writeoffs] done supplies=${summary.suppliesScanned} lines=${summary.linesSeen} written_lines=${summary.writtenOffLines} written_units=${summary.writtenOffUnits} discrepancies=${summary.discrepancies} writeoff_errors=${summary.writeOffErrors} notifications_sent=${summary.notificationsSent}`);
}

main().catch((error) => {
  console.error('[wb-supply-writeoffs] failed', error);
  process.exit(1);
});
