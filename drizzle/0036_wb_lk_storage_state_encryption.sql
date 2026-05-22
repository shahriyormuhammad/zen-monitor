ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "wb_lk_storage_state" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "wb_lk_storage_state_refreshed_at" timestamp with time zone;
