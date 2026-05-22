-- Materialized view of the "final" dashboard rollup per (tenant, day, nm_id).
-- Powers the dashboard daily P&L, KPIs, and unit economics without rescanning
-- raw_api_realization_reports + computing per-row aggregates on every request.
--
-- Shape (all sums are per tenant+day+nm_id):
--   - revenue             : SUM(retail_amount)
--   - payout_before_cost  : SUM(ppvz_for_pay-fallback formula), cost_price NOT subtracted
--   - quantity_for_cost   : SUM(quantity if retail/ppvz non-zero, else 0)
--   - total_quantity      : SUM(quantity)
--   - commission          : SUM(commission_amount)
--   - logistics           : SUM(delivery_rub)
--   - other_fees          : SUM(storage + penalty + schedule + deduction + acquiring - additional)
--   - storage_fee         : SUM(storage_fee_rub)
--   - spp_rub             : SUM(spp_rub)
--
-- Profit and unit-cost are computed at read time against the latest value from
-- unit_economics_configs, so cost-price edits are visible without a refresh.

CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_daily_pnl_final" AS
SELECT
  r.tenant_id,
  DATE_TRUNC('day', r.date_from)::date AS day,
  r.nm_id,
  SUM(r.retail_amount)::numeric AS revenue,
  SUM(
    CASE
      WHEN COALESCE(r.ppvz_for_pay, 0) <> 0
        THEN COALESCE(r.ppvz_for_pay, 0)
      ELSE (
        r.retail_amount
        - r.commission_amount
        - r.delivery_rub
        - r.storage_fee_rub
        - r.penalty_rub
        - r.payment_schedule_rub
        - COALESCE(r.deduction, 0)
        - COALESCE(r.acquiring_fee, 0)
        + COALESCE(r.additional_payment, 0)
      )
    END
  )::numeric AS payout_before_cost,
  SUM(
    CASE
      WHEN COALESCE(r.retail_amount, 0) <> 0 OR COALESCE(r.ppvz_for_pay, 0) <> 0
        THEN r.quantity
      ELSE 0
    END
  )::bigint AS quantity_for_cost,
  COALESCE(SUM(r.quantity), 0)::bigint AS total_quantity,
  SUM(r.commission_amount)::numeric AS commission,
  SUM(r.delivery_rub)::numeric AS logistics,
  SUM(
    r.storage_fee_rub
    + r.penalty_rub
    + r.payment_schedule_rub
    + COALESCE(r.deduction, 0)
    + COALESCE(r.acquiring_fee, 0)
    - COALESCE(r.additional_payment, 0)
  )::numeric AS other_fees,
  SUM(r.storage_fee_rub)::numeric AS storage_fee,
  SUM(r.spp_rub)::numeric AS spp_rub
FROM raw_api_realization_reports r
GROUP BY r.tenant_id, DATE_TRUNC('day', r.date_from)::date, r.nm_id
WITH NO DATA;
--> statement-breakpoint

-- Unique key required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS "mv_daily_pnl_final_tenant_day_nm_idx"
  ON "mv_daily_pnl_final" ("tenant_id", "day", "nm_id");
--> statement-breakpoint

-- Range filter index: WHERE tenant_id = $1 AND day BETWEEN $2 AND $3.
CREATE INDEX IF NOT EXISTS "mv_daily_pnl_final_tenant_day_idx"
  ON "mv_daily_pnl_final" ("tenant_id", "day");
--> statement-breakpoint

-- Debounce table: atomic "claim the refresh slot" from Inngest finalize-sync.
-- Without this a burst of syncs (10 tenants at once) triggers 10 sequential full
-- scans of the defining query. With it, only the first wins the slot for
-- DASHBOARD_MV_REFRESH_MIN_INTERVAL_SECONDS; the others no-op.
CREATE TABLE IF NOT EXISTS "mv_refresh_runs" (
  "mv_name" text PRIMARY KEY,
  "last_refreshed_at" timestamp with time zone NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- Initial population. Non-CONCURRENT because the MV has no prior data yet.
-- Subsequent refreshes use CONCURRENTLY from the Inngest finalize-sync-run step.
REFRESH MATERIALIZED VIEW "mv_daily_pnl_final";
