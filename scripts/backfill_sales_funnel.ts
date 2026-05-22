import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

type Options = { from: string; to: string; tenantId: string };

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
  const tenantId = args.get('tenant-id');
  if (!from || !to || !tenantId) {
    throw new Error('Usage: npx tsx scripts/backfill_sales_funnel.ts --tenant-id UUID --from YYYY-MM-DD --to YYYY-MM-DD');
  }
  return { from, to, tenantId };
}

// Бьём диапазон по календарным месяцам: WB sales-funnel требует prevPeriod той же
// длины и стабильнее отдаёт помесячные окна.
function monthlyWindows(from: string, to: string): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  let cursor = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const start = monthStart < new Date(`${from}T00:00:00.000Z`) ? new Date(`${from}T00:00:00.000Z`) : monthStart;
    const stop = monthEnd > end ? end : monthEnd;
    windows.push({ start: start.toISOString().slice(0, 10), end: stop.toISOString().slice(0, 10) });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return windows;
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const { syncSalesFunnelDaily } = await import('@/server/wb/lk-sales-funnel');

  let totalFetched = 0;
  let totalSaved = 0;
  let grandViews = 0;
  for (const window of monthlyWindows(options.from, options.to)) {
    try {
      const r = await syncSalesFunnelDaily(options.tenantId, window);
      totalFetched += r.fetched;
      totalSaved += r.saved;
      grandViews += r.totalViews;
      console.log(`[sales-funnel] ${window.start}..${window.end} fetched=${r.fetched} saved=${r.saved} views=${r.totalViews}`);
    } catch (error) {
      console.warn(`[sales-funnel] ${window.start}..${window.end} FAILED:`, error instanceof Error ? error.message : error);
    }
  }
  console.log(`[sales-funnel] DONE tenant=${options.tenantId} fetched=${totalFetched} saved=${totalSaved} totalViews=${grandViews}`);
}

main().catch((error) => {
  console.error('[sales-funnel] fatal', error);
  process.exit(1);
});
