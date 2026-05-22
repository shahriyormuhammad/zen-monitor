DROP MATERIALIZED VIEW IF EXISTS "mv_daily_pnl_final";
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_daily_pnl_final" AS
WITH realization_with_pnl_day AS (
  SELECT
    r.*,
    CASE
      WHEN COALESCE(r.delivery_rub, 0) <> 0
        AND COALESCE(r.retail_amount, 0) = 0
        AND COALESCE(r.ppvz_for_pay, 0) = 0
        AND COALESCE(r.srid, '') <> ''
        AND o.date IS NOT NULL
      THEN DATE_TRUNC('day', o.date)::date
      ELSE DATE_TRUNC('day', COALESCE(r.sale_dt, r.date_from))::date
    END AS pnl_day,
    CASE
      WHEN (
        LOWER(COALESCE(
          NULLIF(r.bonus_type_name, ''),
          NULLIF(r.supplier_oper_name, ''),
          NULLIF(r.doc_type_name, ''),
          ''
        )) LIKE '%основного долга%'
        AND LOWER(COALESCE(
          NULLIF(r.bonus_type_name, ''),
          NULLIF(r.supplier_oper_name, ''),
          NULLIF(r.doc_type_name, ''),
          ''
        )) LIKE '%кредит%'
      )
      THEN 0
      WHEN (
        LOWER(COALESCE(
          NULLIF(r.bonus_type_name, ''),
          NULLIF(r.supplier_oper_name, ''),
          NULLIF(r.doc_type_name, ''),
          ''
        )) LIKE '%продвиж%'
        AND (
          LOWER(COALESCE(
            NULLIF(r.bonus_type_name, ''),
            NULLIF(r.supplier_oper_name, ''),
            NULLIF(r.doc_type_name, ''),
            ''
          )) LIKE '%wb%'
          OR LOWER(COALESCE(
            NULLIF(r.bonus_type_name, ''),
            NULLIF(r.supplier_oper_name, ''),
            NULLIF(r.doc_type_name, ''),
            ''
          )) LIKE '%вб%'
        )
      )
      THEN 0
      ELSE COALESCE(r.deduction, 0)
    END AS deduction_expense
  FROM raw_api_realization_reports r
  LEFT JOIN raw_api_orders o
    ON o.tenant_id = r.tenant_id
   AND o.srid = r.srid
)
SELECT
  r.tenant_id,
  r.pnl_day AS day,
  r.nm_id,
  SUM(r.retail_amount)::numeric AS revenue,
  SUM(COALESCE(r.retail_amount, 0))::numeric AS tax_base_revenue,
  SUM(
    CASE
      WHEN COALESCE(r.ppvz_for_pay, 0) <> 0
        THEN COALESCE(r.ppvz_for_pay, 0)
      ELSE (
        (
          CASE
            WHEN COALESCE(r.retail_price_withdisc_rub, 0) <> 0
              THEN COALESCE(r.retail_price_withdisc_rub, 0)
            ELSE COALESCE(r.retail_amount, 0)
          END
        )
        - COALESCE(r.commission_amount, 0)
        - COALESCE(r.delivery_rub, 0)
        - COALESCE(r.storage_fee_rub, 0)
        - COALESCE(r.penalty_rub, 0)
        - COALESCE(r.payment_schedule_rub, 0)
        - COALESCE(r.deduction_expense, 0)
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
    + COALESCE(r.deduction_expense, 0)
    + COALESCE(r.acquiring_fee, 0)
    - COALESCE(r.additional_payment, 0)
  )::numeric AS other_fees,
  SUM(r.storage_fee_rub)::numeric AS storage_fee,
  SUM(r.spp_rub)::numeric AS spp_rub
FROM realization_with_pnl_day r
GROUP BY r.tenant_id, r.pnl_day, r.nm_id
WITH NO DATA;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "mv_daily_pnl_final_tenant_day_nm_idx"
  ON "mv_daily_pnl_final" ("tenant_id", "day", "nm_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mv_daily_pnl_final_tenant_day_idx"
  ON "mv_daily_pnl_final" ("tenant_id", "day");
--> statement-breakpoint

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true);
--> statement-breakpoint

REFRESH MATERIALIZED VIEW "mv_daily_pnl_final";
