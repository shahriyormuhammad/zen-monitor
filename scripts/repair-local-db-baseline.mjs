#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const rootDir = process.cwd();
const schemaPath = path.join(rootDir, 'src/lib/db/schema.ts');
const journalPath = path.join(rootDir, 'drizzle/meta/_journal.json');

const sql = postgres(DATABASE_URL, { prepare: false });

function log(message) {
  console.log(`[db:repair-local] ${message}`);
}

function loadExpectedTables() {
  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  return [...schemaText.matchAll(/pgTable\('([^']+)'/g)].map((match) => match[1]).sort();
}

function loadMigrations() {
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

  return journal.entries.map((entry) => {
    const filePath = path.join(rootDir, 'drizzle', `${entry.tag}.sql`);
    const rawSql = fs.readFileSync(filePath, 'utf8');

    return {
      tag: entry.tag,
      folderMillis: entry.when,
      hash: crypto.createHash('sha256').update(rawSql).digest('hex'),
      statements: rawSql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean),
    };
  });
}

async function getPublicTables() {
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;

  return rows.map((row) => row.table_name);
}

async function assertColumnExists(tableName, columnName) {
  const rows = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `;

  if (rows.length === 0) {
    throw new Error(`Expected column public.${tableName}.${columnName} to exist before bootstraping migration metadata`);
  }
}

async function assertSentinelState() {
  await assertColumnExists('users', 'tenant_id');
  await assertColumnExists('products', 'is_hidden');
  await assertColumnExists('tenants', 'shop_name');
  await assertColumnExists('tenants', 'tax_type');
  await assertColumnExists('tenants', 'tax_rate');
  await assertColumnExists('tenants', 'telegram_chat_id');
  await assertColumnExists('tenants', 'notifications_enabled');
  await assertColumnExists('raw_api_realization_reports', 'box_delivery_base');
  await assertColumnExists('raw_api_realization_reports', 'box_delivery_liter');
  await assertColumnExists('raw_api_realization_reports', 'box_storage_base');
  await assertColumnExists('raw_api_realization_reports', 'box_storage_liter');
  await assertColumnExists('raw_api_realization_reports', 'payment_schedule_rub');
}

async function getMissingColumns(tableName, columnNames) {
  const rows = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
  `;

  const existing = new Set(rows.map((row) => row.column_name));
  return columnNames.filter((columnName) => !existing.has(columnName));
}

