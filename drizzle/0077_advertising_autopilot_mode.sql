ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "advertising_autopilot_mode" varchar(24) DEFAULT 'advisor' NOT NULL;

ALTER TABLE "tenants"
  DROP CONSTRAINT IF EXISTS "tenants_advertising_autopilot_mode_check";

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_advertising_autopilot_mode_check"
  CHECK ("advertising_autopilot_mode" IN ('advisor', 'semi_auto', 'auto'));
