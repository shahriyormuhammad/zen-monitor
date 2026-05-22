#!/usr/bin/env node

import process from 'node:process';

const baseUrl = (process.env.PROCIFRY_AGENT_BASE_URL?.trim()
  || process.env.APP_BASE_URL?.trim()
  || 'http://localhost:3000').replace(/\/$/, '');
const apiKey = process.env.PROCIFRY_AGENT_API_KEY?.trim() || process.env.AGENT_API_KEY?.trim();
const tenantIds = splitCsv(process.env.PROCIFRY_SMOKE_TENANT_IDS || process.env.AGENT_API_ALLOWED_TENANT_IDS);
const reports = splitCsv(process.env.PROCIFRY_SMOKE_REPORTS).length > 0
  ? splitCsv(process.env.PROCIFRY_SMOKE_REPORTS)
  : [
      'dashboard_summary',
      'sync_status',
      'unit_economics_summary',
      'cost_snapshot',
      'sales_funnel_summary',
      'advertising_by_nm_summary',
      'stocks_summary',
      'price_history',
      'finance_realization_detail',
    ];
const strictReports = process.env.PROCIFRY_SMOKE_STRICT_REPORTS?.trim() !== '0';
const dateTo = process.env.PROCIFRY_SMOKE_DATE_TO?.trim() || yesterdayDate();
const dateFrom = process.env.PROCIFRY_SMOKE_DATE_FROM?.trim() || dateTo;

function splitCsv(value) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function yesterdayDate() {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday.toISOString().slice(0, 10);
}

function fail(message) {
  console.error(`[procifry-smoke] ${message}`);
  process.exit(1);
}

function authHeaders() {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

async function requestJson(label, url, init = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...authHeaders(),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`${label}: request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${label}: expected JSON, got ${raw.slice(0, 300)}`);
  }

  if (!response.ok || body?.ok !== true) {
    throw new Error(`${label}: HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  return body;
}

function buildReportPayload(report, tenantId) {
  const commonRange = {
    dateFrom,
    dateTo,
    limit: 20,
  };

  switch (report) {
    case 'dashboard_summary':
      return tenantIds.length > 1
        ? { tenantId: null, report, params: { tenantIds, multi_tenant: true, ...commonRange } }
        : { tenantId, report, params: commonRange };
    case 'cost_snapshot':
      return tenantIds.length > 1
        ? { tenantId: null, report, params: { tenantIds, multi_tenant: true, days: 30, limit: 20 } }
        : { tenantId, report, params: { days: 30, limit: 20 } };
    case 'sync_status':
    case 'stocks_summary':
      return { tenantId, report, params: { limit: 20 } };
    case 'sales_funnel_summary':
    case 'advertising_by_nm_summary':
    case 'unit_economics_summary':
    case 'price_history':
    case 'finance_realization_detail':
    case 'advertising_campaign_stats':
    case 'search_positions_summary':
    case 'competitor_cards_summary':
    case 'ab_tests_summary':
      return { tenantId, report, params: commonRange };
    default:
      return { tenantId, report, params: { ...commonRange, limit: 20 } };
  }
}

function itemCount(reportBody) {
  if (Array.isArray(reportBody.items)) {
    return reportBody.items.length;
  }
  if (Array.isArray(reportBody.data?.items)) {
    return reportBody.data.items.length;
  }
  return null;
}

async function run() {
  if (!apiKey) {
    fail('PROCIFRY_AGENT_API_KEY or AGENT_API_KEY is required');
  }
  if (tenantIds.length === 0) {
    fail('PROCIFRY_SMOKE_TENANT_IDS or AGENT_API_ALLOWED_TENANT_IDS is required');
  }

  console.log(`[procifry-smoke] base=${baseUrl}`);
  console.log(`[procifry-smoke] tenants=${tenantIds.length}, reports=${reports.join(', ')}, date=${dateFrom}..${dateTo}`);

  const errors = [];
  for (const tenantId of tenantIds) {
    try {
      const catalogUrl = `${baseUrl}/api/agent/v1/catalog?tenantId=${encodeURIComponent(tenantId)}`;
      const catalog = await requestJson(`catalog ${tenantId}`, catalogUrl);
      const catalogReports = new Map((catalog.reports || []).map((entry) => [entry.id, entry]));
      console.log(`[procifry-smoke] catalog tenant=${tenantId} reports=${catalogReports.size}`);

      for (const report of reports) {
        const catalogEntry = catalogReports.get(report);
        if (!catalogEntry) {
          const message = `${report}: not visible in catalog for tenant=${tenantId}`;
          if (strictReports) {
            errors.push(message);
          } else {
            console.warn(`[procifry-smoke] warn: ${message}`);
          }
          continue;
        }

        if (catalogEntry.available === false) {
          const reason = catalogEntry.unavailableReason || 'unavailable';
          const message = `${report}: available=false for tenant=${tenantId}: ${reason}`;
          if (strictReports) {
            errors.push(message);
          } else {
            console.warn(`[procifry-smoke] warn: ${message}`);
          }
          continue;
        }

        try {
          const body = await requestJson(`report ${report} ${tenantId}`, `${baseUrl}/api/agent/v1/report`, {
            method: 'POST',
            body: JSON.stringify(buildReportPayload(report, tenantId)),
          });
          const count = itemCount(body);
          const freshness = catalogEntry.freshness?.sourceUpdatedAt || 'none';
          const coverage = catalogEntry.dateCoverage
            ? `${catalogEntry.dateCoverage.from || 'none'}..${catalogEntry.dateCoverage.to || 'none'}`
            : 'none';
          console.log(`[procifry-smoke] ok report=${report} tenant=${tenantId} items=${count ?? 'n/a'} sourceUpdatedAt=${freshness} coverage=${coverage}`);
        } catch (error) {
          errors.push(`${report} tenant=${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`tenant=${tenantId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    console.error('[procifry-smoke] failed');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('[procifry-smoke] passed');
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