async function ensureMigrationStore() {
  await sql.unsafe(`create schema if not exists "${MIGRATIONS_SCHEMA}"`);
  await sql.unsafe(`
    create table if not exists "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
}

async function getRecordedMigrationMillis() {
  const rows = await sql.unsafe(`
    select created_at
    from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
    order by created_at asc
  `);

  return new Set(rows.map((row) => Number(row.created_at)));
}

async function executeStatements(label, statements) {
  if (statements.length === 0) {
    return;
  }

  log(`Applying repair statements for ${label}`);
  await sql.begin(async (tx) => {
    for (const statement of statements) {
      await tx.unsafe(statement);
    }
  });
}

async function repairKnownGaps(migrations, existingTables) {
  const missingTables = loadExpectedTables().filter((tableName) => !existingTables.includes(tableName));
  const allowedGaps = new Set([
    'raw_api_prices',
    'signal_automation_control_events',
    'signal_automation_runs',
    'signal_automation_suppressions',
    'signal_notification_receipts',
    'signal_operator_timeline',
    'signal_saved_views',
    'sync_runs',
  ]);
  const unknownMissing = missingTables.filter((tableName) => !allowedGaps.has(tableName));

  if (unknownMissing.length > 0) {
    throw new Error(`Local DB is missing unexpected tables: ${unknownMissing.join(', ')}`);
  }

  if (existingTables.length === 0) {
    log('Empty public schema detected, applying all committed migrations from scratch');
    for (const migration of migrations) {
      await executeStatements(migration.tag, migration.statements);
    }
    return;
  }

  await assertSentinelState();

  if (missingTables.includes('raw_api_prices')) {
    const migration = migrations.find((item) => item.tag === '0001_swift_the_stranger');
    if (!migration) {
      throw new Error('Cannot find migration 0001_swift_the_stranger');
    }

    const priceStatements = migration.statements.filter((statement) => statement.includes('"raw_api_prices"') || statement.includes('"tenant_nm_price_idx"'));
    await executeStatements('0001 raw_api_prices gap', priceStatements);
  }

  if (missingTables.includes('sync_runs')) {
    const migration = migrations.find((item) => item.tag === '0002_simple_lightspeed');
    if (!migration) {
      throw new Error('Cannot find migration 0002_simple_lightspeed');
    }

    await executeStatements('0002 sync_runs gap', migration.statements);
  }

  const missingTenantHealthColumns = await getMissingColumns('tenants', [
    'wb_token_health_status',
    'wb_token_checked_at',
    'wb_token_health_summary',
  ]);

  if (missingTenantHealthColumns.length > 0) {
    const migration = migrations.find((item) => item.tag === '0003_condemned_vermin');
    if (!migration) {
      throw new Error('Cannot find migration 0003_condemned_vermin');
    }

    const tokenHealthStatements = migration.statements.filter((statement) =>
      missingTenantHealthColumns.some((columnName) => statement.includes(`"${columnName}"`))
    );

    await executeStatements('0003 tenant token health gap', tokenHealthStatements);
  }

  if (missingTables.includes('signal_operator_timeline')) {
    const migration = migrations.find((item) => item.tag === '0004_overjoyed_lionheart');
    if (!migration) {
      throw new Error('Cannot find migration 0004_overjoyed_lionheart');
    }

    await executeStatements('0004 signal operator timeline gap', migration.statements);
  }

  const missingUserEmailColumns = await getMissingColumns('users', ['email']);
  const missingRiskSignalWorkflowColumns = await getMissingColumns('risk_signals', [
    'workflow_state',
    'assignee_user_id',
    'assignee_email',
    'workflow_updated_at',
    'workflow_updated_by_user_id',
    'workflow_updated_by_email',
  ]);
  const missingSignalTimelineColumns = await getMissingColumns('signal_operator_timeline', [
    'event_type',
    'event_body',
    'event_payload',
  ]);

  if (
    missingUserEmailColumns.length > 0 ||
    missingRiskSignalWorkflowColumns.length > 0 ||
    missingSignalTimelineColumns.length > 0
  ) {
    const migration = migrations.find((item) => item.tag === '0005_volatile_vin_gonzales');
    if (!migration) {
      throw new Error('Cannot find migration 0005_volatile_vin_gonzales');
    }

    const needsRiskSignalIndexes = missingRiskSignalWorkflowColumns.includes('assignee_user_id');
    const needsSignalTimelineIndex = missingSignalTimelineColumns.includes('event_type');
    const needsAssigneeConstraint = missingRiskSignalWorkflowColumns.includes('assignee_user_id');
    const needsWorkflowUpdatedByConstraint = missingRiskSignalWorkflowColumns.includes('workflow_updated_by_user_id');

    const repairStatements = migration.statements.filter((statement) => {
      if (missingUserEmailColumns.some((columnName) => statement.includes(`"${columnName}"`))) {
        return true;
      }

      if (missingRiskSignalWorkflowColumns.some((columnName) => statement.includes(`"${columnName}"`))) {
        return true;
      }

      if (missingSignalTimelineColumns.some((columnName) => statement.includes(`"${columnName}"`))) {
        return true;
      }

      if (needsAssigneeConstraint && statement.includes('"risk_signals_assignee_user_id_users_id_fk"')) {
        return true;
      }

      if (needsWorkflowUpdatedByConstraint && statement.includes('"risk_signals_workflow_updated_by_user_id_users_id_fk"')) {
        return true;
      }

      if (needsRiskSignalIndexes && statement.includes('"risk_assignee_idx"')) {
        return true;
      }

      if (needsSignalTimelineIndex && statement.includes('"signal_operator_timeline_event_idx"')) {
        return true;
      }

      return false;
    });

    await executeStatements('0005 collaboration workflow gap', repairStatements);
  }

  if (missingTables.includes('signal_notification_receipts')) {
    const migration = migrations.find((item) => item.tag === '0006_fearless_gambit');
    if (!migration) {
      throw new Error('Cannot find migration 0006_fearless_gambit');
    }

    await executeStatements('0006 signal notification receipts gap', migration.statements);
  }

  const missingTenantNotificationPreferenceColumns = await getMissingColumns('tenants', [
    'telegram_signal_notification_prefs',
  ]);
  const missingUserTenantNotificationPreferenceColumns = await getMissingColumns('user_tenants', [
    'in_app_signal_notification_prefs',
  ]);

  if (
    missingTenantNotificationPreferenceColumns.length > 0 ||
    missingUserTenantNotificationPreferenceColumns.length > 0
  ) {
    const migration = migrations.find((item) => item.tag === '0007_thin_shape');
    if (!migration) {
      throw new Error('Cannot find migration 0007_thin_shape');
    }

    const repairStatements = migration.statements.filter((statement) =>
      missingTenantNotificationPreferenceColumns.some((columnName) => statement.includes(`"${columnName}"`))
      || missingUserTenantNotificationPreferenceColumns.some((columnName) => statement.includes(`"${columnName}"`))
    );

    await executeStatements('0007 signal notification preferences gap', repairStatements);
  }

  if (missingTables.includes('signal_saved_views')) {
    const migration = migrations.find((item) => item.tag === '0008_mysterious_marrow');
    if (!migration) {
      throw new Error('Cannot find migration 0008_mysterious_marrow');
    }

    await executeStatements('0008 signal saved views gap', migration.statements);
  }

  const missingSignalSavedViewColumns = await getMissingColumns('signal_saved_views', [
    'is_default',
  ]);

  if (missingSignalSavedViewColumns.length > 0) {
    const migration = migrations.find((item) => item.tag === '0009_daffy_peter_parker');
    if (!migration) {
      throw new Error('Cannot find migration 0009_daffy_peter_parker');
    }

    const repairStatements = migration.statements.filter((statement) =>
      missingSignalSavedViewColumns.some((columnName) => statement.includes(`"${columnName}"`))
      || statement.includes('"signal_saved_views_user_default_idx"')
    );

    await executeStatements('0009 signal saved view default gap', repairStatements);
  }

  const missingSignalSavedViewWorkflowColumns = await getMissingColumns('signal_saved_views', [
    'scope',
    'sort_preset',
    'is_pinned',
    'position',
  ]);

  if (missingSignalSavedViewWorkflowColumns.length > 0) {
    const migration = migrations.find((item) => item.tag === '0010_silly_vance_astro');
    if (!migration) {
      throw new Error('Cannot find migration 0010_silly_vance_astro');
    }

    const repairStatements = migration.statements.filter((statement) =>
      missingSignalSavedViewWorkflowColumns.some((columnName) => statement.includes(`"${columnName}"`))
      || statement.includes('"signal_saved_views_scope_position_idx"')
    );

    await executeStatements('0010 signal saved view workflow gap', repairStatements);
  }

  const missingSignalSavedViewOwnershipColumns = await getMissingColumns('signal_saved_views', [
    'shared_owner_user_id',
    'shared_owner_email',
  ]);

  if (missingTables.includes('signal_automation_runs') || missingSignalSavedViewOwnershipColumns.length > 0) {
    const migration = migrations.find((item) => item.tag === '0011_hesitant_rictor');
    if (!migration) {
      throw new Error('Cannot find migration 0011_hesitant_rictor');
    }

    const repairStatements = migration.statements.filter((statement) => {
      if (missingTables.includes('signal_automation_runs') && (
        statement.includes('"signal_automation_runs"')
        || statement.includes('"signal_automation_runs_')
      )) {
        return true;
      }

      if (missingSignalSavedViewOwnershipColumns.some((columnName) => statement.includes(`"${columnName}"`))) {
        return true;
      }

      if (
        missingSignalSavedViewOwnershipColumns.includes('shared_owner_user_id')
        && statement.includes('"signal_saved_views_shared_owner_user_id_users_id_fk"')
      ) {
        return true;
      }

      return false;
    });

    await executeStatements('0011 signal automation workload gap', repairStatements);
  }

  if (missingTables.includes('signal_automation_suppressions')) {
    const migration = migrations.find((item) => item.tag === '0012_public_brood');
    if (!migration) {
      throw new Error('Cannot find migration 0012_public_brood');
    }

    await executeStatements('0012 signal automation suppressions gap', migration.statements);
  }

  const missingSignalAutomationSuppressionLifecycleColumns = await getMissingColumns('signal_automation_suppressions', [
    'reason',
    'suppress_until',
    'cleared_at',
    'cleared_by_user_id',
    'cleared_by_email',
    'cleared_by_role',
    'clear_reason',
  ]);

  if (
    missingTables.includes('signal_automation_control_events')
    || missingSignalAutomationSuppressionLifecycleColumns.length > 0
  ) {
    const migration = migrations.find((item) => item.tag === '0013_fixed_nebula');
    if (!migration) {
      throw new Error('Cannot find migration 0013_fixed_nebula');
    }

    const repairStatements = migration.statements.filter((statement) => {
      if (missingTables.includes('signal_automation_control_events') && (
        statement.includes('"signal_automation_control_events"')
        || statement.includes('"signal_automation_control_events_')
      )) {
        return true;
      }

      if (missingSignalAutomationSuppressionLifecycleColumns.some((columnName) => statement.includes(`"${columnName}"`))) {
        return true;
      }

      if (
        missingSignalAutomationSuppressionLifecycleColumns.includes('cleared_by_user_id')
        && statement.includes('"signal_automation_suppressions_cleared_by_user_id_users_id_fk"')
      ) {
        return true;
      }

      if (
        missingSignalAutomationSuppressionLifecycleColumns.length > 0
        && statement.includes('"signal_automation_suppressions_active_idx"')
      ) {
        return true;
      }

      return false;
    });

    await executeStatements('0013 signal automation governance gap', repairStatements);
  }
}

async function recordMigrationMetadata(migrations) {
  await ensureMigrationStore();
  const recorded = await getRecordedMigrationMillis();

  for (const migration of migrations) {
    if (recorded.has(migration.folderMillis)) {
      continue;
    }

    await sql.unsafe(
      `insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") values ($1, $2)`,
      [migration.hash, migration.folderMillis]
    );
    log(`Recorded migration metadata for ${migration.tag}`);
  }
}

