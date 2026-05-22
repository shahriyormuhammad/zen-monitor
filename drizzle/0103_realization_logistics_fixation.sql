ALTER TABLE "raw_api_realization_reports"
  ADD COLUMN IF NOT EXISTS "office_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "fixation_start_date" date,
  ADD COLUMN IF NOT EXISTS "fixation_end_date" date,
  ADD COLUMN IF NOT EXISTS "is_paid_delivery_service" boolean,
  ADD COLUMN IF NOT EXISTS "fixed_warehouse_coefficient" numeric(10, 4);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "realization_tenant_nm_fixation_idx"
  ON "raw_api_realization_reports" ("tenant_id", "nm_id", "fixation_start_date", "fixation_end_date", "fixed_warehouse_coefficient")
  WHERE "fixation_start_date" IS NOT NULL
    AND "fixation_end_date" IS NOT NULL
    AND COALESCE("delivery_rub", 0) > 0;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "realization_tenant_nm_office_fixation_idx"
  ON "raw_api_realization_reports" ("tenant_id", "nm_id", "office_name", "fixation_start_date", "fixation_end_date")
  WHERE "office_name" IS NOT NULL
    AND "fixation_start_date" IS NOT NULL
    AND "fixation_end_date" IS NOT NULL
    AND COALESCE("delivery_rub", 0) > 0;
