#!/usr/bin/env node

import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildCookieHeader,
  resolveStorageState,
} from './auth.mjs';
import {
  buildDefaultDateRange,
  jitter,
  normalizeBaseUrl,
  readFloatEnv,
  readIntEnv,
  sleep,
} from './utils.mjs';

const HELP = `
HTTP load test for Enterprise WB Analytics.

Required for authenticated routes:
  LOAD_EMAIL=... LOAD_PASSWORD=...
or:
  LOAD_COOKIE='name=value; ...'
or:
  LOAD_STORAGE_STATE=output/auth.json

Common env:
  LOAD_BASE_URL=https://xn----ptbqdfd1ao2c.xn--p1ai
  LOAD_CONCURRENCY=50
  LOAD_DURATION_SECONDS=300
  LOAD_TARGETS=dashboard,economics,stocks,advertising,signals,explorer
  LOAD_DATE_DAYS=30
  LOAD_THINK_MS=250
  LOAD_TIMEOUT_MS=30000
  LOAD_FAIL_P95_MS=2000
  LOAD_FAIL_5XX_RATE=0.01
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP.trim());
  process.exit(0);
}

const baseUrl = normalizeBaseUrl(process.env.LOAD_BASE_URL);
const concurrency = readIntEnv('LOAD_CONCURRENCY', 10, { min: 1, max: 2_000 });
const durationSeconds = readIntEnv('LOAD_DURATION_SECONDS', 60, { min: 1, max: 86_400 });
const rampSeconds = readIntEnv('LOAD_RAMP_SECONDS', Math.min(10, durationSeconds), { min: 0, max: durationSeconds });
const thinkMs = readIntEnv('LOAD_THINK_MS', 250, { min: 0, max: 60_000 });
const timeoutMs = readIntEnv('LOAD_TIMEOUT_MS', 30_000, { min: 1_000, max: 120_000 });
const dateDays = readIntEnv('LOAD_DATE_DAYS', 30, { min: 1, max: 366 });
const failP95Ms = readIntEnv('LOAD_FAIL_P95_MS', 2_000, { min: 0, max: 120_000 });
const fail5xxRate = readFloatEnv('LOAD_FAIL_5XX_RATE', 0.01, { min: 0, max: 1 });
const failErrorRate = readFloatEnv('LOAD_FAIL_ERROR_RATE', 0.05, { min: 0, max: 1 });
const outputRoot = process.env.LOAD_OUTPUT_DIR ?? path.join(process.cwd(), 'output', 'load');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputPath = path.join(outputRoot, `http-load-${stamp}.json`);

const { from, to } = buildDefaultDateRange(dateDays);

function makeBuiltinTargets() {
  return {
    dashboard: {
      name: 'dashboard',
      method: 'GET',
      path: `/api/views/dashboard?from=${from}&to=${to}`,
      weight: 4,
    },
    economics: {
      name: 'economics',
      method: 'GET',
      path: `/api/views/economics?from=${from}&to=${to}`,
      weight: 2,
    },
    stocks: {
      name: 'stocks',
      method: 'GET',
      path: '/api/views/stocks-v2',
      weight: 2,
    },
    advertising: {
      name: 'advertising',
      method: 'GET',
      path: `/api/views/advertising?from=${from}&to=${to}`,
      weight: 1,
    },
    signals: {
      name: 'signals',
      method: 'GET',
      path: '/api/views/dashboard/signals',
      weight: 1,
    },
    explorer: {
      name: 'explorer',
      method: 'GET',
      path: '/api/views/explorer?type=orders',
      weight: 1,
    },
  };
}

function parseTargetToken(token, builtins) {
  const [nameOrPath, rawWeight] = token.split(':');
  const weight = Math.max(1, Number.parseInt(rawWeight ?? '1', 10) || 1);
  const trimmed = nameOrPath.trim();

  if (builtins[trimmed]) {
    return { ...builtins[trimmed], weight: rawWeight ? weight : builtins[trimmed].weight };
  }

  if (trimmed.startsWith('/')) {
    const name = trimmed.replace(/^\/api\/views\//, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'custom';
    return { name, method: 'GET', path: trimmed, weight };
  }

  throw new Error(`Unknown LOAD_TARGETS entry: ${trimmed}`);
}

function parseTargets() {
  const builtins = makeBuiltinTargets();
  const raw = process.env.LOAD_TARGETS ?? 'dashboard,economics,stocks,advertising,signals,explorer';
  const targets = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseTargetToken(item, builtins));

  if (targets.length === 0) {
    throw new Error('LOAD_TARGETS produced an empty target list');
  }

  return targets;
}

function expandWeightedTargets(targets) {
  return targets.flatMap((target) => Array.from({ length: target.weight }, () => target));
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((percentileValue / 100) * sortedValues.length) - 1);
  return sortedValues[index];
}

function emptyRouteStats(target) {
  return {
    name: target.name,
    path: target.path,
    requests: 0,
    errors: 0,
    statusCounts: {},
    latenciesMs: [],
  };
}

function summarizeRoute(stats) {
  const sorted = [...stats.latenciesMs].sort((a, b) => a - b);
  return {
    name: stats.name,
    path: stats.path,
    requests: stats.requests,
    errors: stats.errors,
    statusCounts: stats.statusCounts,
    latencyMs: {
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted.at(-1) ?? 0,
    },
  };
}

async function requestOnce(target, cookieHeader) {
  const startedAt = performance.now();
  const url = new URL(target.path, baseUrl);
  try {
    const response = await fetch(url, {
      method: target.method,
      headers: {
        accept: 'application/json,text/html;q=0.8,*/*;q=0.5',
        cookie: cookieHeader,
        'user-agent': 'enterprise-wb-load-test/1.0',
        'x-load-test': 'enterprise-wb-analytics',
      },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const body = await response.arrayBuffer();
    return {
      target: target.name,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      bytes: body.byteLength,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      target: target.name,
      status: 0,
      ok: false,
      bytes: 0,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function warmup(targets, cookieHeader) {
  console.log(`[load:http] warmup ${targets.length} target(s)`);
  for (const target of targets) {
    const result = await requestOnce(target, cookieHeader);
    console.log(`[load:http] warmup ${target.name}: status=${result.status} latency=${result.latencyMs}ms`);
    if (result.status === 401 || result.status === 403) {
      throw new Error(`Warmup auth failed on ${target.name}: HTTP ${result.status}`);
    }
  }
}

async function main() {
  const targets = parseTargets();
  const weightedTargets = expandWeightedTargets(targets);
  const routeStats = new Map(targets.map((target) => [target.name, emptyRouteStats(target)]));
  const allLatencies = [];
  const statusCounts = {};
  const errors = [];
  let bytes = 0;
  let total = 0;
  let success = 0;
  let serverErrors = 0;

  const storageState = await resolveStorageState({
    baseUrl,
    logPrefix: '[load:http]',
  });
  const cookieHeader = buildCookieHeader(storageState, baseUrl);
  if (!cookieHeader) {
    throw new Error('No cookies resolved for authenticated load test');
  }

  await warmup(targets, cookieHeader);

  const startedAt = Date.now();
  const deadline = startedAt + durationSeconds * 1000;
  console.log(
    `[load:http] start base=${baseUrl} concurrency=${concurrency} duration=${durationSeconds}s ramp=${rampSeconds}s targets=${targets.map((target) => target.name).join(',')}`
  );

  async function runWorker(workerId) {
    const rampDelay = rampSeconds > 0 ? Math.round((workerId / concurrency) * rampSeconds * 1000) : 0;
    await sleep(rampDelay);

    let iteration = 0;
    while (Date.now() < deadline) {
      const target = weightedTargets[(workerId + iteration) % weightedTargets.length];
      const result = await requestOnce(target, cookieHeader);
      const stats = routeStats.get(target.name);

      total += 1;
      bytes += result.bytes;
      allLatencies.push(result.latencyMs);
      statusCounts[result.status] = (statusCounts[result.status] ?? 0) + 1;

      if (stats) {
        stats.requests += 1;
        stats.latenciesMs.push(result.latencyMs);
        stats.statusCounts[result.status] = (stats.statusCounts[result.status] ?? 0) + 1;
      }

      if (result.ok) {
        success += 1;
      } else {
        if (stats) stats.errors += 1;
        if (result.status >= 500 || result.status === 0) serverErrors += 1;
        if (errors.length < 20) errors.push(result);
      }

      iteration += 1;
      await sleep(jitter(thinkMs));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, index) => runWorker(index)));

  const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
  const sorted = [...allLatencies].sort((a, b) => a - b);
  const summary = {
    kind: 'http',
    baseUrl,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    config: {
      concurrency,
      durationSeconds,
      rampSeconds,
      thinkMs,
      timeoutMs,
      targets: targets.map((target) => ({ name: target.name, path: target.path, weight: target.weight })),
      dateRange: { from, to },
    },
    totals: {
      requests: total,
      success,
      errors: total - success,
      serverErrors,
      bytes,
      rps: Number((total / elapsedSeconds).toFixed(2)),
      successRate: total > 0 ? Number((success / total).toFixed(4)) : 0,
      errorRate: total > 0 ? Number(((total - success) / total).toFixed(4)) : 0,
      serverErrorRate: total > 0 ? Number((serverErrors / total).toFixed(4)) : 0,
    },
    statusCounts,
    latencyMs: {
      min: sorted[0] ?? 0,
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted.at(-1) ?? 0,
    },
    routes: Array.from(routeStats.values()).map(summarizeRoute),
    sampleErrors: errors,
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
  const serverErrorFailed = summary.totals.serverErrorRate > fail5xxRate;
  const errorRateFailed = summary.totals.errorRate > failErrorRate;
  if (p95Failed || serverErrorFailed || errorRateFailed) {
    throw new Error(
      `Load thresholds failed: p95=${summary.latencyMs.p95}ms, errorRate=${summary.totals.errorRate}, serverErrorRate=${summary.totals.serverErrorRate}`
    );
  }
}

await main().catch((error) => {
  console.error(`[load:http] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
