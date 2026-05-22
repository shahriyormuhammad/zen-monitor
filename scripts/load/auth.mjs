import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';
import { readBoolEnv, readIntEnv } from './utils.mjs';

function domainMatches(cookieDomain, hostname) {
  const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

export function buildCookieHeader(storageState, baseUrl) {
  if (process.env.LOAD_COOKIE?.trim()) {
    return process.env.LOAD_COOKIE.trim();
  }

  const hostname = new URL(baseUrl).hostname;
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
  return cookies
    .filter((cookie) => cookie?.name && domainMatches(cookie.domain ?? hostname, hostname))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function hasActiveTenantCookie(storageState) {
  return (storageState?.cookies ?? []).some((cookie) => cookie.name === 'active_tenant_id');
}

async function loadStorageStateFromFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function loginWithPlaywright({ baseUrl, email, password, headless, timeoutMs, logPrefix }) {
  if (!email || !password) {
    throw new Error('LOAD_EMAIL and LOAD_PASSWORD are required unless LOAD_COOKIE or LOAD_STORAGE_STATE is provided');
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1024 },
  });
  const page = await context.newPage();

  try {
    console.log(`${logPrefix} authenticating ${email} at ${baseUrl}`);
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.getByTestId('login-email').fill(email, { timeout: timeoutMs });
    await page.getByTestId('login-password').fill(password, { timeout: timeoutMs });

    await Promise.all([
      page.waitForURL((url) => new URL(url).pathname !== '/login', { timeout: timeoutMs }),
      page.getByTestId('login-submit').click({ timeout: timeoutMs }),
    ]);

    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
    const currentPath = new URL(page.url()).pathname;
    if (currentPath === '/login') {
      const message = await page.getByTestId('login-message').textContent().catch(() => null);
      throw new Error(message?.trim() || 'Login stayed on /login');
    }

    // Touch a dashboard route so the server action path has a chance to sync
    // active_tenant_id for API requests that rely on the HttpOnly cookie.
    await page.goto(`${baseUrl}/overview`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);

    const storageState = await context.storageState();
    if (!hasActiveTenantCookie(storageState)) {
      console.warn(`${logPrefix} warning: active_tenant_id cookie is absent; API routes may return 400/403`);
    }
    return storageState;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function resolveStorageState({
  baseUrl,
  email = process.env.LOAD_EMAIL,
  password = process.env.LOAD_PASSWORD,
  storageStatePath = process.env.LOAD_STORAGE_STATE,
  headless = !readBoolEnv('LOAD_HEADLESS', false),
  timeoutMs = readIntEnv('LOAD_AUTH_TIMEOUT_MS', 30_000, { min: 5_000, max: 120_000 }),
  logPrefix = '[load]',
} = {}) {
  if (process.env.LOAD_COOKIE?.trim()) {
    return { cookies: [] };
  }

  if (storageStatePath?.trim()) {
    return loadStorageStateFromFile(storageStatePath.trim());
  }

  return loginWithPlaywright({
    baseUrl,
    email,
    password,
    headless,
    timeoutMs,
    logPrefix,
  });
}
