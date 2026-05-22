DROP INDEX "funnel_stats_tenant_nm_date_idx";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "buyout_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "buyout_sum" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "cancel_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "cancel_sum" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "avg_price" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "add_to_cart_percent" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "cart_to_order_percent" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD COLUMN "order_to_buyout_percent" numeric(8, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "raw_api_funnel_stats"
SET
  "period_start" = COALESCE("period_start", "date"),
  "period_end" = COALESCE("period_end", "date")
WHERE "period_start" IS NULL OR "period_end" IS NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ALTER COLUMN "period_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ALTER COLUMN "period_end" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_stats_tenant_nm_period_idx" ON "raw_api_funnel_stats" USING btree ("tenant_id","nm_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "funnel_stats_tenant_period_idx" ON "raw_api_funnel_stats" USING btree ("tenant_id","period_start","period_end");
