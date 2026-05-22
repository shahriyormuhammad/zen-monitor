-- Fix: «Возмещение издержек по перевозке/по складским операциям» (additional_payment)
-- НЕ является доходом продавца. Это бухгалтерское переотображение комиссии WB
-- (с 13.01.2024): на этих строках «Вознаграждение ВВ» уходит в минус, а «Возмещение»
-- ставится плюсом на ту же сумму, при этом «К перечислению Продавцу» (ppvz_for_pay) = 0
-- — фактического движения денег нет (подтверждено практикой WB/1С и ppvz=0 в данных).
-- Раньше mv_daily_pnl_final ПРИБАВЛЯЛ additional_payment к payout_before_cost → фантомный
-- доход завышал ЧП у всех кабинетов с такими строками (Шахриёр +129 935, Лавров +92 105 и т.д.).
-- Фикс: убрать additional_payment из payout_before_cost и из other_fees. Колонки не меняются.

DROP MATERIALIZED VIEW IF EXISTS "mv_daily_pnl_final";
--> statement-breakpoint

CREATE MATERIALIZED VIEW "mv_daily_pnl_final" AS
WITH buyout_by_srid AS (
  SELECT
    tenant_id,
    srid,
    MIN(DATE_TRUNC('day', COALESCE(sale_dt, date_from))::date) AS buyout_day
  FROM raw_api_realization_reports
  WHERE COALESCE(srid, '') <> ''
    AND (
      COALESCE(retail_amount, 0) <> 0
      OR COALESCE(ppvz_for_pay, 0) <> 0
    )
  GROUP BY tenant_id, srid
),
realization_with_pnl_day AS (
  SELECT
    r.*,
    CASE WHEN r.doc_type_name = 'Возврат' THEN -1 ELSE 1 END AS doc_sign,
    CASE
      WHEN COALESCE(r.delivery_rub, 0) <> 0
        AND COALESCE(r.retail_amount, 0) = 0
        AND COALESCE(r.ppvz_for_pay, 0) = 0
        AND COALESCE(r.srid, '') <> ''
      THEN COALESCE(
        b.buyout_day,
        DATE_TRUNC('day', COALESCE(r.sale_dt, r.date_from))::date
      )
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
  LEFT JOIN buyout_by_srid b
    ON b.tenant_id = r.tenant_id
   AND b.srid = r.srid
)
SELECT
  r.tenant_id,
  r.pnl_day AS day,
  r.nm_id,
  SUM(r.doc_sign * COALESCE(r.retail_amount, 0))::numeric AS revenue,
  SUM(r.doc_sign * COALESCE(r.retail_amount, 0))::numeric AS tax_base_revenue,
  SUM(
    r.doc_sign * (
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
        )
      END
    )
  )::numeric AS payout_before_cost,
  SUM(
    r.doc_sign * (
      CASE
        WHEN COALESCE(r.retail_amount, 0) <> 0 OR COALESCE(r.ppvz_for_pay, 0) <> 0
          THEN r.quantity
        ELSE 0
      END
    )
  )::bigint AS quantity_for_cost,
  COALESCE(SUM(r.doc_sign * r.quantity), 0)::bigint AS total_quantity,
  SUM(r.doc_sign * COALESCE(r.commission_amount, 0))::numeric AS commission,
  SUM(r.doc_sign * COALESCE(r.delivery_rub, 0))::numeric AS logistics,
  SUM(
    r.doc_sign * (
      COALESCE(r.storage_fee_rub, 0)
      + COALESCE(r.penalty_rub, 0)
      + COALESCE(r.payment_schedule_rub, 0)
      + COALESCE(r.deduction_expense, 0)
      + COALESCE(r.acquiring_fee, 0)
    )
  )::numeric AS other_fees,
  SUM(r.doc_sign * COALESCE(r.storage_fee_rub, 0))::numeric AS storage_fee,
  SUM(r.doc_sign * COALESCE(r.spp_rub, 0))::numeric AS spp_rub
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
