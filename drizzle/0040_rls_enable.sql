-- P0-03: Enable Row-Level Security on all tenant-scoped tables
--
-- Strategy: IS-NULL bypass so Inngest/service code (no SET LOCAL) sees all rows,
-- while any code that calls SET LOCAL app.tenant_id is constrained to that tenant.
-- Role enterprise_wb_analytics_user has BYPASSRLS=false → policies apply.
-- Superuser postgres has BYPASSRLS=true → always bypasses (migrations, psql admin).
--
-- Policy formula:
--   USING / WITH CHECK:
--     current_setting('app.tenant_id', true) IS NULL
--     OR tenant_id = current_setting('app.tenant_id', true)::uuid
--
-- Tables excluded: users (tenant_id is nullable "active tenant" pointer, not owner)
--                  tenants (no tenant_id column, root table)

-- Helper macro (repeated per table for explicit, grep-friendly SQL):

------------------------------------------------------------
-- advertising_audit_log
------------------------------------------------------------
ALTER TABLE advertising_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_audit_log;
CREATE POLICY tenant_isolation ON advertising_audit_log
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_auto_bid_runs
------------------------------------------------------------
ALTER TABLE advertising_auto_bid_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_auto_bid_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_auto_bid_runs;
CREATE POLICY tenant_isolation ON advertising_auto_bid_runs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_auto_bid_strategies
------------------------------------------------------------
ALTER TABLE advertising_auto_bid_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_auto_bid_strategies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_auto_bid_strategies;
CREATE POLICY tenant_isolation ON advertising_auto_bid_strategies
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_auto_refill_logs
------------------------------------------------------------
ALTER TABLE advertising_auto_refill_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_auto_refill_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_auto_refill_logs;
CREATE POLICY tenant_isolation ON advertising_auto_refill_logs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_auto_refill_settings
------------------------------------------------------------
ALTER TABLE advertising_auto_refill_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_auto_refill_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_auto_refill_settings;
CREATE POLICY tenant_isolation ON advertising_auto_refill_settings
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_balance_snapshots
------------------------------------------------------------
ALTER TABLE advertising_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_balance_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_balance_snapshots;
CREATE POLICY tenant_isolation ON advertising_balance_snapshots
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_bid_changes
------------------------------------------------------------
ALTER TABLE advertising_bid_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_bid_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_bid_changes;
CREATE POLICY tenant_isolation ON advertising_bid_changes
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_bid_pacing_rules
------------------------------------------------------------
ALTER TABLE advertising_bid_pacing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_bid_pacing_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_bid_pacing_rules;
CREATE POLICY tenant_isolation ON advertising_bid_pacing_rules
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_bid_portfolios
------------------------------------------------------------
ALTER TABLE advertising_bid_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_bid_portfolios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_bid_portfolios;
CREATE POLICY tenant_isolation ON advertising_bid_portfolios
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_cluster_actions
------------------------------------------------------------
ALTER TABLE advertising_cluster_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_cluster_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_cluster_actions;
CREATE POLICY tenant_isolation ON advertising_cluster_actions
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_dayparting_rules
------------------------------------------------------------
ALTER TABLE advertising_dayparting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_dayparting_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_dayparting_rules;
CREATE POLICY tenant_isolation ON advertising_dayparting_rules
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- advertising_guardrail_events
------------------------------------------------------------
ALTER TABLE advertising_guardrail_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertising_guardrail_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advertising_guardrail_events;
CREATE POLICY tenant_isolation ON advertising_guardrail_events
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- idempotency_keys
------------------------------------------------------------
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON idempotency_keys;
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- invitations
------------------------------------------------------------
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON invitations;
CREATE POLICY tenant_isolation ON invitations
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- product_groups
------------------------------------------------------------
ALTER TABLE product_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_groups;
CREATE POLICY tenant_isolation ON product_groups
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- production_orders
------------------------------------------------------------
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON production_orders;
CREATE POLICY tenant_isolation ON production_orders
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- products
------------------------------------------------------------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON products;
CREATE POLICY tenant_isolation ON products
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_ad_clusters
------------------------------------------------------------
ALTER TABLE raw_api_ad_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_ad_clusters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_ad_clusters;
CREATE POLICY tenant_isolation ON raw_api_ad_clusters
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_ad_costs
------------------------------------------------------------
ALTER TABLE raw_api_ad_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_ad_costs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_ad_costs;
CREATE POLICY tenant_isolation ON raw_api_ad_costs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_funnel_stats
------------------------------------------------------------
ALTER TABLE raw_api_funnel_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_funnel_stats FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_funnel_stats;
CREATE POLICY tenant_isolation ON raw_api_funnel_stats
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_orders
------------------------------------------------------------
ALTER TABLE raw_api_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_orders;
CREATE POLICY tenant_isolation ON raw_api_orders
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_paid_storage
------------------------------------------------------------
ALTER TABLE raw_api_paid_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_paid_storage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_paid_storage;
CREATE POLICY tenant_isolation ON raw_api_paid_storage
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_prices
------------------------------------------------------------
ALTER TABLE raw_api_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_prices;
CREATE POLICY tenant_isolation ON raw_api_prices
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_product_metadata
------------------------------------------------------------
ALTER TABLE raw_api_product_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_product_metadata FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_product_metadata;
CREATE POLICY tenant_isolation ON raw_api_product_metadata
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_realization_reports
------------------------------------------------------------
ALTER TABLE raw_api_realization_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_realization_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_realization_reports;
CREATE POLICY tenant_isolation ON raw_api_realization_reports
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_region_sales
------------------------------------------------------------
ALTER TABLE raw_api_region_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_region_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_region_sales;
CREATE POLICY tenant_isolation ON raw_api_region_sales
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_sales
------------------------------------------------------------
ALTER TABLE raw_api_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_sales;
CREATE POLICY tenant_isolation ON raw_api_sales
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_stock_offices
------------------------------------------------------------
ALTER TABLE raw_api_stock_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_stock_offices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_stock_offices;
CREATE POLICY tenant_isolation ON raw_api_stock_offices
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_stock_sizes
------------------------------------------------------------
ALTER TABLE raw_api_stock_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_stock_sizes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_stock_sizes;
CREATE POLICY tenant_isolation ON raw_api_stock_sizes
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- raw_api_stocks
------------------------------------------------------------
ALTER TABLE raw_api_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_api_stocks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raw_api_stocks;
CREATE POLICY tenant_isolation ON raw_api_stocks
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- redistribution_items
------------------------------------------------------------
ALTER TABLE redistribution_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE redistribution_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON redistribution_items;
CREATE POLICY tenant_isolation ON redistribution_items
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- redistribution_route_availability
------------------------------------------------------------
ALTER TABLE redistribution_route_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE redistribution_route_availability FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON redistribution_route_availability;
CREATE POLICY tenant_isolation ON redistribution_route_availability
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- redistribution_route_availability_events
------------------------------------------------------------
ALTER TABLE redistribution_route_availability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE redistribution_route_availability_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON redistribution_route_availability_events;
CREATE POLICY tenant_isolation ON redistribution_route_availability_events
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- redistribution_runs
------------------------------------------------------------
ALTER TABLE redistribution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE redistribution_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON redistribution_runs;
CREATE POLICY tenant_isolation ON redistribution_runs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- redistribution_slot_monitor_runs
------------------------------------------------------------
ALTER TABLE redistribution_slot_monitor_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE redistribution_slot_monitor_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON redistribution_slot_monitor_runs;
CREATE POLICY tenant_isolation ON redistribution_slot_monitor_runs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- redistribution_warehouse_registry
------------------------------------------------------------
ALTER TABLE redistribution_warehouse_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE redistribution_warehouse_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON redistribution_warehouse_registry;
CREATE POLICY tenant_isolation ON redistribution_warehouse_registry
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- risk_signals
------------------------------------------------------------
ALTER TABLE risk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_signals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON risk_signals;
CREATE POLICY tenant_isolation ON risk_signals
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- signal_automation_control_events
------------------------------------------------------------
ALTER TABLE signal_automation_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_automation_control_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signal_automation_control_events;
CREATE POLICY tenant_isolation ON signal_automation_control_events
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- signal_automation_runs
------------------------------------------------------------
ALTER TABLE signal_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_automation_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signal_automation_runs;
CREATE POLICY tenant_isolation ON signal_automation_runs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- signal_automation_suppressions
------------------------------------------------------------
ALTER TABLE signal_automation_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_automation_suppressions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signal_automation_suppressions;
CREATE POLICY tenant_isolation ON signal_automation_suppressions
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- signal_notification_receipts
------------------------------------------------------------
ALTER TABLE signal_notification_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_notification_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signal_notification_receipts;
CREATE POLICY tenant_isolation ON signal_notification_receipts
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- signal_operator_timeline
------------------------------------------------------------
ALTER TABLE signal_operator_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_operator_timeline FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signal_operator_timeline;
CREATE POLICY tenant_isolation ON signal_operator_timeline
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- signal_saved_views
------------------------------------------------------------
ALTER TABLE signal_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_saved_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON signal_saved_views;
CREATE POLICY tenant_isolation ON signal_saved_views
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- stock_planning_inputs
------------------------------------------------------------
ALTER TABLE stock_planning_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_planning_inputs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_planning_inputs;
CREATE POLICY tenant_isolation ON stock_planning_inputs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- sync_runs
------------------------------------------------------------
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sync_runs;
CREATE POLICY tenant_isolation ON sync_runs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- unit_economics_configs
------------------------------------------------------------
ALTER TABLE unit_economics_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_economics_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unit_economics_configs;
CREATE POLICY tenant_isolation ON unit_economics_configs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- unit_economics_manual_inputs
------------------------------------------------------------
ALTER TABLE unit_economics_manual_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_economics_manual_inputs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unit_economics_manual_inputs;
CREATE POLICY tenant_isolation ON unit_economics_manual_inputs
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- user_tenants
------------------------------------------------------------
ALTER TABLE user_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_tenants;
CREATE POLICY tenant_isolation ON user_tenants
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- wb_category_commission_snapshots
------------------------------------------------------------
ALTER TABLE wb_category_commission_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_category_commission_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wb_category_commission_snapshots;
CREATE POLICY tenant_isolation ON wb_category_commission_snapshots
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);

------------------------------------------------------------
-- wb_tariff_snapshots
------------------------------------------------------------
ALTER TABLE wb_tariff_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE wb_tariff_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON wb_tariff_snapshots;
CREATE POLICY tenant_isolation ON wb_tariff_snapshots
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);
