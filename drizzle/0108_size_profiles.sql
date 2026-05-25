-- Size profiles ("Ростовки") — per-article box composition.
--
-- One nmId can have multiple named profiles to cover the real case when the
-- same article ships in different boxes (e.g. "Подростковая 37-41" vs
-- "Взрослая 41-46"). Size "41" shares the same barcode but lives in a
-- different physical box, so a single profile isn't enough.
--
-- sizes is a JSON array of {size, perBox, barcode} entries. total_per_box is
-- denormalised for fast queries.

CREATE TABLE IF NOT EXISTS "size_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "nm_id" bigint NOT NULL,
  "vendor_code" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "sizes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "total_per_box" integer NOT NULL DEFAULT 0,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "size_profiles_tenant_nm_idx"
  ON "size_profiles" ("tenant_id", "nm_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "size_profiles_tenant_vc_idx"
  ON "size_profiles" ("tenant_id", "vendor_code");
--> statement-breakpoint

ALTER TABLE "size_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "size_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "size_profiles"
  USING (
    (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
    OR (tenant_id = current_setting('app.tenant_id', true)::uuid)
  )
  WITH CHECK (
    (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
    OR (tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "size_profiles" TO "enterprise_wb_analytics_user";
