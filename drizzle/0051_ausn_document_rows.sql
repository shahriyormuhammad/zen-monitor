CREATE TABLE IF NOT EXISTS "ausn_document_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "month" date NOT NULL,
  "document_type" varchar(40) NOT NULL,
  "amount" numeric(14, 2) NOT NULL DEFAULT '0',
  "title" text,
  "document_date" date,
  "source" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "ausn_document_rows_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "ausn_document_rows_document_type_check"
    CHECK ("document_type" IN (
      'buyout_income',
      'weekly_withholding',
      'weekly_withholding_return',
      'detail_income',
      'detail_income_return',
      'upd_expense',
      'ukd_expense_return'
    ))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ausn_document_rows_tenant_month_idx"
  ON "ausn_document_rows" ("tenant_id", "month");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ausn_document_rows_tenant_type_month_idx"
  ON "ausn_document_rows" ("tenant_id", "document_type", "month");
--> statement-breakpoint

ALTER TABLE "ausn_document_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "ausn_document_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON "ausn_document_rows";
--> statement-breakpoint

CREATE POLICY tenant_isolation ON "ausn_document_rows"
  USING (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
