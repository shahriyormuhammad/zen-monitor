#!/usr/bin/env node

import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { resolveStorageState } from './auth.mjs';
import {
  normalizeBaseUrl,
  readBoolEnv,
  readIntEnv,
} from './utils.mjs';

const HELP = `
Browser tab waterfall for Enterprise WB Analytics.

Required:
  LOAD_EMAIL=... LOAD_PASSWORD=...
or:
  LOAD_STORAGE_STATE=output/auth.json
or:
  LOAD_COOKIE='name=value; ...'

Common env:
  LOAD_BASE_URL=http://localhost:3000
  TAB_WATERFALL_ROUTES=/overview,/economics-v2,/stocks-v2,/advertising,/settings
  TAB_WATERFALL_HEADLESS=1
  TAB_WATERFALL_TIMEOUT_MS=45000
  TAB_WATERFALL_NETWORK_IDLE_MS=10000
  TAB_WATERFALL_SETTLE_MS=1500
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP.trim());
  process.exit(0);
}

const baseUrl = normalizeBaseUrl(process.env.LOAD_BASE_URL);
const timeoutMs = readIntEnv('TAB_WATERFALL_TIMEOUT_MS', 45_000, { min: 5_000, max: 180_000 });
const networkIdleMs = readIntEnv('TAB_WATERFALL_NETWORK_IDLE_MS', 10_000, { min: 1_000, max: 60_000 });
const settleMs = readIntEnv('TAB_WATERFALL_SETTLE_MS', 1_500, { min: 0, max: 30_000 });
const headless = readBoolEnv('TAB_WATERFALL_HEADLESS', true);
const outputRoot = process.env.LOAD_OUTPUT_DIR ?? path.join(process.cwd(), 'output', 'load');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputPath = path.join(outputRoot, `tab-waterfall-${stamp}.json`);

function parseRoutes() {
  const raw = process.env.TAB_WATERFALL_ROUTES ?? '/overview,/economics-v2,/stocks-v2,/advertising,/settings';
  const routes = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('/') ? item : `/${item}`));

  if (routes.length === 0) {
    throw new Error('TAB_WATERFALL_ROUTES produced an empty route list');
  }
  return routes;
}

function cookieHeaderToCookies(cookieHeader) {
  const trimmed = cookieHeader?.trim();
  if (!trimmed) return [];

  const url = new URL(baseUrl);
  return trimmed
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex <= 0) return null;
      return {
        name: item.slice(0, separatorIndex).trim(),
        value: item.slice(separatorIndex + 1).trim(),
        domain: url.hostname,
        path: '/',
        httpOnly: false,
        secure: url.protocol === 'https:',
        sameSite: 'Lax',
      };
    })
    .filter(Boolean);
}

function toPathname(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

function classifyRequest(rawUrl, resourceType, method, headers = {}) {
  const url = new URL(rawUrl);
  const sameOrigin = url.origin === new URL(baseUrl).origin;
  if (sameOrigin && headers['next-action']) return 'server-action';
  if (sameOrigin && url.searchParams.has('_rsc')) return 'rsc';
  if (sameOrigin && method === 'POST' && resourceType === 'fetch') return 'server-action';
  if (sameOrigin && url.pathname.startsWith('/api/')) return 'api';
  if (sameOrigin && url.pathname.startsWith('/_next/static/')) return 'next-static';
  if (resourceType === 'document') return 'document';
  if (resourceType === 'image') return 'image';
  if (resourceType === 'font') return 'font';
  if (!sameOrigin) return 'external';
  return 'other';
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarizeRequests(requests) {
  const byKind = {};
  const statusCounts = {};
  const apiRequests = [];
  const failedOrBad = [];
  let knownBytes = 0;

  for (const request of requests) {
    byKind[request.kind] ??= {
      count: 0,
      knownBytes: 0,
      durationMs: { p50: 0, p95: 0, max: 0 },
      durations: [],
    };
    byKind[request.kind].count += 1;
    byKind[request.kind].knownBytes += request.encodedBytes ?? 0;
    byKind[request.kind].durations.push(request.durationMs);
    knownBytes += request.encodedBytes ?? 0;

    const statusKey = String(request.status ?? 0);
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;

    if (request.kind === 'api') {
      apiRequests.push(request);
    }

    if (request.error || request.status >= 400 || request.status === 0) {
      failedOrBad.push(request);
    }
  }

  for (const value of Object.values(byKind)) {
    value.durationMs = {
      p50: percentile(value.durations, 50),
      p95: percentile(value.durations, 95),
      max: Math.max(0, ...value.durations),
    };
    delete value.durations;
  }

  return {
    requestCount: requests.length,
    knownBytes,
    byKind,
    statusCounts,
    api: apiRequests
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 25)
      .map((request) => ({
        method: request.method,
        path: request.path,
        status: request.status,
        durationMs: request.durationMs,
        encodedBytes: request.encodedBytes,
      })),
    slowest: [...requests]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 20)
      .map((request) => ({
        kind: request.kind,
        method: request.method,
        path: request.path,
        status: request.status,
        durationMs: request.durationMs,
        encodedBytes: request.encodedBytes,
        error: request.error,
      })),
    failedOrBad: failedOrBad.slice(0, 25).map((request) => ({
      kind: request.kind,
      method: request.method,
      path: request.path,
      status: request.status,
      durationMs: request.durationMs,
      error: request.error,
    })),
  };
}

async function inspectRoute(context, route) {
  const page = await context.newPage();
  const requests = new Map();
  const pageErrors = [];
  const consoleErrors = [];
  const startedAt = performance.now();
  let documentStatus = 0;
  let navigationError = null;

  page.on('pageerror', (error) => {
    if (pageErrors.length < 20) pageErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < 20) {
      consoleErrors.push(message.text());
    }
  });
  page.on('request', (request) => {
    const headers = request.headers();
    requests.set(request, {
      method: request.method(),
      url: request.url(),
      path: toPathname(request.url()),
      resourceType: request.resourceType(),
      kind: classifyRequest(request.url(), request.resourceType(), request.method(), headers),
      startedAt: performance.now(),
      status: 0,
      encodedBytes: 0,
      error: null,
    });
  });
  page.on('response', async (response) => {
    const request = response.request();
    const item = requests.get(request);
    if (!item) return;
    item.status = response.status();
    const contentLength = Number(response.headers()['content-length'] ?? 0);
    item.encodedBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
  });
  page.on('requestfinished', (request) => {
    const item = requests.get(request);
    if (!item) return;
    item.finishedAt = performance.now();
  });
  page.on('requestfailed', (request) => {
    const item = requests.get(request);
    if (!item) return;
    item.finishedAt = performance.now();
    item.error = request.failure()?.errorText ?? 'request failed';
  });

  try {
    const response = await page.goto(`${baseUrl}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    documentStatus = response?.status() ?? 0;
    await page.waitForLoadState('networkidle', { timeout: networkIdleMs }).catch(() => undefined);
    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  const finishedAt = performance.now();
  const normalizedRequests = Array.from(requests.values()).map((request) => ({
    method: request.method,
    path: request.path,
    resourceType: request.resourceType,
    kind: request.kind,
    status: request.status,
    encodedBytes: request.encodedBytes,
    durationMs: Math.round((request.finishedAt ?? finishedAt) - request.startedAt),
    error: request.error,
  }));
  const finalUrl = page.url();
  const finalPath = finalUrl ? toPathname(finalUrl) : null;
  await page.close().catch(() => undefined);

  return {
    route,
    finalPath,
    documentStatus,
    ok: documentStatus >= 200 && documentStatus < 400 && finalPath !== '/login' && finalPath !== '/signup' && !navigationError,
    totalMs: Math.round(finishedAt - startedAt),
    navigationError,
    pageErrors,
    consoleErrors,
    summary: summarizeRequests(normalizedRequests),
  };
}

