import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import Papa from 'papaparse';
import { and, eq, gte, lte } from 'drizzle-orm';

type Report = 'search_positions_summary' | 'competitor_cards_summary' | 'ab_tests_summary';

type Options = {
  report: Report;
  file: string;
  tenantId: string;
  cabinetOid: string;
  source: string;
  sourceUpdatedAt: Date;
  confidence: 'confirmed' | 'partial' | 'stale' | 'missing';
  replaceRange: boolean;
};

type RawRow = Record<string, unknown>;

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

  const reportRaw = args.get('report');
  const report = reportRaw === 'search_positions_summary'
    || reportRaw === 'competitor_cards_summary'
    || reportRaw === 'ab_tests_summary'
    ? reportRaw
    : null;
  const file = args.get('file');
  const tenantId = args.get('tenant-id');
  const cabinetOid = args.get('cabinet-oid');
  const source = args.get('source') ?? 'manual_import';
  const sourceUpdatedAtRaw = args.get('source-updated-at') ?? new Date().toISOString();
  const sourceUpdatedAt = new Date(sourceUpdatedAtRaw);
  const confidenceRaw = args.get('confidence') ?? 'confirmed';
  const confidence = confidenceRaw === 'confirmed'
    || confidenceRaw === 'partial'
    || confidenceRaw === 'stale'
    || confidenceRaw === 'missing'
    ? confidenceRaw
    : null;
  const replaceRangeRaw = args.get('replace-range') ?? '1';
  const replaceRange = replaceRangeRaw === '1' || replaceRangeRaw.toLowerCase() === 'true';

  if (!report || !file || !tenantId || !cabinetOid || !confidence || Number.isNaN(sourceUpdatedAt.getTime())) {
    throw new Error(
      'Usage: npx tsx scripts/import_procifry_external_feeds.ts --report search_positions_summary|competitor_cards_summary|ab_tests_summary --file data.csv|data.json --tenant-id UUID --cabinet-oid OID [--source mpstats] [--source-updated-at ISO] [--confidence confirmed|partial|stale|missing] [--replace-range 1]',
    );
  }

  return { report, file, tenantId, cabinetOid, source, sourceUpdatedAt, confidence, replaceRange };
}

