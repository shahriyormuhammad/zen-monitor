CREATE TABLE IF NOT EXISTS "tenant_unit_economics_indices" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" uuid NOT NULL,
"effective_week" date NOT NULL,
"locality_index" numeric(8, 4) DEFAULT '1' NOT NULL,
"irp_percent" numeric(8, 4) DEFAULT '0' NOT NULL,
"source" varchar(32) DEFAULT 'calculated_fallback' NOT NULL,
"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_unit_economics_indices" ADD CONSTRAINT "tenant_unit_economics_indices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_unit_economics_indices_tenant_week_idx" ON "tenant_unit_economics_indices" ("tenant_id","effective_week");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_unit_economics_indices_tenant_fetched_idx" ON "tenant_unit_economics_indices" ("tenant_id","fetched_at");
--> statement-breakpoint
ALTER TABLE "tenant_unit_economics_indices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_unit_economics_indices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "tenant_unit_economics_indices";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tenant_unit_economics_indices"
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);
