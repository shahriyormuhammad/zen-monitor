/**
 * Тест: работает ли WB seller API через чистый Node fetch (без Playwright).
 *
 * Загружает cookies из сохранённого storageState тенанта, отправляет
 * POST /ns/suppliers-auth/suppliers-portal-core/auth/token напрямую.
 * Если получаем JWT в ответе — значит HTTP-клиент возможен без Playwright.
 *
 *   npx tsx scripts/test-wb-fetch.ts --tenant-id <UUID>
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decrypt } from '@/lib/encryption';

function loadEnv() {
  const cwd = process.cwd();
  for (const rel of ['.env.runtime', '.env.production', '.env']) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
  }
}

type StorageStateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
};

type StorageState = {
  cookies: StorageStateCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
};

function buildCookieHeader(cookies: StorageStateCookie[], _targetUrl: string): string {
  // Серверу всё равно с какого домена cookie — матчинг это для browser security.
  // Отправляем ВСЕ cookies; если есть дубли по name — берём последний (как браузер).
  const map = new Map<string, string>();
  for (const c of cookies) map.set(c.name, c.value);
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function loadCookies(tenantId: string): Promise<StorageStateCookie[]> {
  const [row] = await db.select({ storage: tenants.wbLkStorageState }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row?.storage) throw new Error(`No storageState for ${tenantId}`);
  const ss = JSON.parse(decrypt(row.storage)) as StorageState;
  return ss.cookies;
}

async function testAuthToken(cookies: StorageStateCookie[]): Promise<void> {
  const url = 'https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token';
  const cookieHeader = buildCookieHeader(cookies, url);
  console.log(`\n→ POST ${url}`);
  console.log(`  Cookies: ${cookieHeader.split('; ').map((c) => c.split('=')[0]).join(', ')}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'accept-language': 'ru-RU',
      'cookie': cookieHeader,
      'origin': 'https://seller.wildberries.ru',
      'referer': 'https://seller.wildberries.ru/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ params: {}, jsonrpc: '2.0', id: 'json-rpc_1' }),
  });

  console.log(`  Status: ${res.status}`);
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length) {
    console.log('  Set-Cookie:');
    for (const sc of setCookies) console.log('    ' + sc.split(';')[0]);
  }
  const text = await res.text();
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch { /* not json */ }
  console.log('  Body:', pretty.slice(0, 800));

  // Decode JWT if present
  try {
    const parsed = JSON.parse(text);
    const jwt = parsed?.result?.data?.token;
    if (jwt) {
      const [, payload] = jwt.split('.');
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
      console.log('  JWT payload:', JSON.stringify(decoded, null, 2));
      const ttlSec = decoded.exp - decoded.iat;
      console.log(`  JWT TTL: ${ttlSec}s (${(ttlSec / 60).toFixed(1)} min)`);
    }
  } catch { /* skip */ }
}

