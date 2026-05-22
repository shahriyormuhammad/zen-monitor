CREATE TABLE IF NOT EXISTS "raw_api_price_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "nm_id" bigint NOT NULL,
  "snapshot_at" timestamp with time zone NOT NULL,
  "snapshot_date" date NOT NULL,
  "snapshot_slot" varchar(32) NOT NULL,
  "price" numeric(12, 2) NOT NULL,
  "discount" integer DEFAULT 0 NOT NULL,
  "spp" integer DEFAULT 0 NOT NULL,
  "seller_price_after_discount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "price_after_spp" numeric(12, 2) DEFAULT '0' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "raw_api_price_snapshots"
    ADD CONSTRAINT "raw_api_price_snapshots_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_snapshots_tenant_nm_slot_idx"
  ON "raw_api_price_snapshots" USING btree ("tenant_id","nm_id","snapshot_date","snapshot_slot");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_snapshots_tenant_time_idx"
  ON "raw_api_price_snapshots" USING btree ("tenant_id","snapshot_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_snapshots_tenant_nm_time_idx"
  ON "raw_api_price_snapshots" USING btree ("tenant_id","nm_id","snapshot_at");
--> statement-breakpoint
ALTER TABLE raw_api_price_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE raw_api_price_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON raw_api_price_snapshots;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON raw_api_price_snapshots
  USING (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );
