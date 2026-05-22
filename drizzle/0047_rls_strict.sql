-- Slice 13 / P0-03b: flip-the-switch — strict RLS policies
-- Replaces IS-NULL bypass (from 0040_rls_enable.sql) with strict tenant check
-- + admin sentinel exception for cross-tenant operations.
--
-- Policy formula (USING / WITH CHECK):
--   current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
--   OR tenant_id = current_setting('app.tenant_id', true)::uuid
--
-- Superuser (postgres) — BYPASSRLS=true, всегда обходит.
-- Роль enterprise_wb_analytics_user — BYPASSRLS=false, проходит через policy.
-- Admin sentinel = '00000000-0000-0000-0000-000000000000' — явно выставляется
-- через withAdminContext для schedulers, user bootstrap, tenant switch, invitation accept.

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
