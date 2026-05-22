-- @no-transaction
-- Harden RAW composite uniqueness for nullable key columns.
-- PostgreSQL default UNIQUE treats NULLs as distinct, which allows semantic duplicates.
-- We rebuild affected indexes with NULLS NOT DISTINCT.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ad_costs_composite_idx_nnd
  ON raw_api_ad_costs USING btree (tenant_id, nm_id, date, placement) NULLS NOT DISTINCT;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS ad_costs_composite_idx;
--> statement-breakpoint
ALTER INDEX IF EXISTS ad_costs_composite_idx_nnd RENAME TO ad_costs_composite_idx;
--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS paid_storage_composite_idx_nnd
  ON raw_api_paid_storage USING btree (tenant_id, nm_id, warehouse_name, date) NULLS NOT DISTINCT;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS paid_storage_composite_idx;
--> statement-breakpoint
ALTER INDEX IF EXISTS paid_storage_composite_idx_nnd RENAME TO paid_storage_composite_idx;
--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS stock_offices_composite_idx_nnd
  ON raw_api_stock_offices USING btree (tenant_id, snapshot_date, stock_type, region_name, office_id, office_name) NULLS NOT DISTINCT;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS stock_offices_composite_idx;
--> statement-breakpoint
ALTER INDEX IF EXISTS stock_offices_composite_idx_nnd RENAME TO stock_offices_composite_idx;
--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS stock_sizes_composite_idx_nnd
  ON raw_api_stock_sizes USING btree (tenant_id, snapshot_date, stock_type, nm_id, size_name, chrt_id, region_name, office_id, office_name) NULLS NOT DISTINCT;
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS stock_sizes_composite_idx;
--> statement-breakpoint
ALTER INDEX IF EXISTS stock_sizes_composite_idx_nnd RENAME TO stock_sizes_composite_idx;
