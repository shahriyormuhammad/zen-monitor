ALTER TABLE "raw_api_ad_costs"
  ADD COLUMN IF NOT EXISTS "views" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_ad_costs"
  ADD COLUMN IF NOT EXISTS "clicks" integer DEFAULT 0 NOT NULL;
