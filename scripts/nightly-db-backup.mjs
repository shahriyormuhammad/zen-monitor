#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

const databaseUrl = process.env.DATABASE_URL?.trim();
const restoreDatabaseUrl = process.env.BACKUP_RESTORE_DATABASE_URL?.trim();
const backupDir = process.env.BACKUP_DIR?.trim()
  || path.join(process.cwd(), "backups", "db-nightly");
const retentionDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7", 10);
const minExpectedTables = Number.parseInt(process.env.BACKUP_RESTORE_MIN_TABLES ?? "10", 10);

function ensurePositiveInteger(value, fallbackValue) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackValue;
  }
  return Math.floor(value);
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatStamp(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function normalizeDbIdentity(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

function waitForChildExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed with exit code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

async function runBackup(backupFilePath) {
  const stderr = [];
  const dump = spawn("pg_dump", [databaseUrl, "--no-owner", "--no-privileges", "--format=plain"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  dump.stderr.on("data", (chunk) => {
    stderr.push(chunk.toString());
  });

  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(backupFilePath, { mode: 0o600 });

  await Promise.all([
    pipeline(dump.stdout, gzip, output),
    waitForChildExit(dump, "pg_dump"),
  ]).catch((error) => {
    const extra = stderr.join("").trim();
    if (extra) {
      throw new Error(`${toErrorMessage(error)}\n${extra}`);
    }
    throw error;
  });
}

async function runPsql(args, label) {
  const stderr = [];
  const stdout = [];
  const child = spawn("psql", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    stdout.push(chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk.toString());
  });

  await waitForChildExit(child, label).catch((error) => {
    const details = [stdout.join(""), stderr.join("")].join("").trim();
    if (details) {
      throw new Error(`${toErrorMessage(error)}\n${details}`);
    }
    throw error;
  });

  return stdout.join("").trim();
}

async function runRestoreTest(backupFilePath) {
  await runPsql(
    [
      restoreDatabaseUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    ],
    "restore-schema-reset",
  );

  const restoreStderr = [];
  const restoreStdout = [];
  const psqlRestore = spawn(
    "psql",
    [restoreDatabaseUrl, "-v", "ON_ERROR_STOP=1"],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  psqlRestore.stdout.on("data", (chunk) => {
    restoreStdout.push(chunk.toString());
  });
  psqlRestore.stderr.on("data", (chunk) => {
    restoreStderr.push(chunk.toString());
  });

  await Promise.all([
    pipeline(
      createReadStream(backupFilePath),
      createGunzip(),
      psqlRestore.stdin,
    ),
    waitForChildExit(psqlRestore, "restore-psql"),
  ]).catch((error) => {
    const details = [restoreStdout.join(""), restoreStderr.join("")].join("").trim();
    if (details) {
      throw new Error(`${toErrorMessage(error)}\n${details}`);
    }
    throw error;
  });

  const tableCountRaw = await runPsql(
    [
      restoreDatabaseUrl,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';",
    ],
    "restore-table-count-check",
  );
  const tableCount = Number.parseInt(tableCountRaw, 10);
  if (!Number.isFinite(tableCount) || tableCount < ensurePositiveInteger(minExpectedTables, 10)) {
    throw new Error(
      `restore sanity check failed: restored table count ${tableCountRaw} is less than expected ${ensurePositiveInteger(minExpectedTables, 10)}`
    );
  }

  const hasSyncRunsRaw = await runPsql(
    [
      restoreDatabaseUrl,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sync_runs');",
    ],
    "restore-sync-runs-check",
  );

  if (hasSyncRunsRaw !== "t") {
    throw new Error("restore sanity check failed: table public.sync_runs is missing");
  }

  return {
    tableCount,
  };
}

async function cleanupOldBackups() {
  const retentionMs = ensurePositiveInteger(retentionDays, 7) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const entries = await readdir(backupDir, { withFileTypes: true });
  const removed = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql.gz")) {
      continue;
    }

    const fullPath = path.join(backupDir, entry.name);
    const info = await stat(fullPath);
    const ageMs = now - info.mtimeMs;
    if (ageMs > retentionMs) {
      await unlink(fullPath);
      removed.push(fullPath);
    }
  }

  return removed;
}

async function main() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!restoreDatabaseUrl) {
    throw new Error("BACKUP_RESTORE_DATABASE_URL is required");
  }

  const sourceIdentity = normalizeDbIdentity(databaseUrl);
  const restoreIdentity = normalizeDbIdentity(restoreDatabaseUrl);
  if (sourceIdentity === restoreIdentity) {
    throw new Error("BACKUP_RESTORE_DATABASE_URL must point to a different database than DATABASE_URL");
  }

  await mkdir(backupDir, { recursive: true });

  const startedAt = new Date();
  const stamp = formatStamp(startedAt);
  const backupFileName = `enterprise-wb-analytics-${stamp}.sql.gz`;
  const backupFilePath = path.join(backupDir, backupFileName);

  console.log(`[backup] creating dump ${backupFilePath}`);
  await runBackup(backupFilePath);

  const restoreSummary = await runRestoreTest(backupFilePath);
  const removed = await cleanupOldBackups();

  const manifestPath = path.join(backupDir, `enterprise-wb-analytics-${stamp}.manifest.json`);
  const manifest = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    backupFilePath,
    sourceDatabase: sourceIdentity,
    restoreDatabase: restoreIdentity,
    restoreSummary,
    retentionDays: ensurePositiveInteger(retentionDays, 7),
    removedBackups: removed,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("[backup] success");
  console.log(`[backup] restore check tables: ${restoreSummary.tableCount}`);
  console.log(`[backup] removed old backups: ${removed.length}`);
  console.log(`[backup] manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error("[backup] failed:", toErrorMessage(error));
  process.exit(1);
});