async function main() {
  const routes = parseRoutes();
  const storageState = await resolveStorageState({
    baseUrl,
    headless,
    logPrefix: '[load:tabs]',
  });
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 1024 },
  });

  const cookieHeaderCookies = cookieHeaderToCookies(process.env.LOAD_COOKIE);
  if (cookieHeaderCookies.length > 0) {
    await context.addCookies(cookieHeaderCookies);
  }

  const startedAt = Date.now();
  const results = [];
  console.log(`[load:tabs] start base=${baseUrl} routes=${routes.join(',')}`);

  try {
    for (const route of routes) {
      const result = await inspectRoute(context, route);
      results.push(result);
      const apiCount = result.summary.byKind.api?.count ?? 0;
      const staticCount = result.summary.byKind['next-static']?.count ?? 0;
      console.log(
        `[load:tabs] ${route}: ok=${result.ok} total=${result.totalMs}ms status=${result.documentStatus} api=${apiCount} static=${staticCount}`
      );
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const summary = {
    kind: 'tab-waterfall',
    baseUrl,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    config: {
      routes,
      timeoutMs,
      networkIdleMs,
      settleMs,
      headless,
    },
    results,
  };

  await mkdir(outputRoot, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath }, null, 2));

  if (results.some((result) => !result.ok || result.pageErrors.length > 0)) {
    throw new Error('One or more tab waterfall checks failed');
  }
}

await main().catch((error) => {
  console.error(`[load:tabs] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
