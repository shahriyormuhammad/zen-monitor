#!/usr/bin/env node
/*
 * Custom database migrator. Replaces `drizzle-kit migrate`.
 *
 * Why a custom script:
 *   drizzle-kit 0.31.10 can silently skip pending migrations while reporting
 *   "applied successfully" — see deploy log 2026-04-19, where migrations 0045
 *   and 0046 were not applied but the CLI claimed success. This script reads
 *   `drizzle/meta/_journal.json`, computes SHA256 for each migration file,
 *   compares against `drizzle.__drizzle_migrations.hash`, and applies missing
 *   ones via plain psql-style statements. No silent skips.
 *
 * Usage: `npm run db:migrate` (invokes this file via package.json).
 *
 * Per-migration execution:
 *   - Statements are split on `--> statement-breakpoint`.
 *   - By default, each migration is applied inside one transaction so that
 *     partial failure rolls back cleanly.
 *   - If the SQL file contains the marker `-- @no-transaction` anywhere in
 *     the first 10 lines, the migration runs OUTSIDE a transaction. Use this
 *     for statements that Postgres rejects inside transactions, e.g.
 *     `CREATE INDEX CONCURRENTLY` or `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
 *   - The insert into `__drizzle_migrations` happens in the same transaction
 *     as the migration (or as a separate statement right after in no-tx mode)
 *     so hash is recorded iff all statements succeeded.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, 'drizzle');
const journalPath = path.join(migrationsDir, 'meta', '_journal.json');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[db:migrate] DATABASE_URL is not set (expected in .env or environment)');
  process.exit(1);
}

const NO_TX_MARKER = /--\s*@no-transaction\b/i;

function log(message) {
  console.log(`[db:migrate] ${message}`);
}

function loadJournal() {
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  return journal.entries.map((entry) => {
    const filePath = path.join(migrationsDir, `${entry.tag}.sql`);
    const content = fs.readFileSync(filePath, 'utf8');
    const firstLines = content.split('\n').slice(0, 10).join('\n');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      filePath,
      hash,
      statements,
      requiresNoTransaction: NO_TX_MARKER.test(firstLines),
    };
  });
}

async function ensureMigrationsTable(sql) {
  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);
}

async function fetchAppliedHashes(sql) {
  const rows = await sql`SELECT hash FROM drizzle.__drizzle_migrations`;
  return new Set(rows.map((r) => r.hash));
}

async function applyMigrationInTransaction(sql, migration) {
  await sql.begin(async (tx) => {
    for (const stmt of migration.statements) {
      await tx.unsafe(stmt);
    }
    await tx`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${migration.hash}, ${migration.when})
    `;
  });
}

async function applyMigrationNoTransaction(sql, migration) {
  for (const stmt of migration.statements) {
    await sql.unsafe(stmt);
  }
  await sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${migration.hash}, ${migration.when})
  `;
}

async function main() {
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await ensureMigrationsTable(sql);
    const applied = await fetchAppliedHashes(sql);
    const migrations = loadJournal();

    const pending = migrations.filter((m) => !applied.has(m.hash));
    if (pending.length === 0) {
      log(`0 pending (${migrations.length} total, all applied)`);
      return;
    }

    log(`${pending.length} pending of ${migrations.length} total`);
    for (const migration of pending) {
      const mode = migration.requiresNoTransaction ? 'NO-TX' : 'TX';
      log(`applying ${migration.tag} [${migration.statements.length} stmt${migration.statements.length === 1 ? '' : 's'}, ${mode}]`);
      try {
        if (migration.requiresNoTransaction) {
          await applyMigrationNoTransaction(sql, migration);
        } else {
          await applyMigrationInTransaction(sql, migration);
        }
        log(`✓ ${migration.tag}`);
      } catch (err) {
        log(`✗ ${migration.tag} failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    }
    log(`done — applied ${pending.length} migration${pending.length === 1 ? '' : 's'}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[db:migrate] FATAL:', err);
  process.exit(1);
});
