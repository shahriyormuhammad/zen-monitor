import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';

type Options = {
  tenantId: string;
  cabinetOid: string;
  from: string;
  to: string;
  observedDate: string;
  limitKeywords: number;
  limitCompetitors: number;
  replaceRange: boolean;
};

type SeedKeyword = {
  keyword: string;
  ourNmId: number;
  bestPosition: number | null;
};

type WbSearchProduct = {
  id?: number;
  name?: string;
  brand?: string;
  subjectId?: number;
  subjectParentId?: number;
  salePriceU?: number;
  priceU?: number;
  salePrice?: number;
  reviewRating?: number;
  rating?: number;
  feedbacks?: number;
  totalQuantity?: number;
  sizes?: Array<{
    price?: { product?: number; basic?: number };
    stocks?: Array<{ qty?: number }>;
  }>;
  [key: string]: unknown;
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
  const observedDate = args.get('observed-date') ?? new Date().toISOString().slice(0, 10);
  const limitKeywords = Math.min(200, Math.max(1, Number.parseInt(args.get('limit-keywords') ?? '40', 10) || 40));
  const limitCompetitors = Math.min(30, Math.max(1, Number.parseInt(args.get('limit-competitors') ?? '10', 10) || 10));
  const replaceRaw = args.get('replace-range') ?? '1';

  if (!tenantId || !cabinetOid || !from || !to) {
    throw new Error(
      'Usage: npx tsx scripts/backfill_wb_competitor_cards.ts --tenant-id UUID --cabinet-oid lavrov-main|berbeka-main --from YYYY-MM-DD --to YYYY-MM-DD [--observed-date YYYY-MM-DD] [--limit-keywords 40] [--limit-competitors 10] [--replace-range 1]',
    );
  }

  return {
    tenantId,
    cabinetOid,
    from,
    to,
    observedDate,
    limitKeywords,
    limitCompetitors,
    replaceRange: replaceRaw === '1' || replaceRaw.toLowerCase() === 'true',
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function productPrice(product: WbSearchProduct) {
  const raw = product.salePriceU
    ?? product.salePrice
    ?? product.priceU
    ?? product.sizes?.find((size) => Number(size.price?.product ?? 0) > 0)?.price?.product
    ?? product.sizes?.find((size) => Number(size.price?.basic ?? 0) > 0)?.price?.basic;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 10_000 ? numeric / 100 : numeric;
}

function productStock(product: WbSearchProduct) {
  if (Number.isFinite(Number(product.totalQuantity))) {
    return Math.max(0, Math.trunc(Number(product.totalQuantity)));
  }
  return (product.sizes ?? []).reduce((total, size) => (
    total + (size.stocks ?? []).reduce((sum, stock) => sum + Math.max(0, Math.trunc(Number(stock.qty ?? 0))), 0)
  ), 0);
}

async function fetchWbSearch(keyword: string): Promise<WbSearchProduct[]> {
  const url = new URL('https://search.wb.ru/exactmatch/ru/common/v18/search');
  url.search = new URLSearchParams({
    ab_testing: 'false',
    appType: '1',
    curr: 'rub',
    dest: '-1257786',
    query: keyword,
    resultset: 'catalog',
    sort: 'popular',
    spp: '30',
    suppressSpellcheck: 'false',
    limit: '50',
  }).toString();

  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0 ProcifryAgent/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`WB public search HTTP ${response.status} for keyword "${keyword}"`);
  }
  const body = await response.json() as { products?: WbSearchProduct[] };
  return Array.isArray(body.products) ? body.products : [];
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const [{ db, withTenantContext }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
  ]);
  const { tenants, products, procifryCompetitorCards } = schema;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, options.tenantId)).limit(1);
  if (!tenant) {
    throw new Error(`Tenant not found: ${options.tenantId}`);
  }

  const seedRows = await withTenantContext(db, options.tenantId, (tx) => tx.execute(sql`
    WITH ranked AS (
      SELECT
        keyword,
        nm_id AS "ourNmId",
        MIN(position) FILTER (WHERE position IS NOT NULL AND position > 0)::int AS "bestPosition",
        SUM(COALESCE(impressions, 0))::int AS impressions,
        SUM(COALESCE((payload->>'clicks')::int, 0))::int AS clicks,
        SUM(COALESCE((payload->>'sum')::numeric, 0))::numeric AS spend
      FROM procifry_search_positions
      WHERE tenant_id = ${options.tenantId}
        AND cabinet_oid = ${options.cabinetOid}
        AND observed_date >= ${options.from}::date
        AND observed_date <= ${options.to}::date
      GROUP BY keyword, nm_id
    )
    SELECT keyword, "ourNmId", "bestPosition"
    FROM ranked
    WHERE keyword IS NOT NULL AND keyword <> ''
    ORDER BY spend DESC NULLS LAST, clicks DESC NULLS LAST, "bestPosition" ASC NULLS LAST, keyword ASC
    LIMIT ${options.limitKeywords}
  `)) as unknown as SeedKeyword[];

  if (seedRows.length === 0) {
    console.log('[competitor-cards-backfill] no_seed_keywords');
    return;
  }

  const ownRows = await withTenantContext(db, options.tenantId, (tx) => tx
    .select({ nmId: products.nmId })
    .from(products)
    .where(eq(products.tenantId, options.tenantId)));
  const ownNmIds = new Set(ownRows.map((row) => Number(row.nmId)).filter((value) => Number.isFinite(value)));

  console.log(
    `[competitor-cards-backfill] tenant=${tenant.id} name="${tenant.name}" ` +
    `seeds=${seedRows.length} range=${options.from}..${options.to}`,
  );

  const sourceUpdatedAt = new Date();
  const rowMap = new Map<string, typeof procifryCompetitorCards.$inferInsert>();

  for (const seed of seedRows) {
    const productsFound = await fetchWbSearch(seed.keyword);
    let position = 0;
    let addedForKeyword = 0;
    for (const product of productsFound) {
      position += 1;
      const competitorNmId = Number(product.id);
      if (!Number.isFinite(competitorNmId) || competitorNmId <= 0 || ownNmIds.has(competitorNmId)) {
        continue;
      }
      const key = `${seed.ourNmId}:${seed.keyword}:${competitorNmId}`;
      if (rowMap.has(key)) {
        continue;
      }
      const price = productPrice(product);
      const rating = Number(product.reviewRating ?? product.rating);
      const stockQty = productStock(product);
      rowMap.set(key, {
        tenantId: options.tenantId,
        cabinetOid: options.cabinetOid,
        observedDate: options.observedDate,
        ourNmId: seed.ourNmId,
        competitorNmId,
        keyword: seed.keyword,
        subject: product.subjectId ? String(product.subjectId) : product.subjectParentId ? String(product.subjectParentId) : null,
        title: product.name ?? null,
        brand: product.brand ?? null,
        price: price === null ? null : price.toFixed(2),
        rating: Number.isFinite(rating) ? rating.toFixed(2) : null,
        reviewsCount: Number.isFinite(Number(product.feedbacks)) ? Math.trunc(Number(product.feedbacks)) : null,
        ordersCount: null,
        revenue: null,
        stockQty,
        photos: [],
        videos: [],
        positions: [{ keyword: seed.keyword, position, ourPosition: seed.bestPosition }],
        source: 'wb_public_search',
        sourceUpdatedAt,
        confidence: 'partial',
        payload: {
          keyword: seed.keyword,
          searchPosition: position,
          ourNmId: seed.ourNmId,
          ourBestPosition: seed.bestPosition,
          product,
        },
      });
      addedForKeyword += 1;
      if (addedForKeyword >= options.limitCompetitors) {
        break;
      }
    }
    await sleep(250);
  }

  const rows = Array.from(rowMap.values());
  if (rows.length === 0) {
    console.log('[competitor-cards-backfill] no_competitors_found');
    return;
  }

  await withTenantContext(db, options.tenantId, async (tx) => {
    if (options.replaceRange) {
      await tx.delete(procifryCompetitorCards).where(and(
        eq(procifryCompetitorCards.tenantId, options.tenantId),
        eq(procifryCompetitorCards.cabinetOid, options.cabinetOid),
        eq(procifryCompetitorCards.observedDate, options.observedDate),
        eq(procifryCompetitorCards.source, 'wb_public_search'),
      ));
    }
    for (const chunk of chunkArray(rows, 500)) {
      await tx.insert(procifryCompetitorCards).values(chunk);
    }
  });

  console.log(`[competitor-cards-backfill] saved rows=${rows.length} source=wb_public_search observedDate=${options.observedDate}`);
}

main().catch((error) => {
  console.error('[competitor-cards-backfill] failed', error);
  process.exit(1);
});
