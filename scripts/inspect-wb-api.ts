/**
 * Research-скрипт для reverse engineering WB Seller API.
 *
 * Запускает Chromium с сохранённым storageState тенанта, открывает
 * страницу перераспределения остатков и логирует ВСЕ XHR/fetch запросы
 * (метод, URL, headers, body, status, response). Результат пишется в
 * `tmp/wb-api-capture-<timestamp>.json`.
 *
 * Использование:
 *   npx tsx scripts/inspect-wb-api.ts --tenant-id <UUID> [--url <URL>] [--wait 30]
 *
 * Хосты которые особо интересны (для редистрибуции):
 *   - seller.wildberries.ru             (auth/token, validate, suppliers)
 *   - seller-weekly-report.wildberries.ru (analytics-back: nms, stocks, quota, balances)
 *   - seller-services.wildberries.ru    (sec/api/fl — anti-fingerprint)
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';
import { chromium, type Request, type Response } from 'playwright';

type Options = {
  tenantId: string;
  url: string;
  waitSeconds: number;
};

function loadEnv() {
  const cwd = process.cwd();
  for (const rel of ['.env.runtime', '.env.production', '.env']) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
  }
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args.set(key, value);
    i += 1;
  }
  const tenantId = args.get('tenant-id');
  if (!tenantId) {
    throw new Error('Usage: npx tsx scripts/inspect-wb-api.ts --tenant-id <UUID> [--url <URL>] [--wait 30]');
  }
  return {
    tenantId,
    url: args.get('url') ?? 'https://seller.wildberries.ru/analytics-reports/warehouse-remains',
    waitSeconds: Number.parseInt(args.get('wait') ?? '30', 10),
  };
}

const INTERESTING_HOSTS = [
  'seller.wildberries.ru',
  'seller-weekly-report.wildberries.ru',
  'seller-services.wildberries.ru',
  'seller-communications.wildberries.ru',
  'seller-callcenter.wildberries.ru',
  'seller-chat.wildberries.ru',
];

const SKIP_HOSTS = [
  'static-basket-',
  'wbbasket.ru/vol',
  'a.wb.ru/e/',
  'marketplace-sentry.wb.ru',
  'splitter.wb.ru',
  'cdn.wbbasket.ru',
];

function isInteresting(url: string): boolean {
  if (SKIP_HOSTS.some((s) => url.includes(s))) return false;
  return INTERESTING_HOSTS.some((h) => url.includes(h));
}

type CaptureEntry = {
  ts: string;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  requestPostData: string | null;
  status: number | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  responseError: string | null;
  durationMs: number | null;
};

async function captureResponseBody(response: Response): Promise<{ body: string | null; error: string | null }> {
  try {
    const ct = response.headers()['content-type'] ?? '';
    const isText = /json|text|xml|javascript|x-www-form-urlencoded/i.test(ct);
    if (!isText) return { body: `<binary, content-type=${ct}>`, error: null };
    const buf = await response.body();
    if (buf.length > 50_000) return { body: buf.toString('utf-8').slice(0, 50_000) + '\n...[truncated]', error: null };
    return { body: buf.toString('utf-8'), error: null };
  } catch (err) {
    return { body: null, error: (err as Error).message };
  }
}

async function loadStorageStateFile(tenantId: string): Promise<string> {
  const { db } = await import('@/lib/db');
  const { tenants } = await import('@/lib/db/schema');
  const { decrypt } = await import('@/lib/encryption');
  const [row] = await db
    .select({ storage: tenants.wbLkStorageState })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row?.storage) throw new Error(`No wbLkStorageState for tenant ${tenantId}`);
  const decrypted = decrypt(row.storage);
  const tmpPath = path.join(process.cwd(), 'tmp', `inspect-storage-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, decrypted, { mode: 0o600 });
  return tmpPath;
}

async function main(): Promise<void> {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  console.log(`[inspect-wb-api] tenant=${opts.tenantId} url=${opts.url} wait=${opts.waitSeconds}s`);

  const storageStatePath = await loadStorageStateFile(opts.tenantId);
  console.log(`[inspect-wb-api] storageState → ${storageStatePath}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    storageState: storageStatePath,
    locale: 'ru-RU',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  const entries: CaptureEntry[] = [];
  const inFlight = new Map<Request, number>();

  page.on('request', (req) => {
    if (!isInteresting(req.url())) return;
    inFlight.set(req, Date.now());
  });
  page.on('response', async (res) => {
    const req = res.request();
    if (!isInteresting(req.url())) return;
    const startedAt = inFlight.get(req);
    inFlight.delete(req);
    const { body, error } = await captureResponseBody(res);
    entries.push({
      ts: new Date().toISOString(),
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      requestHeaders: req.headers(),
      requestPostData: req.postData(),
      status: res.status(),
      responseHeaders: res.headers(),
      responseBody: body,
      responseError: error,
      durationMs: startedAt ? Date.now() - startedAt : null,
    });
  });
  page.on('requestfailed', (req) => {
    if (!isInteresting(req.url())) return;
    entries.push({
      ts: new Date().toISOString(),
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      requestHeaders: req.headers(),
      requestPostData: req.postData(),
      status: null,
      responseHeaders: {},
      responseBody: null,
      responseError: req.failure()?.errorText ?? 'failed',
      durationMs: null,
    });
  });

  console.log(`[inspect-wb-api] navigate → ${opts.url}`);
  try {
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  } catch (err) {
    console.warn(`[inspect-wb-api] navigation: ${(err as Error).message}`);
  }
  console.log(`[inspect-wb-api] waiting ${opts.waitSeconds}s for late XHRs…`);
  await page.waitForTimeout(opts.waitSeconds * 1000);

  const outDir = path.join(process.cwd(), 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `wb-api-capture-${Date.now()}.json`);
  const summary = {
    capturedAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    url: opts.url,
    finalUrl: page.url(),
    entries: entries.length,
    distinctEndpoints: Array.from(new Set(entries.map((e) => e.method + ' ' + new URL(e.url).origin + new URL(e.url).pathname))).sort(),
    items: entries,
  };
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`[inspect-wb-api] ${entries.length} entries → ${outPath}`);
  console.log(`[inspect-wb-api] distinct endpoints: ${summary.distinctEndpoints.length}`);
  for (const ep of summary.distinctEndpoints) console.log('  ' + ep);

  await browser.close();
  fs.unlinkSync(storageStatePath);
  process.exit(0);
}

main().catch((err) => {
  console.error('[inspect-wb-api] fatal:', err);
  process.exit(1);
});
