#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
const telegramChatId = process.env.TELEGRAM_OPS_CHAT_ID?.trim();
const healthUrl = process.env.OPS_WATCHDOG_HEALTH_URL?.trim() || "http://127.0.0.1:3457/api/health";
const systemdUnits = (process.env.OPS_WATCHDOG_SYSTEMD_UNITS?.trim()
  || [
    "enterprise-wb-analytics.service",
    "enterprise-wb-analytics-sync-worker.service",
    "enterprise-wb-analytics-inngest.service",
    "enterprise-wb-analytics-redistribution-worker.service",
    "enterprise-wb-analytics-advertising-worker.service",
    "enterprise-wb-analytics-reviews-worker.service",
    "enterprise-wb-analytics-ops-worker.service",
    "enterprise-wb-analytics-supabase.service",
    "enterprise-wb-network-hardening.service",
    "nginx.service",
    "postgresql@17-main.service",
  ].join(","))
  .split(",")
  .map((unit) => unit.trim())
  .filter(Boolean);
const databaseUrl = process.env.DATABASE_URL?.trim();
const syncLookbackMinutes = Number.parseInt(process.env.OPS_WATCHDOG_SYNC_LOOKBACK_MINUTES ?? "45", 10);
const syncRunLimit = Number.parseInt(process.env.OPS_WATCHDOG_SYNC_RUN_LIMIT ?? "12", 10);
const maxRememberedSyncKeys = Number.parseInt(process.env.OPS_WATCHDOG_MAX_SYNC_KEYS ?? "1200", 10);
const statePath = process.env.OPS_WATCHDOG_STATE_PATH?.trim()
  || path.join(process.cwd(), "tmp", "ops-watchdog-state.json");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function getMissingTelegramEnvVars() {
  const missing = [];
  if (!isNonEmptyString(telegramToken)) {
    missing.push("TELEGRAM_BOT_TOKEN");
  }
  if (!isNonEmptyString(telegramChatId)) {
    missing.push("TELEGRAM_OPS_CHAT_ID");
  }
  return missing;
}

function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function readSyncSummary(rawSummary) {
  if (!rawSummary) {
    return null;
  }

  if (typeof rawSummary === "object") {
    return rawSummary;
  }

  if (typeof rawSummary === "string") {
    try {
      return JSON.parse(rawSummary);
    } catch {
      return null;
    }
  }

  return null;
}

async function loadState() {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      health: {
        status: parsed?.health?.status === "down" ? "down" : "up",
        lastError: isNonEmptyString(parsed?.health?.lastError) ? parsed.health.lastError : null,
      },
      systemd: {
        downUnits: Array.isArray(parsed?.systemd?.downUnits)
          ? parsed.systemd.downUnits.filter((unit) => isNonEmptyString(unit))
          : [],
      },
      sync: {
        notifiedKeys: Array.isArray(parsed?.sync?.notifiedKeys)
          ? parsed.sync.notifiedKeys.filter((key) => isNonEmptyString(key))
          : [],
      },
    };
  } catch {
    return {
      health: { status: "up", lastError: null },
      systemd: { downUnits: [] },
      sync: { notifiedKeys: [] },
    };
  }
}

async function saveState(state) {
  const dir = path.dirname(statePath);
  await mkdir(dir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function sendTelegram(message) {
  const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram API failed with status ${response.status}: ${body}`);
  }
}

async function deliverAlerts(outgoing) {
  if (outgoing.length === 0) {
    return {
      delivered: 0,
      mode: "idle",
    };
  }

  const missingTelegramEnvVars = getMissingTelegramEnvVars();
  if (missingTelegramEnvVars.length > 0) {
    console.warn(
      `[ops-watchdog] Telegram delivery disabled (${missingTelegramEnvVars.join(", ")} missing); logging ${outgoing.length} alert(s) locally`,
    );
    for (const message of outgoing) {
      console.warn(`[ops-watchdog][alert]\n${message}`);
    }
    return {
      delivered: 0,
      mode: "log-only",
    };
  }

  for (const message of outgoing) {
    await sendTelegram(message);
  }

  return {
    delivered: outgoing.length,
    mode: "telegram",
  };
}

async function checkHealthEndpoint() {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(12_000),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${bodyText}`,
      };
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return {
        ok: false,
        error: `invalid JSON payload: ${bodyText}`,
      };
    }

    if (body?.ok !== true) {
      return {
        ok: false,
        error: "payload contains ok=false",
      };
    }

    if (body?.checks && typeof body.checks === "object") {
      const badChecks = Object.entries(body.checks).filter(([, value]) => value !== "ok");
      if (badChecks.length > 0) {
        return {
          ok: false,
          error: `unhealthy checks: ${badChecks.map(([name, value]) => `${name}=${String(value)}`).join(", ")}`,
        };
      }
    }

    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  }
}

function checkSystemdUnits() {
  const statuses = {};
  for (const unit of systemdUnits) {
    const result = spawnSync("systemctl", ["is-active", unit], {
      encoding: "utf8",
      stdio: "pipe",
    });

    if (result.error) {
      throw result.error;
    }

    const status = result.stdout?.trim() || result.stderr?.trim() || `exit_${result.status ?? 1}`;
    statuses[unit] = status;
  }

  const downUnits = Object.entries(statuses)
    .filter(([, status]) => status !== "active")
    .map(([unit, status]) => `${unit}=${status}`)
    .sort();

  return {
    statuses,
    downUnits,
  };
}

