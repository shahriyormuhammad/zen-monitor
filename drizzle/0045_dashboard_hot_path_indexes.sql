-- Hot-path indexes for the dashboard (KPI + daily P&L + unit economics + data trust).
-- Prior to this migration the key tables either lacked a (tenant_id, date) covering
-- index or forced a scan through storno/cancelled rows that the analytics queries
-- filter out in every case.

-- raw_api_paid_storage: existing composite is (tenant_id, nm_id, warehouse_name, date),
-- which cannot serve "WHERE tenant_id = $1 AND date BETWEEN $2 AND $3" efficiently.
CREATE INDEX IF NOT EXISTS "paid_storage_tenant_date_idx"
  ON "raw_api_paid_storage" ("tenant_id", "date");
--> statement-breakpoint

-- raw_api_sales: analytics never read stornoed rows. A partial index matches the
-- effective working set (typically 70–95% of the base) and is smaller / hotter.
CREATE INDEX IF NOT EXISTS "sales_tenant_date_active_idx"
  ON "raw_api_sales" ("tenant_id", "date")
  WHERE "is_storno" = false;
--> statement-breakpoint

-- raw_api_orders: same pattern — cancelled orders are filtered out of every read.
CREATE INDEX IF NOT EXISTS "orders_tenant_date_active_idx"
  ON "raw_api_orders" ("tenant_id", "date")
  WHERE "is_cancel" = false;
--> statement-breakpoint

-- raw_api_funnel_stats: the unique composite helps range scans by period_start,
-- but daily snapshots (period_start::date = period_end::date) are read from several
-- CTEs per request. A narrower partial index targets that hot path.
CREATE INDEX IF NOT EXISTS "funnel_stats_tenant_daily_idx"
  ON "raw_api_funnel_stats" ("tenant_id", "period_start", "nm_id")
  WHERE "period_start" = "period_end";
