# Slice 13 — flip-the-switch: RLS strict policies

Этот документ содержит **draft-миграцию**, которая будет применена в отдельной сессии (Slice 13). Для безопасности SQL положен сюда, а не в `drizzle/`, чтобы не попасть в автоматическое применение при обычном `drizzle-kit migrate`.

## Что делает миграция

Заменяет временную RLS-политику `tenant_isolation` на 50 таблицах с «IS NULL bypass» на **строгую** версию, которая:

1. Разрешает чтение/запись только если `current_setting('app.tenant_id')::uuid = tenant_id`.
2. Допускает один исключительный случай — **admin sentinel UUID** `00000000-0000-0000-0000-000000000000` — для cross-tenant операций (schedulers, user bootstrap, tenant switch, invitation accept).

## Pre-requisites (обязательно до применения)

- [x] P0-03b Slices 1-12 merged и проверены на проде (полное покрытие `withTenantContext` / `withAdminContext`).
- [x] Pre-Slice-13 sweep выполнен (`2c1e432`): stocks.ts, redistribution.ts, advertising.ts, sync-wb.ts обёрнуты.
- [x] `grep -rn 'db\.\(select\|insert\|update\|delete\|execute\|query\|transaction\)' src/ | grep -v 'withTenantContext\|withAdminContext\|rls\.test\|\.test\.\|from tenants$\|from users$'` — пусто кроме `sync-wb.ts:373` (false-positive, `tenants` без RLS) и `sync-wb.ts:1620` REFRESH MV (exempt: CONCURRENTLY prohibited in transaction; MV query runs under MV-owner credentials).
- [ ] Full pg_dump backup на metric-pulse-app-01 через `/backup-db pre-slice-13`.
- [ ] Staging dry-run (если есть staging), или план rollback: `DROP POLICY ... / CREATE POLICY` старая версия.

## Применение (Slice 13)

1. Скопировать SQL ниже в `drizzle/0047_rls_strict.sql` (или следующий свободный номер).
2. Сгенерировать snapshot: `npx drizzle-kit generate --custom` или вручную обновить `drizzle/meta/_journal.json`.
3. Локально: `DATABASE_URL=... psql < drizzle/0047_rls_strict.sql` (проверить на dev-БД).
4. Backup: `ssh metric-pulse-app-01 '/srv/scripts/backup-db.sh pre-slice-13'`.
5. Prod: `ssh metric-pulse-app-01 'cd /srv/projects/enterprise-wb-analytics && git pull && psql $DATABASE_URL -f drizzle/0047_rls_strict.sql'`.
6. Rolling restart `systemctl restart enterprise-wb-analytics.service enterprise-wb-analytics-inngest.service`.
7. Verify: `curl http://localhost:3457/api/health`, случайный smoke test UI, `psql: SELECT count(*) FROM products WHERE tenant_id = '<real>'` под `enterprise_wb_analytics_user` без `SET LOCAL` → должен вернуть 0.

## Rollback

Если что-то ломается, применить revert — скопировать оригинальные policies из `drizzle/0040_rls_enable.sql` и пересоздать. Все запросы сразу вернутся к текущему состоянию (IS-NULL bypass = как есть сейчас).

## SQL — strict policies

```sql
-- Slice 13 / P0-03b: flip-the-switch
-- Replaces IS-NULL bypass with strict tenant check + admin sentinel exception.
--
-- Policy formula:
--   USING / WITH CHECK:
--     current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
--     OR tenant_id = current_setting('app.tenant_id', true)::uuid
--
-- Superuser (postgres) — BYPASSRLS=true, всегда обходит.
-- Роль enterprise_wb_analytics_user — BYPASSRLS=false, проходит через policy.
-- Admin sentinel = выделенный UUID, который явно выставляется через withAdminContext.

-- Таблицы (50 штук):
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'advertising_audit_log',
    'advertising_auto_bid_runs',
    'advertising_auto_bid_strategies',
    'advertising_auto_refill_logs',
    'advertising_auto_refill_settings',
    'advertising_balance_snapshots',
    'advertising_bid_changes',
    'advertising_bid_pacing_rules',
    'advertising_bid_portfolios',
    'advertising_cluster_actions',
    'advertising_dayparting_rules',
    'advertising_guardrail_events',
    'idempotency_keys',
    'invitations',
    'product_groups',
    'production_orders',
    'products',
    'raw_api_ad_clusters',
    'raw_api_ad_costs',
    'raw_api_funnel_stats',
    'raw_api_orders',
    'raw_api_paid_storage',
    'raw_api_prices',
    'raw_api_product_metadata',
    'raw_api_realization_reports',
    'raw_api_region_sales',
    'raw_api_sales',
    'raw_api_stock_offices',
    'raw_api_stock_sizes',
    'raw_api_stocks',
    'redistribution_items',
    'redistribution_route_availability',
    'redistribution_route_availability_events',
    'redistribution_runs',
    'redistribution_slot_monitor_runs',
    'redistribution_warehouse_registry',
    'risk_signals',
    'signal_automation_control_events',
    'signal_automation_runs',
    'signal_automation_suppressions',
    'signal_notification_receipts',
    'signal_operator_timeline',
    'signal_saved_views',
    'stock_planning_inputs',
    'sync_runs',
    'unit_economics_configs',
    'unit_economics_manual_inputs',
    'user_tenants',
    'wb_category_commission_snapshots',
    'wb_tariff_snapshots'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (current_setting(''app.tenant_id'', true)::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                           OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)
                    WITH CHECK (current_setting(''app.tenant_id'', true)::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                                OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)', tbl);
  END LOOP;
END $$;

-- Verify (prod):
--   SELECT policyname, qual FROM pg_policies WHERE policyname = 'tenant_isolation' LIMIT 1;
--     → должен показать новое качество с '00000000-...-0000' sentinel.
--   SET ROLE enterprise_wb_analytics_user; SELECT count(*) FROM products;
--     → 0 (нет SET LOCAL app.tenant_id).
--   SELECT set_config('app.tenant_id', '<real-tenant-uuid>', false); SELECT count(*) FROM products;
--     → реальное число.
--   SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', false); SELECT count(*) FROM products;
--     → count ACROSS ALL tenants.
```

## Rollback SQL (pre-checked)

```sql
-- Revert Slice 13 → restore IS-NULL bypass (as in 0040_rls_enable.sql)
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[/* same 50 tables as above */];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (current_setting(''app.tenant_id'', true) IS NULL
                           OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)
                    WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL
                                OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)', tbl);
  END LOOP;
END $$;
```
