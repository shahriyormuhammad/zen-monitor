import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

type Options = {
  tenantId: string;
  cabinetOid: string;
  from: string;
  to: string;
  replaceRange: boolean;
  limitCampaigns: number | null;
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

  const tenantId = args.get('tenant-id');
  const cabinetOid = args.get('cabinet-oid');
  const from = args.get('from');
  const to = args.get('to');
  const replaceRaw = args.get('replace-range') ?? '1';
  const limitRaw = args.get('limit-campaigns');
  const limitCampaigns = limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10) || 0) : null;

  if (!tenantId || !cabinetOid || !from || !to) {
    throw new Error(
      'Usage: npx tsx scripts/backfill_wb_search_positions.ts --tenant-id UUID --cabinet-oid lavrov-main|berbeka-main --from YYYY-MM-DD --to YYYY-MM-DD [--replace-range 1] [--limit-campaigns N]',
    );
  }

  return {
    tenantId,
    cabinetOid,
    from,
    to,
    replaceRange: replaceRaw === '1' || replaceRaw.toLowerCase() === 'true',
    limitCampaigns,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

type SearchClusterStat = {
  nmId: number;
  date: string;
  keyword: string;
  views?: number;
  clicks?: number;
  sum?: number;
  orders?: number;
  atbs?: number;
  avgPos?: number;
  ctr?: number;
  [key: string]: unknown;
};

function aggregateStats(stats: SearchClusterStat[]) {
  const grouped = new Map<string, SearchClusterStat & { sourceRows: number }>();

  for (const item of stats) {
    const key = `${item.nmId}:${dateOnly(item.date)}:${item.keyword}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...item, date: dateOnly(item.date), sourceRows: 1 });
      continue;
    }

    const views = Number(existing.views || 0) + Number(item.views || 0);
    const clicks = Number(existing.clicks || 0) + Number(item.clicks || 0);
    const sum = Number(existing.sum || 0) + Number(item.sum || 0);
    const orders = Number(existing.orders || 0) + Number(item.orders || 0);
    const atbs = Number(existing.atbs || 0) + Number(item.atbs || 0);
    const sourceRows = existing.sourceRows + 1;
    const avgPosValues = [existing.avgPos, item.avgPos]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    const avgPos = avgPosValues.length > 0
      ? avgPosValues.reduce((total, value) => total + value, 0) / avgPosValues.length
      : existing.avgPos;

    grouped.set(key, {
      ...existing,
      views,
      clicks,
      sum,
      orders,
      atbs,
      avgPos,
      ctr: views > 0 ? (clicks / views) * 100 : 0,
      sourceRows,
    });
  }

  return Array.from(grouped.values());
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
  const { tenants, rawApiAdClusters, procifrySearchPositions } = schema;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, options.tenantId)).limit(1);
  if (!tenant) {
    throw new Error(`Tenant not found: ${options.tenantId}`);
  }

  const token = encryption.decryptIfNeeded(tenant.wbApiToken);
  if (!token || token.trim().length < 20) {
    throw new Error(`Invalid token for tenant ${tenant.id}`);
  }

  const campaigns = await wb.wbApi.getAdCampaigns(token);
  const searchCampaigns = campaigns
    .filter((campaign) => campaign.searchPlacement && campaign.status !== undefined && [7, 9, 11].includes(campaign.status))
    .slice(0, options.limitCampaigns ?? campaigns.length);
  const items = Array.from(new Map(
    searchCampaigns
      .flatMap((campaign) => campaign.nmIds.map((nmId) => ({
        key: `${campaign.advertId}:${nmId}`,
        advertId: campaign.advertId,
        nmId,
      })))
      .map((item) => [item.key, { advertId: item.advertId, nmId: item.nmId }]),
  ).values());

  console.log(
    `[search-positions-backfill] tenant=${tenant.id} name="${tenant.name}" ` +
    `range=${options.from}..${options.to} campaigns=${searchCampaigns.length} items=${items.length}`,
  );

  if (items.length === 0) {
    console.log('[search-positions-backfill] nothing_to_fetch');
    return;
  }

  const rawStats = await wb.wbApi.getSearchClusterStats(token, options.from, options.to, items);
  if (rawStats.length === 0) {
    console.log('[search-positions-backfill] no_stats');
    return;
  }

  const stats = aggregateStats(rawStats);
  const sourceUpdatedAt = new Date();
  const rawClusterRows = stats.map((item) => ({
    tenantId: tenant.id,
    nmId: item.nmId,
    cluster: item.keyword,
    views: Math.max(0, Math.round(item.views || 0)),
    clicks: Math.max(0, Math.round(item.clicks || 0)),
    ctr: (item.ctr || 0).toString(),
    amount: (item.sum || 0).toString(),
    orderCount: Math.max(0, Math.round(item.orders || item.atbs || 0)),
    date: new Date(`${dateOnly(item.date)}T00:00:00.000Z`),
  }));
  const searchPositionRows = stats.map((item) => ({
    tenantId: tenant.id,
    cabinetOid: options.cabinetOid,
    observedDate: dateOnly(item.date),
    keyword: item.keyword,
    nmId: item.nmId,
    position: Number.isFinite(item.avgPos) && Number(item.avgPos) > 0 ? Math.round(Number(item.avgPos)) : null,
    frequency: null,
    impressions: Number.isFinite(item.views) && Number(item.views) > 0 ? Math.round(Number(item.views)) : null,
    organicOrAd: 'ad',
    source: 'wb_adv_normquery_stats',
    sourceUpdatedAt,
    confidence: 'partial',
    payload: item as unknown as Record<string, unknown>,
  }));

  await withTenantContext(db, tenant.id, async (tx) => {
    if (options.replaceRange) {
      await tx.delete(procifrySearchPositions).where(and(
        eq(procifrySearchPositions.tenantId, tenant.id),
        eq(procifrySearchPositions.cabinetOid, options.cabinetOid),
        gte(procifrySearchPositions.observedDate, options.from),
        lte(procifrySearchPositions.observedDate, options.to),
      ));
    }

    for (const chunk of chunkArray(rawClusterRows, 500)) {
      await tx.insert(rawApiAdClusters).values(chunk).onConflictDoUpdate({
        target: [rawApiAdClusters.tenantId, rawApiAdClusters.nmId, rawApiAdClusters.date, rawApiAdClusters.cluster],
        set: {
          views: sql`EXCLUDED.views`,
          clicks: sql`EXCLUDED.clicks`,
          ctr: sql`EXCLUDED.ctr`,
          amount: sql`EXCLUDED.amount`,
          orderCount: sql`EXCLUDED.order_count`,
        },
      });
    }

    for (const chunk of chunkArray(searchPositionRows, 500)) {
      await tx.insert(procifrySearchPositions).values(chunk);
    }
  });

  console.log(
    `[search-positions-backfill] saved search_positions=${searchPositionRows.length} ` +
    `raw_clusters=${rawClusterRows.length} raw_stats=${rawStats.length}`,
  );
}

main().catch((error) => {
  console.error('[search-positions-backfill] failed', error);
  process.exit(1);
});
