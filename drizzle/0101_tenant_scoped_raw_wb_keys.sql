ALTER TABLE raw_api_realization_reports
  DROP CONSTRAINT IF EXISTS raw_api_realization_reports_pkey;
--> statement-breakpoint
ALTER TABLE raw_api_orders
  DROP CONSTRAINT IF EXISTS raw_api_orders_pkey;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS raw_api_realization_reports_tenant_rrd_id_unique
  ON raw_api_realization_reports (tenant_id, rrd_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS raw_api_orders_tenant_srid_unique
  ON raw_api_orders (tenant_id, srid);
