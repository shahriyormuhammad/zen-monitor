#!/usr/bin/env node

import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { resolveStorageState } from './auth.mjs';
import {
  jitter,
  normalizeBaseUrl,
  readBoolEnv,
  readFloatEnv,
  readIntEnv,
  sleep,
} from './utils.mjs';

const HELP = `
Browser load test for Enterprise WB Analytics.

Required:
  LOAD_EMAIL=... LOAD_PASSWORD=...
or:
  LOAD_STORAGE_STATE=output/auth.json

Common env:
  LOAD_BASE_URL=https://xn----ptbqdfd1ao2c.xn--p1ai
  BROWSER_LOAD_USERS=10
  BROWSER_LOAD_DURATION_SECONDS=180
  BROWSER_LOAD_ROUTES=/overview,/economics,/stocks-v2,/advertising
  BROWSER_LOAD_HEADLESS=1
  BROWSER_LOAD_THINK_MS=1500
  BROWSER_LOAD_TIMEOUT_MS=45000
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP.trim());
  process.exit(0);
}

const baseUrl = normalizeBaseUrl(process.env.LOAD_BASE_URL);
const users = readIntEnv('BROWSER_LOAD_USERS', 5, { min: 1, max: 300 });
const durationSeconds = readIntEnv('BROWSER_LOAD_DURATION_SECONDS', 60, { min: 1, max: 86_400 });
const rampSeconds = readIntEnv('BROWSER_LOAD_RAMP_SECONDS', Math.min(10, durationSeconds), { min: 0, max: durationSeconds });
const thinkMs = readIntEnv('BROWSER_LOAD_THINK_MS', 1_500, { min: 0, max: 60_000 });
const timeoutMs = readIntEnv('BROWSER_LOAD_TIMEOUT_MS', 45_000, { min: 5_000, max: 180_000 });
const networkIdleMs = readIntEnv('BROWSER_LOAD_NETWORK_IDLE_MS', 10_000, { min: 1_000, max: 60_000 });
const headless = readBoolEnv('BROWSER_LOAD_HEADLESS', true);
const failErrorRate = readFloatEnv('BROWSER_LOAD_FAIL_ERROR_RATE', 0.05, { min: 0, max: 1 });
const failP95Ms = readIntEnv('BROWSER_LOAD_FAIL_P95_MS', 8_000, { min: 0, max: 180_000 });
const outputRoot = process.env.LOAD_OUTPUT_DIR ?? path.join(process.cwd(), 'output', 'load');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputPath = path.join(outputRoot, `browser-load-${stamp}.json`);

function parseRoutes() {
  const raw = process.env.BROWSER_LOAD_ROUTES ?? '/overview,/economics,/stocks-v2,/advertising';
  const routes = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('/') ? item : `/${item}`));

  if (routes.length === 0) throw new Error('BROWSER_LOAD_ROUTES produced an empty route list');
  return routes;
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((percentileValue / 100) * sortedValues.length) - 1);
  return sortedValues[index];
}

async function maybeExerciseOverview(page) {
  const trigger = page.getByTestId('signal-details-trigger').first();
  if (!(await trigger.isVisible().catch(() => false))) return;

  await trigger.click({ timeout: 3_000 }).catch(() => undefined);
  const drawer = page.getByTestId('signal-details-drawer');
  if (await drawer.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByTestId('signal-details-close').click({ timeout: 3_000 }).catch(() => undefined);
  }
}

async function main() {
  const routes = parseRoutes();
  const storageState = await resolveStorageState({
    baseUrl,
    headless,
    logPrefix: '[load:browser]',
  });

  const browser = await chromium.launch({ headless });
  const startedAt = Date.now();
  const deadline = startedAt + durationSeconds * 1000;
  const results = [];
  const pageErrors = [];

  console.log(
    `[load:browser] start base=${baseUrl} users=${users} duration=${durationSeconds}s ramp=${rampSeconds}s routes=${routes.join(',')}`
  );

  async function runUser(userId) {
    const rampDelay = rampSeconds > 0 ? Math.round((userId / users) * rampSeconds * 1000) : 0;
    await sleep(rampDelay);

    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 1024 },
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => {
      if (pageErrors.length < 50) pageErrors.push({ userId, message: error.message });
    });

    let iteration = 0;
    try {
      while (Date.now() < deadline) {
        const route = routes[(userId + iteration) % routes.length];
        const started = performance.now();
        let status = 0;
        let finalPath = route;
        let error = null;

        try {
          const response = await page.goto(`${baseUrl}${route}`, {
            waitUntil: 'domcontentloaded',
            timeout: timeoutMs,
          });
          status = response?.status() ?? 0;
          await page.waitForLoadState('networkidle', { timeout: networkIdleMs }).catch(() => undefined);
          finalPath = new URL(page.url()).pathname;
          if (route === '/overview') {
            await maybeExerciseOverview(page);
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }

        results.push({
          userId,
          route,
          finalPath,
          status,
          ok: status >= 200 && status < 400 && !error && finalPath !== '/login',
          latencyMs: Math.round(performance.now() - started),
          error,
        });

        iteration += 1;
        await sleep(jitter(thinkMs));
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  try {
    await Promise.all(Array.from({ length: users }, (_, index) => runUser(index)));
  } finally {
    await browser.close().catch(() => undefined);
  }

  const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const errors = results.filter((result) => !result.ok);
  const statusCounts = {};
  const routeCounts = {};

  for (const result of results) {
    statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;
    routeCounts[result.route] = (routeCounts[result.route] ?? 0) + 1;
  }

  const summary = {
    kind: 'browser',
    baseUrl,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    config: {
      users,
      durationSeconds,
      rampSeconds,
      thinkMs,
      timeoutMs,
      networkIdleMs,
      headless,
      routes,
    },
    totals: {
      navigations: results.length,
      errors: errors.length,
      pageErrors: pageErrors.length,
      navigationPerSecond: Number((results.length / elapsedSeconds).toFixed(2)),
      errorRate: results.length > 0 ? Number((errors.length / results.length).toFixed(4)) : 0,
    },
    statusCounts,
    routeCounts,
    latencyMs: {
      min: latencies[0] ?? 0,
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.at(-1) ?? 0,
    },
    sampleErrors: errors.slice(0, 20),
    pageErrors,
  };

  await mkdir(outputRoot, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    totals: summary.totals,
    latencyMs: summary.latencyMs,
    statusCounts,
  }, null, 2));

  const p95Failed = failP95Ms > 0 && summary.latencyMs.p95 > failP95Ms;
  const errorRateFailed = summary.totals.errorRate > failErrorRate;
  if (p95Failed || errorRateFailed || pageErrors.length > 0) {
    throw new Error(`Browser thresholds failed: p95=${summary.latencyMs.p95}ms, errorRate=${summary.totals.errorRate}, pageErrors=${pageErrors.length}`);
  }
}

await main().catch((error) => {
  console.error(`[load:browser] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
