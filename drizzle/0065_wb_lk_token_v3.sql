-- Add long-lived WBTokenV3 to tenants. Extracted from cookies after a successful
-- WB ЛК login; allows HTTP requests to WB seller cabinet without Playwright.
-- WBTokenV3 does not expire by WB design.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "wb_lk_token_v3" text,
  ADD COLUMN IF NOT EXISTS "wb_lk_token_v3_refreshed_at" timestamp with time zone;
