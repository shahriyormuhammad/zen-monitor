-- Sales plan contour: simple human-editable plan by period, group/SKU and day.
-- It is intentionally separate from finance_budget_items: this plan drives
-- demand, stock coverage and plan-fact sales control.

CREATE TABLE IF NOT EXISTS "sales_plan_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" varchar(180) NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "grain" varchar(16) DEFAULT 'day' NOT NULL,
  "source_type" varchar(32) DEFAULT 'manual' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_plan_versions_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_versions_tenant_period_idx"
  ON "sales_plan_versions" ("tenant_id", "period_start", "period_end");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_versions_tenant_status_idx"
  ON "sales_plan_versions" ("tenant_id", "status", "period_end");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sales_plan_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "plan_date" date NOT NULL,
  "group_id" uuid,
  "nm_id" bigint,
  "planned_orders" integer DEFAULT 0 NOT NULL,
  "planned_buyouts" integer DEFAULT 0 NOT NULL,
  "planned_revenue" numeric(14, 2) DEFAULT '0' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_plan_lines_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sales_plan_lines_plan_id_sales_plan_versions_id_fk"
    FOREIGN KEY ("plan_id") REFERENCES "public"."sales_plan_versions"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sales_plan_lines_group_id_product_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_lines_tenant_plan_date_idx"
  ON "sales_plan_lines" ("tenant_id", "plan_id", "plan_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_lines_tenant_date_idx"
  ON "sales_plan_lines" ("tenant_id", "plan_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_lines_tenant_group_date_idx"
  ON "sales_plan_lines" ("tenant_id", "group_id", "plan_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_lines_tenant_nm_date_idx"
  ON "sales_plan_lines" ("tenant_id", "nm_id", "plan_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sales_plan_seasons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "group_id" uuid,
  "name" varchar(160) NOT NULL,
  "season_start" date NOT NULL,
  "season_end" date NOT NULL,
  "demand_multiplier" numeric(8, 3) DEFAULT '1' NOT NULL,
  "target_stock_days" integer DEFAULT 30 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_plan_seasons_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sales_plan_seasons_plan_id_sales_plan_versions_id_fk"
    FOREIGN KEY ("plan_id") REFERENCES "public"."sales_plan_versions"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sales_plan_seasons_group_id_product_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_seasons_tenant_period_idx"
  ON "sales_plan_seasons" ("tenant_id", "season_start", "season_end");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sales_plan_seasons_plan_idx"
  ON "sales_plan_seasons" ("plan_id");
--> statement-breakpoint

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'sales_plan_versions',
    'sales_plan_lines',
    'sales_plan_seasons'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (current_setting(''app.tenant_id'', true)::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                           OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)
                    WITH CHECK (current_setting(''app.tenant_id'', true)::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                                OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)', tbl);
  END LOOP;
END $$;
