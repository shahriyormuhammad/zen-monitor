ALTER TABLE "tenants" ADD COLUMN "wb_token_health_status" varchar(50) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wb_token_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wb_token_health_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;