function readRows(filePath: string): RawRow[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is RawRow => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
      return ((parsed as { items: unknown[] }).items)
        .filter((item): item is RawRow => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
    }
    throw new Error('JSON input must be an array or object with items[]');
  }

  const parsed = Papa.parse<RawRow>(raw, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse failed: ${parsed.errors[0]?.message}`);
  }
  return parsed.data;
}

function value(row: RawRow, aliases: string[]) {
  for (const alias of aliases) {
    const direct = row[alias];
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
      return direct;
    }
  }
  const normalized = new Map(
    Object.entries(row).map(([key, entry]) => [key.toLowerCase().replace(/[\s_-]/g, ''), entry]),
  );
  for (const alias of aliases) {
    const entry = normalized.get(alias.toLowerCase().replace(/[\s_-]/g, ''));
    if (entry !== undefined && entry !== null && String(entry).trim() !== '') {
      return entry;
    }
  }
  return null;
}

function textValue(row: RawRow, aliases: string[], fallback: string | null = null) {
  const raw = value(row, aliases);
  return raw === null ? fallback : String(raw).trim();
}

function numberValue(row: RawRow, aliases: string[]) {
  const raw = value(row, aliases);
  if (raw === null) return null;
  const numeric = Number(String(raw).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function intValue(row: RawRow, aliases: string[]) {
  const numeric = numberValue(row, aliases);
  return numeric === null ? null : Math.trunc(numeric);
}

function dateValue(row: RawRow, aliases: string[]) {
  const raw = textValue(row, aliases);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const compact = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(compact)) return compact;
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function arrayValue(row: RawRow, aliases: string[]) {
  const raw = value(row, aliases);
  if (Array.isArray(raw)) return raw;
  if (raw === null) return [];
  const text = String(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text.split('|').map((item) => item.trim()).filter(Boolean);
  }
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function minMax(values: string[]) {
  const sorted = [...values].sort();
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const inputRows = readRows(path.resolve(options.file));
  const [{ db, withTenantContext }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
  ]);
  const {
    procifrySearchPositions,
    procifryCompetitorCards,
    procifryAbTests,
  } = schema;

  if (inputRows.length === 0) {
    throw new Error('Input file has no rows');
  }

  let inserted = 0;
  if (options.report === 'search_positions_summary') {
    const rows = inputRows.map((row, index) => {
      const observedDate = dateValue(row, ['date', 'observedDate', 'observed_date']);
      const keyword = textValue(row, ['keyword', 'key', 'query']);
      const nmId = intValue(row, ['nmId', 'nm_id', 'nmid']);
      if (!observedDate || !keyword || !nmId) {
        throw new Error(`search row ${index + 1}: required date, keyword, nmId`);
      }
      return {
        tenantId: options.tenantId,
        cabinetOid: options.cabinetOid,
        observedDate,
        keyword,
        nmId,
        position: intValue(row, ['position', 'pos']),
        frequency: intValue(row, ['frequency', 'freq']),
        impressions: intValue(row, ['impressions', 'views']),
        organicOrAd: textValue(row, ['organicOrAd', 'organic_or_ad', 'placement']),
        source: textValue(row, ['source'], options.source) ?? options.source,
        sourceUpdatedAt: options.sourceUpdatedAt,
        confidence: textValue(row, ['confidence'], options.confidence) ?? options.confidence,
        payload: row,
      };
    });
    const range = minMax(rows.map((row) => row.observedDate));
    await withTenantContext(db, options.tenantId, async (tx) => {
      if (options.replaceRange) {
        await tx.delete(procifrySearchPositions).where(and(
          eq(procifrySearchPositions.tenantId, options.tenantId),
          eq(procifrySearchPositions.cabinetOid, options.cabinetOid),
          gte(procifrySearchPositions.observedDate, range.min),
          lte(procifrySearchPositions.observedDate, range.max),
        ));
      }
      for (const chunk of chunkArray(rows, 500)) {
        await tx.insert(procifrySearchPositions).values(chunk);
        inserted += chunk.length;
      }
    });
  }

  if (options.report === 'competitor_cards_summary') {
    const rows = inputRows.map((row, index) => {
      const observedDate = dateValue(row, ['date', 'observedDate', 'observed_date']);
      const competitorNmId = intValue(row, ['competitorNmId', 'competitor_nm_id', 'competitor']);
      if (!observedDate || !competitorNmId) {
        throw new Error(`competitor row ${index + 1}: required date, competitorNmId`);
      }
      return {
        tenantId: options.tenantId,
        cabinetOid: options.cabinetOid,
        observedDate,
        ourNmId: intValue(row, ['ourNmId', 'our_nm_id', 'nmId', 'nm_id']),
        competitorNmId,
        keyword: textValue(row, ['keyword', 'query']),
        subject: textValue(row, ['subject', 'category']),
        title: textValue(row, ['title', 'name']),
        brand: textValue(row, ['brand']),
        price: numberValue(row, ['price'])?.toString() ?? null,
        rating: numberValue(row, ['rating'])?.toString() ?? null,
        reviewsCount: intValue(row, ['reviewsCount', 'reviews', 'feedbacks']),
        ordersCount: intValue(row, ['ordersCount', 'orders', 'sales']),
        revenue: numberValue(row, ['revenue', 'salesRub'])?.toString() ?? null,
        stockQty: intValue(row, ['stockQty', 'stocks', 'stock']),
        photos: arrayValue(row, ['photos', 'photoUrls']),
        videos: arrayValue(row, ['videos', 'videoUrls']),
        positions: arrayValue(row, ['positions']),
        source: textValue(row, ['source'], options.source) ?? options.source,
        sourceUpdatedAt: options.sourceUpdatedAt,
        confidence: textValue(row, ['confidence'], options.confidence) ?? options.confidence,
        payload: row,
      };
    });
    const range = minMax(rows.map((row) => row.observedDate));
    await withTenantContext(db, options.tenantId, async (tx) => {
      if (options.replaceRange) {
        await tx.delete(procifryCompetitorCards).where(and(
          eq(procifryCompetitorCards.tenantId, options.tenantId),
          eq(procifryCompetitorCards.cabinetOid, options.cabinetOid),
          gte(procifryCompetitorCards.observedDate, range.min),
          lte(procifryCompetitorCards.observedDate, range.max),
        ));
      }
      for (const chunk of chunkArray(rows, 500)) {
        await tx.insert(procifryCompetitorCards).values(chunk);
        inserted += chunk.length;
      }
    });
  }

  if (options.report === 'ab_tests_summary') {
    const rows = inputRows.map((row, index) => {
      const testId = textValue(row, ['testId', 'test_id', 'id']);
      const nmId = intValue(row, ['nmId', 'nm_id', 'nmid']);
      const variant = textValue(row, ['variant', 'variantName']);
      const periodFrom = dateValue(row, ['periodFrom', 'period_from', 'dateFrom', 'from']);
      const periodTo = dateValue(row, ['periodTo', 'period_to', 'dateTo', 'to']);
      if (!testId || !nmId || !variant || !periodFrom || !periodTo) {
        throw new Error(`ab test row ${index + 1}: required testId, nmId, variant, periodFrom, periodTo`);
      }
      return {
        tenantId: options.tenantId,
        cabinetOid: options.cabinetOid,
        testId,
        nmId,
        variant,
        periodFrom,
        periodTo,
        impressions: intValue(row, ['impressions', 'views']) ?? 0,
        clicks: intValue(row, ['clicks']) ?? 0,
        ctr: numberValue(row, ['ctr'])?.toString() ?? null,
        carts: intValue(row, ['carts', 'baskets']) ?? 0,
        orders: intValue(row, ['orders']) ?? 0,
        revenue: numberValue(row, ['revenue', 'ordersSum'])?.toString() ?? null,
        profit: numberValue(row, ['profit'])?.toString() ?? null,
        significance: numberValue(row, ['significance', 'pValue'])?.toString() ?? null,
        status: textValue(row, ['status'], 'unknown') ?? 'unknown',
        source: textValue(row, ['source'], options.source) ?? options.source,
        sourceUpdatedAt: options.sourceUpdatedAt,
        confidence: textValue(row, ['confidence'], options.confidence) ?? options.confidence,
        payload: row,
      };
    });
    const range = minMax(rows.flatMap((row) => [row.periodFrom, row.periodTo]));
    await withTenantContext(db, options.tenantId, async (tx) => {
      if (options.replaceRange) {
        await tx.delete(procifryAbTests).where(and(
          eq(procifryAbTests.tenantId, options.tenantId),
          eq(procifryAbTests.cabinetOid, options.cabinetOid),
          lte(procifryAbTests.periodFrom, range.max),
          gte(procifryAbTests.periodTo, range.min),
        ));
      }
      for (const chunk of chunkArray(rows, 500)) {
        await tx.insert(procifryAbTests).values(chunk);
        inserted += chunk.length;
      }
    });
  }

  console.log(`[procifry-feed-import] report=${options.report} rows=${inserted} source=${options.source}`);
}

main().catch((error) => {
  console.error('[procifry-feed-import] failed', error);
  process.exit(1);
});
