import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || '';

const client = postgres(connectionString, {
  prepare: false,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
  max: Number(process.env.PG_POOL_MAX ?? 15),
  idle_timeout: Number(process.env.PG_IDLE_TIMEOUT ?? 20),
  max_lifetime: Number(process.env.PG_MAX_LIFETIME ?? 1800),
  connect_timeout: Number(process.env.PG_CONNECT_TIMEOUT ?? 10),
  onnotice: () => {},
});

export const db = drizzle(client, { schema });

export type DrizzleDatabase = typeof db;
export type DrizzleTransaction = Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0];

// RLS helper: runs fn inside a transaction with SET LOCAL app.tenant_id.
// Any query under enterprise_wb_analytics_user within fn is constrained
// to rows matching that tenant_id (policy: tenant_isolation).
export async function withTenantContext<T>(
  database: DrizzleDatabase,
  tenantId: string,
  fn: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

// Admin sentinel — specially reserved UUID that the tenant_isolation policy
// treats as "show all tenants". Used for legitimately cross-tenant code
// paths: scheduled sweeps, auth membership checks (pre-tenant-context),
// tenant switch/bootstrap flows.
//
// The policy exception lives in drizzle/0041_rls_strict.sql. Until that
// migration is applied, the IS NULL bypass keeps everything visible; after
// the migration, only this sentinel — or a real tenant match — unblocks
// reads.
//
// SECURITY: never expose withAdminContext to user-controlled code paths.
// Only call it from backend-initiated flows (cron, server actions whose
// whole purpose is cross-tenant).
export const ADMIN_TENANT_SENTINEL = '00000000-0000-0000-0000-000000000000' as const;

export async function withAdminContext<T>(
  database: DrizzleDatabase,
  fn: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${ADMIN_TENANT_SENTINEL}, true)`);
    return fn(tx);
  });
}
