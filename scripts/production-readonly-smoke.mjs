#!/usr/bin/env node

import process from 'node:process';
import { chromium } from 'playwright';

const baseUrl = (process.env.SMOKE_BASE_URL ?? 'https://xn----ptbqdfd1ao2c.xn--p1ai').replace(/\/$/, '');

const publicRoutes = [
  '/',
  '/login',
  '/signup',
  '/reset-password',
];

const protectedRoutes = [
  '/settings',
  '/overview',
  '/economics-v2',
  '/aosn',
  '/finance',
  '/stocks-v2',
  '/admin',
];

function log(message) {
  console.log(`[smoke:production:readonly] ${message}`);
}

async function main() {
  const failures = [];
  const results = [];
  const browser = await chromium.launch({
    headless: process.env.SMOKE_HEADLESS !== '0',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  try {
    for (const route of publicRoutes) {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });
      const status = response?.status() ?? 0;
      const finalPath = new URL(page.url()).pathname;
      const textLen = ((await page.locator('body').textContent().catch(() => '')) ?? '').trim().length;
      const ok = status >= 200 && status < 400 && textLen > 20;

      results.push({ route, kind: 'public', status, finalPath, textLen, ok });
      if (!ok) {
        failures.push(`public ${route}: status=${status}, finalPath=${finalPath}, textLen=${textLen}`);
      }
    }

    for (const route of protectedRoutes) {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });
      const status = response?.status() ?? 0;
      const finalPath = new URL(page.url()).pathname;
      const ok = finalPath === '/login' && status >= 200 && status < 400;

      results.push({ route, kind: 'protected', status, finalPath, ok });
      if (!ok) {
        failures.push(`protected ${route}: status=${status}, finalPath=${finalPath}`);
      }
    }

    const api = await context.request.get(`${baseUrl}/api/health`, { timeout: 15_000 });
    const healthText = await api.text();
    let health;
    try {
      health = JSON.parse(healthText);
    } catch {
      health = null;
    }

    const healthOk = api.status() === 200
      && health?.ok === true
      && Object.values(health?.checks ?? {}).every((value) => value === 'ok');

    results.push({
      route: '/api/health',
      kind: 'api',
      status: api.status(),
      ok: healthOk,
      checks: health?.checks,
    });

    if (!healthOk) {
      failures.push(`/api/health: status=${api.status()}, body=${healthText.slice(0, 200)}`);
    }

    if (pageErrors.length > 0) {
      failures.push(`page errors: ${pageErrors.join(' | ')}`);
    }

    console.log(JSON.stringify({ baseUrl, results, pageErrors }, null, 2));

    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }

    log('passed');
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

await main().catch((error) => {
  console.error(`[smoke:production:readonly] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
