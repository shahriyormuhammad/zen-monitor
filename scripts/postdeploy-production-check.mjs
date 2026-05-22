#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const sshHost = process.env.POSTDEPLOY_SSH_HOST?.trim() || "metric-pulse-app-01";
const remoteProjectPath = process.env.POSTDEPLOY_REMOTE_PATH?.trim() || "/srv/projects/enterprise-wb-analytics";
const branch = process.env.POSTDEPLOY_BRANCH?.trim() || "main";
const internalHealthUrl = process.env.POSTDEPLOY_INTERNAL_HEALTH_URL?.trim() || "http://127.0.0.1:3457/api/health";
const externalHealthUrl = process.env.POSTDEPLOY_EXTERNAL_HEALTH_URL?.trim() || "https://про-цифры.рф/api/health";
const serviceList = (process.env.POSTDEPLOY_SERVICES?.trim()
  || [
    "enterprise-wb-analytics-supabase.service",
    "enterprise-wb-analytics.service",
    "enterprise-wb-analytics-sync-worker.service",
    "enterprise-wb-analytics-inngest.service",
    "enterprise-wb-analytics-redistribution-worker.service",
    "enterprise-wb-analytics-advertising-worker.service",
    "enterprise-wb-analytics-reviews-worker.service",
    "enterprise-wb-analytics-ops-worker.service",
    "enterprise-wb-network-hardening.service",
    "nginx.service",
    "postgresql@17-main.service",
  ].join(","))
  .split(",")
  .map((service) => service.trim())
  .filter(Boolean);
const timerList = (process.env.POSTDEPLOY_TIMERS?.trim()
  || "enterprise-wb-analytics-watchdog.timer,enterprise-wb-analytics-backup.timer")
  .split(",")
  .map((timer) => timer.trim())
  .filter(Boolean);
const oneshotGuardrailServices = (process.env.POSTDEPLOY_ONESHOT_GUARDRAIL_SERVICES?.trim()
  || "enterprise-wb-analytics-watchdog.service,enterprise-wb-analytics-backup.service")
  .split(",")
  .map((service) => service.trim())
  .filter(Boolean);

const smokeEmail = process.env.SMOKE_EMAIL?.trim();
const smokePassword = process.env.SMOKE_PASSWORD?.trim();
const smokeAuthMode = (() => {
  const raw = process.env.POSTDEPLOY_SMOKE_AUTH_MODE?.trim().toLowerCase() || "login";
  if (raw === "login" || raw === "auto" || raw === "signup" || raw === "skip") {
    return raw;
  }
  throw new Error(`Unsupported POSTDEPLOY_SMOKE_AUTH_MODE: ${raw}`);
})();

function shQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });

  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";

  if (result.status !== 0) {
    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(output || `${command} ${args.join(" ")} failed with code ${result.status ?? 1}`);
  }

  return stdout;
}

function runInherit(stepLabel, command, args, options = {}) {
  console.log(`[postdeploy] ${stepLabel}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${stepLabel} failed with exit code ${result.status ?? 1}`);
  }
}

