import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { HistoricalAdCostInsert } from '@/server/advertising/ad-cost-history';

type Options = {
  from: string;
  to: string;
  tenantId: string;
  clearRange: boolean;
  source: 'auto' | 'fullstats' | 'history';
  campaignIds: number[];
};

type AdCostInsert = HistoricalAdCostInsert;

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
  const tenantId = args.get('tenant-id');
  const clearRangeRaw = args.get('clear-range') ?? '0';
  const clearRange = clearRangeRaw === '1' || clearRangeRaw.toLowerCase() === 'true';
  const sourceRaw = args.get('source') ?? 'auto';
  const source = sourceRaw === 'fullstats' || sourceRaw === 'history' || sourceRaw === 'auto'
    ? sourceRaw
    : null;
  const campaignIds = (args.get('campaign-ids') ?? '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.trunc(entry));

  if (!from || !to || !tenantId || !source) {
    throw new Error('Usage: npx tsx scripts/backfill_ads_costs.ts --tenant-id UUID --from YYYY-MM-DD --to YYYY-MM-DD [--clear-range 1] [--source auto|fullstats|history] [--campaign-ids 1,2]');
  }

  return { from, to, tenantId, clearRange, source, campaignIds };
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));

  const [{ db, withTenantContext }, schema, drizzle, encryption, wb, { buildHistoricalAdCostRows, dedupeAdCostRows }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('drizzle-orm'),
    import('@/lib/encryption'),
    import('@/lib/wb-api'),
    import('@/server/advertising/ad-cost-history'),
  ]);

  const { tenants, rawApiAdCosts } = schema;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, options.tenantId)).limit(1);
  if (!tenant) {
    throw new Error(`Tenant not found: ${options.tenantId}`);
  }

  const token = encryption.decryptIfNeeded(tenant.wbApiToken);
  if (!token || token.trim().length < 20) {
    throw new Error(`Invalid token for tenant ${tenant.id}`);
  }

  const dateFromIso = `${options.from}T00:00:00.000Z`;
  const dateToIso = `${options.to}T23:59:59.999Z`;
  const toExclusiveIso = new Date(new Date(`${options.to}T00:00:00.000Z`).getTime() + 86_400_000).toISOString();

  console.log(`[ads-backfill] tenant=${tenant.id} name="${tenant.name}" range=${options.from}..${options.to}`);
  let sourceMode: 'fullstats' | 'history_upd' = 'fullstats';
  let inserts: AdCostInsert[] = [];
  let historyMeta: {
    historyRowCount: number;
    campaignCount: number;
    unallocatedCampaignCount: number;
    unallocatedAmountRub: number;
  } | null = null;

  if (options.source !== 'history') {
    try {
      const campaigns = options.campaignIds.length > 0
        ? (await wb.wbApi.getAdCampaigns(token)).filter((campaign) => options.campaignIds.includes(campaign.advertId))
        : undefined;
      const ads = await wb.wbApi.getAdSpend(token, dateFromIso, dateToIso, {
        groupBy: 'advert_nm_date',
        ...(campaigns ? { campaigns } : {}),
      });
      if (ads.length > 0) {
        inserts = ads
          .filter((item) => Number.isFinite(item.nmId) && item.nmId > 0 && Number.isFinite(item.sum))
          .map((item) => ({
            tenantId: tenant.id,
            nmId: item.nmId,
            date: new Date(item.date),
            amount: Number(item.sum).toString(),
            orderCount: Math.max(0, Math.round(item.orderCount || 0)),
            orderSum: (item.orderSum || 0).toString(),
            views: Math.max(0, Math.round(item.views || 0)),
            clicks: Math.max(0, Math.round(item.clicks || 0)),
            type: 'unified',
            placement: item.advertId ? `campaign:${item.advertId}` : 'overall',
          }));
      }
    } catch (error) {
      if (options.source === 'fullstats') {
        throw error;
      }
      console.warn('[ads-backfill] fullstats failed, fallback to history', error);
    }
  }

  if (options.source === 'history' || (options.source === 'auto' && inserts.length === 0)) {
    sourceMode = 'history_upd';
    const historyRows = await buildHistoricalAdCostRows({
      tenantId: tenant.id,
      token,
      dateFrom: options.from,
      dateTo: options.to,
    });
    inserts = historyRows.rows;
    historyMeta = {
      historyRowCount: historyRows.historyRowCount,
      campaignCount: historyRows.campaignCount,
      unallocatedCampaignCount: historyRows.unallocatedCampaignCount,
      unallocatedAmountRub: historyRows.unallocatedAmountRub,
    };
  }

  if (inserts.length === 0) {
    console.log('[ads-backfill] nothing_to_insert');
    return;
  }
  const rawInsertRows = inserts.length;
  inserts = dedupeAdCostRows(inserts);

  const chunkSize = 500;
  let batches = 0;
  const totals = await withTenantContext(db, tenant.id, async (tx) => {
    if (options.clearRange) {
      await tx
        .delete(rawApiAdCosts)
        .where(and(
          eq(rawApiAdCosts.tenantId, tenant.id),
          gte(rawApiAdCosts.date, new Date(dateFromIso)),
          lt(rawApiAdCosts.date, new Date(toExclusiveIso)),
        ));
      console.log(`[ads-backfill] cleared_existing_range`);
    }

    for (let i = 0; i < inserts.length; i += chunkSize) {
      batches += 1;
      const chunk = inserts.slice(i, i + chunkSize);
      await tx.insert(rawApiAdCosts).values(chunk).onConflictDoUpdate({
        target: [rawApiAdCosts.tenantId, rawApiAdCosts.nmId, rawApiAdCosts.date, rawApiAdCosts.placement],
        set: {
          amount: sql`EXCLUDED.amount`,
          orderCount: sql`EXCLUDED.order_count`,
          orderSum: sql`EXCLUDED.order_sum`,
          views: sql`EXCLUDED.views`,
          clicks: sql`EXCLUDED.clicks`,
          type: sql`EXCLUDED.type`,
        },
      });
    }

    return tx
      .select({
        amount: drizzle.sql<string>`COALESCE(SUM(${rawApiAdCosts.amount}), 0)::text`,
        rows: drizzle.sql<number>`COUNT(*)::int`,
      })
      .from(rawApiAdCosts)
      .where(and(
        eq(rawApiAdCosts.tenantId, tenant.id),
        gte(rawApiAdCosts.date, new Date(dateFromIso)),
        lt(rawApiAdCosts.date, new Date(toExclusiveIso)),
      ));
  });

  const summary = totals[0] ?? { amount: '0', rows: 0 };
  console.log(`[ads-backfill] source=${sourceMode} raw_rows=${rawInsertRows} inserted_rows=${inserts.length} batches=${batches}`);
  if (historyMeta) {
    console.log(
      `[ads-backfill] history_rows=${historyMeta.historyRowCount} campaigns=${historyMeta.campaignCount} ` +
      `unallocated_campaigns=${historyMeta.unallocatedCampaignCount} unallocated_amount=${historyMeta.unallocatedAmountRub.toFixed(2)}`,
    );
  }
  console.log(`[ads-backfill] range_rows=${summary.rows} range_amount=${summary.amount}`);
}

main().catch((error) => {
  console.error('[ads-backfill] failed', error);
  process.exit(1);
});
