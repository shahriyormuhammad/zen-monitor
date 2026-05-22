import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

type Options = { from: string; to: string; tenantId: string; delayMs: number };

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
  const delayMs = Number(args.get('delay-ms') ?? '1200');
  if (!from || !to || !tenantId) {
    throw new Error('Usage: npx tsx scripts/backfill_sales_funnel_nm.ts --tenant-id UUID --from YYYY-MM-DD --to YYYY-MM-DD [--delay-ms 1200]');
  }
  return { from, to, tenantId, delayMs: Number.isFinite(delayMs) ? delayMs : 1200 };
}

// WB per-nm воронку отдаёт только за период — поэтому per-nm дневную детализацию
// собираем по одному дню за запрос. Идём по календарным дням [from..to].
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const end = new Date(`${to}T00:00:00.000Z`);
  let cursor = new Date(`${from}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const { syncSalesFunnelNmDaily } = await import('@/server/wb/lk-sales-funnel');

  const days = eachDay(options.from, options.to);
  let totalNms = 0;
  let totalSaved = 0;
  let grandViews = 0;
  console.log(`[sales-funnel-nm] tenant=${options.tenantId} days=${days.length} delay=${options.delayMs}ms`);
  for (const day of days) {
    try {
      const r = await syncSalesFunnelNmDaily(options.tenantId, day);
      totalNms += r.nms;
      totalSaved += r.saved;
      grandViews += r.totalViews;
      console.log(`[sales-funnel-nm] ${day} nms=${r.nms} saved=${r.saved} views=${r.totalViews}`);
    } catch (error) {
      console.warn(`[sales-funnel-nm] ${day} FAILED:`, error instanceof Error ? error.message : error);
    }
    await sleep(options.delayMs);
  }
  console.log(`[sales-funnel-nm] DONE tenant=${options.tenantId} rowsSaved=${totalSaved} totalViews=${grandViews}`);
}

main().catch((error) => {
  console.error('[sales-funnel-nm] fatal', error);
  process.exit(1);
});
