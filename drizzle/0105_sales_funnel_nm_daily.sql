CREATE TABLE IF NOT EXISTS "raw_api_sales_funnel_nm_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"open_card_count" bigint DEFAULT 0 NOT NULL,
	"add_to_cart_count" bigint DEFAULT 0 NOT NULL,
	"order_count" bigint DEFAULT 0 NOT NULL,
	"order_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"buyout_count" bigint DEFAULT 0 NOT NULL,
	"buyout_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cancel_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "raw_api_sales_funnel_nm_daily" ADD CONSTRAINT "raw_api_sales_funnel_nm_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_funnel_nm_daily_tenant_nm_date_idx" ON "raw_api_sales_funnel_nm_daily" ("tenant_id","nm_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_funnel_nm_daily_tenant_date_idx" ON "raw_api_sales_funnel_nm_daily" ("tenant_id","date");
--> statement-breakpoint
ALTER TABLE "raw_api_sales_funnel_nm_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "raw_api_sales_funnel_nm_daily" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "raw_api_sales_funnel_nm_daily";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "raw_api_sales_funnel_nm_daily"
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);
