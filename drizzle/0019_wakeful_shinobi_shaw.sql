ALTER TABLE "tenants" ADD COLUMN "wb_lk_phone" varchar(32);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wb_lk_session_status" varchar(50) DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wb_lk_session_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wb_lk_session_error" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "wb_lk_storage_state_path" text;
