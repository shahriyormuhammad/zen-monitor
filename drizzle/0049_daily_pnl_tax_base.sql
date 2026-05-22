-- PnL tax base must use the WB buyer price after SPP, not gross retail_amount.
-- tax_base_revenue is signed and aggregated, so returns reduce the taxable base.

DROP MATERIALIZED VIEW IF EXISTS "mv_daily_pnl_final";
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_daily_pnl_final" AS
SELECT
  r.tenant_id,
  DATE_TRUNC('day', r.date_from)::date AS day,
  r.nm_id,
  SUM(r.retail_amount)::numeric AS revenue,
  SUM(
    CASE
      WHEN COALESCE(r.retail_price_withdisc_rub, 0) <> 0
        THEN COALESCE(r.retail_price_withdisc_rub, 0)
      ELSE COALESCE(r.retail_amount, 0) - COALESCE(r.spp_rub, 0)
    END
  )::numeric AS tax_base_revenue,
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

CREATE UNIQUE INDEX IF NOT EXISTS "mv_daily_pnl_final_tenant_day_nm_idx"
  ON "mv_daily_pnl_final" ("tenant_id", "day", "nm_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mv_daily_pnl_final_tenant_day_idx"
  ON "mv_daily_pnl_final" ("tenant_id", "day");
--> statement-breakpoint

REFRESH MATERIALIZED VIEW "mv_daily_pnl_final";