function getRemoteOpsExpectations() {
  console.log("[postdeploy] checking remote ops env contract");
  const remoteScript = [
    "node <<'NODE'",
    "const fs = require('node:fs');",
    `const filePath = ${JSON.stringify(`${remoteProjectPath}/.env.runtime`)};`,
    "const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';",
    "const env = {};",
    "for (const line of raw.split(/\\r?\\n/)) {",
    "  const trimmed = line.trim();",
    "  if (!trimmed || trimmed.startsWith('#')) continue;",
    "  const separatorIndex = line.indexOf('=');",
    "  if (separatorIndex === -1) continue;",
    "  const key = line.slice(0, separatorIndex).trim();",
    "  let value = line.slice(separatorIndex + 1).trim();",
    "  if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith(\"'\") && value.endsWith(\"'\"))) value = value.slice(1, -1);",
    "  env[key] = value;",
    "}",
    "function normalizeDatabaseTarget(value) {",
    "  if (!value) return null;",
    "  try {",
    "    const url = new URL(value);",
    "    return `${url.protocol}//${url.host}${url.pathname}`;",
    "  } catch {",
    "    return value;",
    "  }",
    "}",
    "const backupSource = normalizeDatabaseTarget(env.DATABASE_URL);",
    "const backupRestore = normalizeDatabaseTarget(env.BACKUP_RESTORE_DATABASE_URL);",
    "const backupTimerExpected = Boolean(backupSource && backupRestore && backupSource !== backupRestore);",
    "console.log(JSON.stringify({",
    "  backupTimerExpected,",
    "  hasTelegramBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),",
    "  hasTelegramOpsChatId: Boolean(env.TELEGRAM_OPS_CHAT_ID),",
    "}));",
    "NODE",
  ].join("\n");

  const output = runCapture("ssh", [sshHost, remoteScript]);
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`failed to parse remote ops contract: ${output}`);
  }

  console.log(
    `[postdeploy] remote ops env: backupTimerExpected=${parsed.backupTimerExpected ? "yes" : "no"}, `
      + `watchdogTelegram=${parsed.hasTelegramBotToken && parsed.hasTelegramOpsChatId ? "yes" : "log-only"}`
  );

  return parsed;
}

function deriveSmokeBaseUrl() {
  const explicit = process.env.POSTDEPLOY_SMOKE_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  return externalHealthUrl.replace(/\/api\/health\/?$/i, "").replace(/\/$/, "");
}

async function checkHealth(label, url) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`${label}: request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}: ${rawBody}`);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error(`${label}: expected JSON payload, got: ${rawBody}`);
  }

  if (body?.ok !== true) {
    throw new Error(`${label}: response has ok=false`);
  }

  const checks = body?.checks;
  if (checks && typeof checks === "object") {
    const failedChecks = Object.entries(checks).filter(([, value]) => value !== "ok");
    if (failedChecks.length > 0) {
      throw new Error(
        `${label}: unhealthy checks: ${failedChecks.map(([name, value]) => `${name}=${String(value)}`).join(", ")}`
      );
    }
  }
}

function checkCommitParity() {
  console.log("[postdeploy] checking local/remote commit parity");
  const localSha = runCapture("git", ["rev-parse", branch]);
  const remoteSha = runCapture(
    "ssh",
    [
      sshHost,
      `cd ${shQuote(remoteProjectPath)} && git rev-parse ${shQuote(branch)}`,
    ],
  );

  if (localSha !== remoteSha) {
    throw new Error(`SHA mismatch: local=${localSha}, remote=${remoteSha}`);
  }

  console.log(`[postdeploy] SHA parity OK (${localSha})`);
}

function checkSystemdUnits() {
  console.log("[postdeploy] checking systemd unit status");
  const remoteScript = [
    "set -e",
    `for unit in ${serviceList.map((service) => shQuote(service)).join(" ")}; do`,
    "  status=$(systemctl is-active \"$unit\" || true)",
    "  echo \"$unit:$status\"",
    "done",
  ].join("\n");

  const output = runCapture("ssh", [sshHost, remoteScript]);
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);

  const unhealthy = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const unit = line.slice(0, separator);
    const status = line.slice(separator + 1);
    if (status !== "active") {
      unhealthy.push(`${unit}=${status}`);
    }
  }

  if (unhealthy.length > 0) {
    throw new Error(`systemd unhealthy units: ${unhealthy.join(", ")}`);
  }

  console.log("[postdeploy] systemd units OK");
}

function checkSystemdTimers(remoteOpsExpectations) {
  console.log("[postdeploy] checking systemd timer status");
  const remoteScript = [
    "set -e",
    `for unit in ${timerList.map((timer) => shQuote(timer)).join(" ")}; do`,
    "  status=$(systemctl is-active \"$unit\" || true)",
    "  echo \"$unit:$status\"",
    "done",
  ].join("\n");

  const output = runCapture("ssh", [sshHost, remoteScript]);
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);

  const expectedStatuses = new Map(timerList.map((timer) => [timer, "active"]));
  if (expectedStatuses.has("enterprise-wb-analytics-backup.timer")) {
    expectedStatuses.set(
      "enterprise-wb-analytics-backup.timer",
      remoteOpsExpectations.backupTimerExpected ? "active" : "inactive"
    );
  }

  const unhealthy = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const unit = line.slice(0, separator);
    const status = line.slice(separator + 1);
    const expectedStatus = expectedStatuses.get(unit) ?? "active";
    if (status !== expectedStatus) {
      unhealthy.push(`${unit}=${status} (expected ${expectedStatus})`);
    }
  }

  if (unhealthy.length > 0) {
    throw new Error(`systemd unhealthy timers: ${unhealthy.join(", ")}`);
  }

  console.log("[postdeploy] systemd timers OK");
}

