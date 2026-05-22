CREATE TABLE IF NOT EXISTS "ausn_monthly_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "month" date NOT NULL,
  "tax_object" varchar(32) NOT NULL DEFAULT 'income',
  "bank_income" numeric(14, 2) NOT NULL DEFAULT '0',
  "other_expenses" numeric(14, 2) NOT NULL DEFAULT '0',
  "notes" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "ausn_monthly_inputs_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "ausn_monthly_inputs_tax_object_check"
    CHECK ("tax_object" IN ('income', 'income_expenses'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ausn_monthly_inputs_tenant_month_idx"
  ON "ausn_monthly_inputs" ("tenant_id", "month");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ausn_monthly_inputs_tenant_updated_idx"
  ON "ausn_monthly_inputs" ("tenant_id", "updated_at");
--> statement-breakpoint

ALTER TABLE "ausn_monthly_inputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "ausn_monthly_inputs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON "ausn_monthly_inputs";
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "ausn_monthly_inputs"
  USING (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
