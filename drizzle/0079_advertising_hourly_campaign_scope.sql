ALTER TABLE "advertising_hourly_stats"
  ADD COLUMN IF NOT EXISTS "advert_id" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "advertising_hourly_stats_tenant_nm_hour_source_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "advertising_hourly_stats_tenant_nm_hour_source_uidx"
  ON "advertising_hourly_stats" ("tenant_id", "advert_id", "nm_id", "stat_hour", "source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "advertising_hourly_stats_tenant_advert_date_hour_idx"
  ON "advertising_hourly_stats" ("tenant_id", "advert_id", "stat_date", "stat_hour");
