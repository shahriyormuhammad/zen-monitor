#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_WORKER_ID = 'wb-economics';

const command = process.argv[2];
const options = parseArgs(process.argv.slice(3));

function parseArgs(args) {
  const result = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      const positional = result.get('_') || [];
      positional.push(arg);
      result.set('_', positional);
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf('=');
    if (equalsIndex >= 0) {
      result.set(raw.slice(0, equalsIndex), raw.slice(equalsIndex + 1));
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      result.set(raw, 'true');
      continue;
    }

    result.set(raw, next);
    index += 1;
  }
  return result;
}

function getOption(name, envName, fallback = undefined) {
  const value = options.get(name);
  if (value !== undefined) return String(value);
  const envValue = envName ? process.env[envName]?.trim() : undefined;
  return envValue || fallback;
}

function getRequired(name, envName) {
  const value = getOption(name, envName);
  if (!value) {
    fail(`required option --${name} or ${envName}`);
  }
  return value;
}

function numberOption(name) {
  const raw = getOption(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    fail(`--${name} must be a number`);
  }
  return value;
}

function jsonOption(name) {
  const raw = getOption(name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`--${name} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function numberListOption(name) {
  const raw = getOption(name);
  if (!raw) return undefined;
  const values = raw.split(',').map((entry) => Number(entry.trim())).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    fail(`--${name} must contain at least one number`);
  }
  return values;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefined(item)]),
    );
  }
  return value;
}

function baseUrl() {
  return (getOption('base-url', 'PROCIFRY_AGENT_BASE_URL')
    || process.env.APP_BASE_URL?.trim()
    || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function authHeaders() {
  const apiKey = getRequired('api-key', 'PROCIFRY_AGENT_API_KEY');
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

function commonActionFields(defaultSource) {
  return {
    worker_id: getOption('worker-id', 'PROCIFRY_AGENT_WORKER_ID', DEFAULT_WORKER_ID),
    tenant_id: getRequired('tenant-id', 'PROCIFRY_AGENT_TENANT_ID'),
    cabinet_oid: getRequired('cabinet-oid', 'PROCIFRY_AGENT_CABINET_OID'),
    period_from: getOption('period-from', 'PROCIFRY_AGENT_PERIOD_FROM', todayDate()),
    period_to: getOption('period-to', 'PROCIFRY_AGENT_PERIOD_TO', todayDate()),
    source: getOption('source', 'PROCIFRY_AGENT_SOURCE', defaultSource),
    source_updated_at: getOption('source-updated-at', 'PROCIFRY_AGENT_SOURCE_UPDATED_AT', new Date().toISOString()),
    confidence: getOption('confidence', 'PROCIFRY_AGENT_CONFIDENCE', 'confirmed'),
  };
}

async function requestJson(label, path, init = {}) {
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(Number(getOption('timeout-ms', undefined, '30000'))),
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${label}: expected JSON, got ${raw.slice(0, 500)}`);
  }

  if (!response.ok || body?.ok === false) {
    throw new Error(`${label}: HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  }

  return body;
}

function buildReportParams() {
  const params = jsonOption('params') || {};
  return removeUndefined({
    ...params,
    dateFrom: getOption('date-from') ?? getOption('from'),
    dateTo: getOption('date-to') ?? getOption('to'),
    days: numberOption('days'),
    nmId: numberOption('nm-id'),
    nmIds: numberListOption('nm-ids'),
    limit: numberOption('limit'),
  });
}

function buildUnitEconomicsIndicesBody() {
  const payload = jsonOption('payload');
  const values = jsonOption('values-json');
  const items = jsonOption('items-json');

  return removeUndefined({
    ...commonActionFields('procifry-agent-cli'),
    action_type: 'unit_economics_indices_update',
    payload,
    scope: getOption('scope'),
    values,
    nmId: numberOption('nm-id'),
    localityIndexPercent: numberOption('locality-index-percent'),
    localizationIndex: numberOption('localization-index'),
    irpPercent: numberOption('irp-percent'),
    salesDistributionIndex: numberOption('sales-distribution-index'),
    items,
  });
}

async function runCatalog() {
  const tenantId = getOption('tenant-id', 'PROCIFRY_AGENT_TENANT_ID');
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return requestJson('catalog', `/api/agent/v1/catalog${query}`, { method: 'GET' });
}

async function runReport() {
  const report = getRequired('report', 'PROCIFRY_AGENT_REPORT');
  const tenantId = getRequired('tenant-id', 'PROCIFRY_AGENT_TENANT_ID');
  const body = removeUndefined({
    tenantId,
    report,
    params: buildReportParams(),
  });
  return requestJson(`report ${report}`, '/api/agent/v1/report', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function runUnitEconomicsIndicesAction() {
  const body = buildUnitEconomicsIndicesBody();
  if (options.get('dry-run') === 'true') {
    return { ok: true, dryRun: true, body };
  }
  return requestJson('unit_economics_indices_update', '/api/agent/v1/unit-economics-indices/action', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/procifry-agent.mjs catalog --tenant-id <uuid>
  node scripts/procifry-agent.mjs report --tenant-id <uuid> --report oos_history --limit 5000
  node scripts/procifry-agent.mjs unit-economics-indices-action --tenant-id <uuid> --cabinet-oid <oid> --worker-id wb-economics --scope all_active_skus --locality-index-percent 1.01 --irp-percent 0.31

Env:
  PROCIFRY_AGENT_BASE_URL, PROCIFRY_AGENT_API_KEY, PROCIFRY_AGENT_TENANT_ID,
  PROCIFRY_AGENT_CABINET_OID, PROCIFRY_AGENT_WORKER_ID
`);
}

function fail(message) {
  console.error(`[procifry-agent] ${message}`);
  process.exit(1);
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const runners = {
    catalog: runCatalog,
    report: runReport,
    'unit-economics-indices-action': runUnitEconomicsIndicesAction,
    'unit_economics_indices_action': runUnitEconomicsIndicesAction,
  };

  const runner = runners[command];
  if (!runner) {
    printHelp();
    fail(`unknown command: ${command}`);
  }

  const result = await runner();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
