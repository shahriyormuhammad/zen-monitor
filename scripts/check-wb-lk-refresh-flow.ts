/**
 * Safe WB LK refresh-flow check.
 *
 * Usage:
 *   npx tsx scripts/check-wb-lk-refresh-flow.ts --tenant-id <UUID>
 *   npx tsx scripts/check-wb-lk-refresh-flow.ts --all --persist-health
 *
 * The script never prints or stores short-lived LK access tokens.
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

type Options = {
  tenantIds: string[];
  all: boolean;
  persistHealth: boolean;
  soft: boolean;
};

function loadEnv() {
  const cwd = process.cwd();
  for (const rel of ['.env.runtime', '.env.production', '.env']) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: false });
    }
  }
}

function parseArgs(argv: string[]): Options {
  const tenantIds: string[] = [];
  let all = false;
  let persistHealth = false;
  let soft = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--all') {
      all = true;
      continue;
    }
    if (token === '--persist-health') {
      persistHealth = true;
      continue;
    }
    if (token === '--soft') {
      soft = true;
      continue;
    }
    if (token === '--tenant-id') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --tenant-id');
      }
      tenantIds.push(value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!all && tenantIds.length === 0) {
    throw new Error('Usage: npx tsx scripts/check-wb-lk-refresh-flow.ts --tenant-id <UUID> [--persist-health] OR --all [--persist-health]');
  }

  return { tenantIds, all, persistHealth, soft };
}

async function loadRuntimeModules() {
  const dbModule = await import('@/lib/db');
  const schemaModule = await import('@/lib/db/schema');
  const drizzleModule = await import('drizzle-orm');
  const flowModule = await import('@/server/wb/lk-refresh-flow');

  return {
    db: (dbModule as typeof dbModule & { default?: typeof dbModule }).default?.db ?? dbModule.db,
    tenants: (schemaModule as typeof schemaModule & { default?: typeof schemaModule }).default?.tenants ?? schemaModule.tenants,
    sql: drizzleModule.sql,
    checkTenantWbLkRefreshFlow: flowModule.checkTenantWbLkRefreshFlow,
  };
}

async function loadAllTenantIdsWithStorageState(runtime: Awaited<ReturnType<typeof loadRuntimeModules>>) {
  const rows = await runtime.db.select({ id: runtime.tenants.id })
    .from(runtime.tenants)
    .where(runtime.sql`COALESCE(${runtime.tenants.wbLkStorageState}, '') <> ''`);
  return rows.map((row) => row.id);
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const runtime = await loadRuntimeModules();
  const tenantIds = options.all ? await loadAllTenantIdsWithStorageState(runtime) : options.tenantIds;

  const results = [];
  for (const tenantId of tenantIds) {
    results.push(await runtime.checkTenantWbLkRefreshFlow(tenantId, {
      persistHealth: options.persistHealth,
    }));
  }

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    persistHealth: options.persistHealth,
    results,
  }, null, 2));

  if (!options.soft && results.some((result) => !result.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