async function verifyFinalState(expectedTables) {
  const actualTables = await getPublicTables();
  const missing = expectedTables.filter((tableName) => !actualTables.includes(tableName));

  if (missing.length > 0) {
    throw new Error(`DB repair finished with missing tables still present: ${missing.join(', ')}`);
  }

  const migrationRows = await sql.unsafe(`
    select hash, created_at
    from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"
    order by created_at asc
  `);

  if (migrationRows.length === 0) {
    throw new Error('Migration metadata is still empty after repair');
  }

  await assertColumnExists('tenants', 'wb_token_health_status');
  await assertColumnExists('tenants', 'wb_token_checked_at');
  await assertColumnExists('tenants', 'wb_token_health_summary');
  await assertColumnExists('users', 'email');
  await assertColumnExists('risk_signals', 'workflow_state');
  await assertColumnExists('risk_signals', 'assignee_user_id');
  await assertColumnExists('risk_signals', 'assignee_email');
  await assertColumnExists('risk_signals', 'workflow_updated_at');
  await assertColumnExists('risk_signals', 'workflow_updated_by_user_id');
  await assertColumnExists('risk_signals', 'workflow_updated_by_email');
  await assertColumnExists('signal_operator_timeline', 'event_type');
  await assertColumnExists('signal_operator_timeline', 'event_body');
  await assertColumnExists('signal_operator_timeline', 'event_payload');
  await assertColumnExists('signal_notification_receipts', 'event_id');
  await assertColumnExists('signal_notification_receipts', 'user_id');
  await assertColumnExists('signal_notification_receipts', 'read_at');
  await assertColumnExists('signal_notification_receipts', 'acknowledged_at');
  await assertColumnExists('tenants', 'telegram_signal_notification_prefs');
  await assertColumnExists('user_tenants', 'in_app_signal_notification_prefs');
  await assertColumnExists('signal_saved_views', 'tenant_id');
  await assertColumnExists('signal_saved_views', 'user_id');
  await assertColumnExists('signal_saved_views', 'queue_view');
  await assertColumnExists('signal_saved_views', 'assignee_filter');
  await assertColumnExists('signal_saved_views', 'workflow_filter');
  await assertColumnExists('signal_saved_views', 'is_default');
  await assertColumnExists('signal_saved_views', 'scope');
  await assertColumnExists('signal_saved_views', 'sort_preset');
  await assertColumnExists('signal_saved_views', 'is_pinned');
  await assertColumnExists('signal_saved_views', 'position');
  await assertColumnExists('signal_saved_views', 'shared_owner_user_id');
  await assertColumnExists('signal_saved_views', 'shared_owner_email');
  await assertColumnExists('signal_automation_runs', 'tenant_id');
  await assertColumnExists('signal_automation_runs', 'automation_source');
  await assertColumnExists('signal_automation_runs', 'trigger_type');
  await assertColumnExists('signal_automation_runs', 'saved_view_id');
  await assertColumnExists('signal_automation_runs', 'shared_owner_user_id');
  await assertColumnExists('signal_automation_runs', 'eligible_count');
  await assertColumnExists('signal_automation_runs', 'affected_count');
  await assertColumnExists('signal_automation_runs', 'skipped_count');
  await assertColumnExists('signal_automation_runs', 'applied_presets');
  await assertColumnExists('signal_automation_runs', 'status');
  await assertColumnExists('signal_automation_suppressions', 'tenant_id');
  await assertColumnExists('signal_automation_suppressions', 'target_type');
  await assertColumnExists('signal_automation_suppressions', 'saved_view_id');
  await assertColumnExists('signal_automation_suppressions', 'shared_owner_user_id');
  await assertColumnExists('signal_automation_suppressions', 'actor_email');
  await assertColumnExists('signal_automation_suppressions', 'reason');
  await assertColumnExists('signal_automation_suppressions', 'suppress_until');
  await assertColumnExists('signal_automation_suppressions', 'cleared_at');
  await assertColumnExists('signal_automation_suppressions', 'cleared_by_user_id');
  await assertColumnExists('signal_automation_control_events', 'tenant_id');
  await assertColumnExists('signal_automation_control_events', 'event_type');
  await assertColumnExists('signal_automation_control_events', 'trigger_type');
  await assertColumnExists('signal_automation_control_events', 'linked_event_id');
  await assertColumnExists('signal_automation_control_events', 'automation_run_id');
  await assertColumnExists('signal_automation_control_events', 'matched_suppression_count');

  return {
    tables: actualTables.length,
    migrationRows: migrationRows.length,
  };
}

async function main() {
  const expectedTables = loadExpectedTables();
  const migrations = loadMigrations();
  const existingTables = await getPublicTables();

  log(`Detected ${existingTables.length} public tables before repair`);
  await repairKnownGaps(migrations, existingTables);
  await recordMigrationMetadata(migrations);
  const finalState = await verifyFinalState(expectedTables);

  log(`Local DB baseline is healthy: ${finalState.tables} public tables, ${finalState.migrationRows} recorded migrations`);
}

try {
  await main();
} catch (error) {
  console.error(`[db:repair-local] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