async function collectSyncErrorEvents(previousKeys) {
  if (!databaseUrl) {
    return {
      events: [],
      mergedKeys: previousKeys,
    };
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
  });

  try {
    const rows = await sql`
      select
        id::text as id,
        tenant_id::text as tenant_id,
        status,
        requested_at,
        summary
      from sync_runs
      where status in ('completed_with_errors', 'failed')
        and requested_at > now() - make_interval(mins => ${Number.isFinite(syncLookbackMinutes) ? syncLookbackMinutes : 45})
      order by requested_at desc
      limit ${Number.isFinite(syncRunLimit) ? syncRunLimit : 12}
    `;

    const knownKeys = new Set(previousKeys);
    const newKeys = [];
    const eventsByRun = new Map();

    for (const row of rows) {
      const summary = readSyncSummary(row.summary);
      const sources = Array.isArray(summary?.sources) ? summary.sources : [];
      const errorSources = sources.filter((source) => source?.status === "error");

      const normalizedSources = errorSources.length > 0
        ? errorSources
        : row.status === "failed"
          ? [{ source: "run", error: "sync_failed_without_source_breakdown", meta: null }]
          : [];

      for (const source of normalizedSources) {
        const sourceName = isNonEmptyString(source?.source) ? source.source : "unknown";
        const uniqueKey = `${row.id}:${sourceName}`;

        if (knownKeys.has(uniqueKey)) {
          continue;
        }

        knownKeys.add(uniqueKey);
        newKeys.push(uniqueKey);

        if (!eventsByRun.has(row.id)) {
          eventsByRun.set(row.id, {
            runId: row.id,
            tenantId: row.tenant_id ?? "unknown",
            status: row.status ?? "unknown",
            requestedAt: row.requested_at instanceof Date
              ? row.requested_at.toISOString()
              : String(row.requested_at),
            sources: [],
          });
        }

        const sourceMessage =
          (isNonEmptyString(source?.meta?.shortMessage) && source.meta.shortMessage)
          || (isNonEmptyString(source?.error) && source.error)
          || "unknown_error";

        eventsByRun.get(row.id).sources.push({
          source: sourceName,
          message: sourceMessage,
        });
      }
    }

    const mergedKeys = [...new Set([...newKeys, ...previousKeys])].slice(
      0,
      Number.isFinite(maxRememberedSyncKeys) ? maxRememberedSyncKeys : 1200,
    );

    return {
      events: Array.from(eventsByRun.values()),
      mergedKeys,
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

function buildSyncAlertText(event) {
  const sourceLines = event.sources
    .map((source) => `• <code>${escapeHtml(source.source)}</code>: ${escapeHtml(source.message)}`)
    .join("\n");

  return [
    "⚠️ <b>SYNC SOURCE ERROR</b>",
    `run: <code>${escapeHtml(event.runId)}</code>`,
    `tenant: <code>${escapeHtml(event.tenantId)}</code>`,
    `status: <code>${escapeHtml(event.status)}</code>`,
    `requested_at: <code>${escapeHtml(event.requestedAt)}</code>`,
    sourceLines,
  ].join("\n");
}

async function main() {
  const state = await loadState();
  const outgoing = [];

  const health = await checkHealthEndpoint();
  if (!health.ok && state.health.status !== "down") {
    outgoing.push([
      "🚨 <b>HEALTH DOWN</b>",
      `url: <code>${escapeHtml(healthUrl)}</code>`,
      `error: ${escapeHtml(health.error ?? "unknown")}`,
    ].join("\n"));
  }

  if (health.ok && state.health.status === "down") {
    outgoing.push([
      "✅ <b>HEALTH RECOVERED</b>",
      `url: <code>${escapeHtml(healthUrl)}</code>`,
    ].join("\n"));
  }

  state.health = {
    status: health.ok ? "up" : "down",
    lastError: health.ok ? null : (health.error ?? "unknown"),
  };

  const systemd = checkSystemdUnits();
  const previousDownUnits = [...state.systemd.downUnits].sort();
  const currentDownUnits = [...systemd.downUnits].sort();

  if (currentDownUnits.length > 0 && !arraysEqual(previousDownUnits, currentDownUnits)) {
    outgoing.push([
      "🚨 <b>SYSTEMD UNIT DOWN</b>",
      ...currentDownUnits.map((unitStatus) => `• <code>${escapeHtml(unitStatus)}</code>`),
    ].join("\n"));
  }

  if (currentDownUnits.length === 0 && previousDownUnits.length > 0) {
    outgoing.push("✅ <b>SYSTEMD RECOVERED</b>\nAll monitored units are active.");
  }

  state.systemd.downUnits = currentDownUnits;

  const sync = await collectSyncErrorEvents(state.sync.notifiedKeys);
  for (const event of sync.events) {
    outgoing.push(buildSyncAlertText(event));
  }
  state.sync.notifiedKeys = sync.mergedKeys;

  const delivery = await deliverAlerts(outgoing);

  await saveState(state);

  if (outgoing.length === 0) {
    console.log("[ops-watchdog] no new alerts");
  } else if (delivery.mode === "log-only") {
    console.log(`[ops-watchdog] logged ${outgoing.length} alert(s) locally`);
  } else {
    console.log(`[ops-watchdog] sent ${delivery.delivered} alert(s)`);
  }
}

main().catch(async (error) => {
  console.error("[ops-watchdog] failed:", toErrorMessage(error));
  process.exit(1);
});
