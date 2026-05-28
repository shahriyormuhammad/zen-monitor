-- Per-size catalogue from WB Content API (cards/list).
-- Stores tech_size + barcode + chrt_id for each nm_id, so size profiles can
-- pre-fill barcodes automatically instead of asking the user to type them.

CREATE TABLE IF NOT EXISTS "product_sizes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "nm_id" bigint NOT NULL,
  "tech_size" varchar(64) NOT NULL,
  "barcode" varchar(255) NOT NULL,
  "chrt_id" bigint,
  "synced_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "product_sizes_unique_idx"
  ON "product_sizes" ("tenant_id", "nm_id", "tech_size", "barcode");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "product_sizes_tenant_nm_idx"
  ON "product_sizes" ("tenant_id", "nm_id");
--> statement-breakpoint

ALTER TABLE "product_sizes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "product_sizes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "product_sizes"
  USING (
    (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
    OR (tenant_id = current_setting('app.tenant_id', true)::uuid)
  )
  WITH CHECK (
    (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
    OR (tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "product_sizes" TO "enterprise_wb_analytics_user";
