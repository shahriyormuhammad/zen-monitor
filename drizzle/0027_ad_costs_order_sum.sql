ALTER TABLE "raw_api_ad_costs" ADD COLUMN "order_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_ad_costs" ADD COLUMN "order_sum" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