function checkGuardrailServicesNotFailed() {
  console.log("[postdeploy] checking backup/watchdog services are not failed");
  const remoteScript = [
    "set -e",
    `for unit in ${oneshotGuardrailServices.map((service) => shQuote(service)).join(" ")}; do`,
    "  status=$(systemctl is-active \"$unit\" || true)",
    "  echo \"$unit:$status\"",
    "done",
  ].join("\n");

  const output = runCapture("ssh", [sshHost, remoteScript]);
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);

  const failed = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const unit = line.slice(0, separator);
    const status = line.slice(separator + 1);
    if (status === "failed") {
      failed.push(unit);
    }
  }

  if (failed.length > 0) {
    throw new Error(`systemd failed guardrail services: ${failed.join(", ")}`);
  }

  console.log("[postdeploy] backup/watchdog services are not failed");
}

async function checkRemoteInternalHealth() {
  console.log("[postdeploy] checking internal /api/health on server");
  const payload = runCapture("ssh", [sshHost, `curl -fsS ${shQuote(internalHealthUrl)}`]);
  let body;
  try {
    body = JSON.parse(payload);
  } catch {
    throw new Error(`internal health returned non-JSON payload: ${payload}`);
  }

  if (body?.ok !== true) {
    throw new Error("internal health reports ok=false");
  }

  const checks = body?.checks;
  if (checks && typeof checks === "object") {
    const failedChecks = Object.entries(checks).filter(([, value]) => value !== "ok");
    if (failedChecks.length > 0) {
      throw new Error(
        `internal health failed checks: ${failedChecks.map(([name, value]) => `${name}=${String(value)}`).join(", ")}`
      );
    }
  }
}

function runSmokeScenario() {
  if (smokeAuthMode === "skip") {
    console.log("[postdeploy] skipping UI smoke because POSTDEPLOY_SMOKE_AUTH_MODE=skip");
    return;
  }

  if (smokeAuthMode === "login" && (!smokeEmail || !smokePassword)) {
    throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD are required when POSTDEPLOY_SMOKE_AUTH_MODE=login");
  }

  const smokeBaseUrl = deriveSmokeBaseUrl();
  const smokeEnv = {
    ...process.env,
    SMOKE_BASE_URL: smokeBaseUrl,
    SMOKE_AUTH_MODE: smokeAuthMode,
    SMOKE_HEADLESS: process.env.SMOKE_HEADLESS ?? "1",
    SMOKE_TRIGGER_SYNC: process.env.SMOKE_TRIGGER_SYNC ?? "1",
    SMOKE_EXPECT_INNGEST_RUNTIME: process.env.SMOKE_EXPECT_INNGEST_RUNTIME ?? "0",
  };
  if (smokeEmail) {
    smokeEnv.SMOKE_EMAIL = smokeEmail;
  }
  if (smokePassword) {
    smokeEnv.SMOKE_PASSWORD = smokePassword;
  }

  runInherit("running UI smoke scenario", npmCommand, ["run", "smoke:operator"], {
    env: smokeEnv,
  });
}

try {
  const remoteOpsExpectations = getRemoteOpsExpectations();
  checkCommitParity();
  checkSystemdUnits();
  checkSystemdTimers(remoteOpsExpectations);
  checkGuardrailServicesNotFailed();
  await checkRemoteInternalHealth();
  await checkHealth("external /api/health", externalHealthUrl);
  runSmokeScenario();
  console.log("[postdeploy] hard check passed");
} catch (error) {
  console.error("[postdeploy] hard check failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
