CREATE TABLE IF NOT EXISTS "advertising_hourly_stats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "nm_id" bigint NOT NULL,
  "stat_date" date NOT NULL,
  "stat_hour" timestamp with time zone NOT NULL,
  "ad_spend" numeric(12, 2) DEFAULT '0' NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "order_count" integer DEFAULT 0 NOT NULL,
  "order_sum" numeric(12, 2) DEFAULT '0' NOT NULL,
  "cumulative_ad_spend" numeric(12, 2) DEFAULT '0' NOT NULL,
  "cumulative_views" integer DEFAULT 0 NOT NULL,
  "cumulative_clicks" integer DEFAULT 0 NOT NULL,
  "cumulative_order_count" integer DEFAULT 0 NOT NULL,
  "cumulative_order_sum" numeric(12, 2) DEFAULT '0' NOT NULL,
  "source" varchar(64) DEFAULT 'adv_v3_fullstats_delta' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "advertising_hourly_stats_tenant_nm_hour_source_uidx"
  ON "advertising_hourly_stats" ("tenant_id", "nm_id", "stat_hour", "source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "advertising_hourly_stats_tenant_date_hour_idx"
  ON "advertising_hourly_stats" ("tenant_id", "stat_date", "stat_hour");
--> statement-breakpoint
ALTER TABLE "advertising_hourly_stats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "advertising_hourly_stats" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "advertising_hourly_stats";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "advertising_hourly_stats"
  USING (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);
