ALTER TABLE "user_tenants"
  ADD COLUMN IF NOT EXISTS "access_preset" varchar(50) DEFAULT 'all' NOT NULL,
  ADD COLUMN IF NOT EXISTS "feature_permissions" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "invitations"
  ADD COLUMN IF NOT EXISTS "access_preset" varchar(50) DEFAULT 'viewer' NOT NULL,
  ADD COLUMN IF NOT EXISTS "feature_permissions" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "user_tenants"
SET
  "access_preset" = CASE
    WHEN "role" IN ('owner', 'admin') THEN 'all'
    ELSE 'viewer'
  END,
  "feature_permissions" = CASE
    WHEN "role" IN ('owner', 'admin') THEN '{}'::jsonb
    ELSE '{"overview":true}'::jsonb
  END
WHERE "access_preset" IS NULL OR "feature_permissions" = '{}'::jsonb;
--> statement-breakpoint
UPDATE "tenants"
SET "wb_lk_session_status" = 'healthy'
WHERE "wb_lk_session_status" = 'active';