async function testBalances(cookies: StorageStateCookie[]): Promise<void> {
  // Probe a real read-only endpoint — balances list.
  const url = 'https://seller-weekly-report.wildberries.ru/ns/balances/analytics-back/api/v2/balances?limit=10&offset=0&total=0';
  const cookieHeader = buildCookieHeader(cookies, url);
  console.log(`\n→ POST ${url}`);
  console.log(`  Cookies: ${cookieHeader.split('; ').map((c) => c.split('=')[0]).join(', ')}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'accept-language': 'ru-RU',
      'cookie': cookieHeader,
      'origin': 'https://seller.wildberries.ru',
      'referer': 'https://seller.wildberries.ru/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      groups: ['brand', 'subject'],
      filters: { brands: [], subjects: [], warehouses: [], kiz: 0, dimension: 0 },
    }),
  });
  console.log(`  Status: ${res.status}`);
  const text = await res.text();
  console.log('  Body (first 600):', text.slice(0, 600));
}

async function testViaPlaywright(tenantId: string): Promise<void> {
  // Альтернатива: использовать Playwright APIRequestContext, который шарит
  // cookie store с Chromium и использует Chromium TLS fingerprint. Это
  // обходит возможный Cloudflare-блок на не-браузерные TLS handshakes.
  const { chromium } = await import('playwright');
  const [row] = await db.select({ storage: tenants.wbLkStorageState }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row?.storage) throw new Error('no storage');
  const tmpPath = path.join(process.cwd(), 'tmp', `pw-state-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, decrypt(row.storage), { mode: 0o600 });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    storageState: tmpPath,
    locale: 'ru-RU',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  // ВАЖНО: сначала navigate на seller.wildberries.ru, чтобы JS обновил
  // sec-cookies (cfidsw-wb через sec/api/fl). Без этого WB возвращает 401.
  console.log(`\n[Playwright] Navigate seller.wildberries.ru/ для обновления sec-cookies...`);
  const page = await context.newPage();
  await page.goto('https://seller.wildberries.ru/analytics-reports/warehouse-remains', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  const freshCookies = await context.cookies();
  console.log(`  Cookies after navigate: ${freshCookies.length}`);
  console.log(`  cfidsw-wb values:`, freshCookies.filter(c => c.name === 'cfidsw-wb').map(c => `${c.value.slice(0, 20)}...@${c.domain}`).join(', '));

  console.log(`\n[Playwright APIRequestContext] POST seller.wildberries.ru/.../auth/token (после navigate)`);
  const tokenRes = await context.request.post(
    'https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token',
    {
      headers: { 'content-type': 'application/json', 'origin': 'https://seller.wildberries.ru', 'referer': 'https://seller.wildberries.ru/' },
      data: { params: {}, jsonrpc: '2.0', id: 'json-rpc_pw1' },
    },
  );
  console.log(`  Status: ${tokenRes.status()}`);
  const tokenText = await tokenRes.text();
  console.log('  Body:', tokenText.slice(0, 800));
  try {
    const json = JSON.parse(tokenText);
    const jwt = json?.result?.data?.token;
    if (jwt) {
      const [, payload] = jwt.split('.');
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
      console.log('  JWT payload:', JSON.stringify(decoded));
      console.log(`  TTL: ${decoded.exp - decoded.iat}s`);
    }
  } catch { /* skip */ }

  console.log(`\n[Playwright APIRequestContext] POST seller-weekly-report/.../balances`);
  const balRes = await context.request.post(
    'https://seller-weekly-report.wildberries.ru/ns/balances/analytics-back/api/v2/balances?limit=10&offset=0&total=0',
    {
      headers: { 'content-type': 'application/json', 'origin': 'https://seller.wildberries.ru', 'referer': 'https://seller.wildberries.ru/' },
      data: { groups: ['brand', 'subject'], filters: { brands: [], subjects: [], warehouses: [], kiz: 0, dimension: 0 } },
    },
  );
  console.log(`  Status: ${balRes.status()}`);
  const balText = await balRes.text();
  console.log('  Body (first 500):', balText.slice(0, 500));

  // Тест 4: page.evaluate(window.fetch) — точно как делает фронт WB.
  console.log(`\n[Playwright page.evaluate window.fetch] POST auth/token`);
  const evalAuthRes = await page.evaluate(async () => {
    const res = await fetch('https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: {}, jsonrpc: '2.0', id: 'json-rpc_eval1' }),
    });
    return { status: res.status, body: await res.text() };
  });
  console.log(`  Status: ${evalAuthRes.status}`);
  console.log('  Body:', evalAuthRes.body.slice(0, 600));

  console.log(`\n[Playwright page.evaluate window.fetch] POST balances`);
  const evalBalRes = await page.evaluate(async () => {
    const res = await fetch('https://seller-weekly-report.wildberries.ru/ns/balances/analytics-back/api/v2/balances?limit=10&offset=0&total=0', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups: ['brand', 'subject'], filters: { brands: [], subjects: [], warehouses: [], kiz: 0, dimension: 0 } }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 500) };
  });
  console.log(`  Status: ${evalBalRes.status}`);
  console.log('  Body (first 500):', evalBalRes.body);

  await browser.close();
  fs.unlinkSync(tmpPath);
}

async function main(): Promise<void> {
  loadEnv();
  const tenantId = process.argv.find((a, i) => process.argv[i - 1] === '--tenant-id');
  if (!tenantId) throw new Error('Usage: npx tsx scripts/test-wb-fetch.ts --tenant-id <UUID>');

  const cookies = await loadCookies(tenantId);
  console.log(`Loaded ${cookies.length} cookies`);
  console.log('Cookie names@domain:', cookies.map((c) => `${c.name}@${c.domain}`).join('\n  '));

  console.log('\n========== PURE NODE FETCH ==========');
  await testAuthToken(cookies);
  await testBalances(cookies);

  console.log('\n========== PLAYWRIGHT APIRequestContext ==========');
  await testViaPlaywright(tenantId);

  process.exit(0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
