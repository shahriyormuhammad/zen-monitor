ALTER TABLE "raw_api_funnel_stats"
  ADD COLUMN IF NOT EXISTS "localization_percent" numeric(6, 2);
