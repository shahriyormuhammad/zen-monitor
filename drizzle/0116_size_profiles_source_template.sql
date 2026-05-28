-- Track which built-in template a profile was generated from.
-- Matches the Postal `sourceTemplate` field — used by:
--   • idempotent re-materialisation: don't recreate a split profile that
--     already exists, even if the user renamed it
--   • future migrations: when we add a new template, upgrade old "Стандарт"
--     profiles with perBox=1 to the proper map

ALTER TABLE "size_profiles"
  ADD COLUMN IF NOT EXISTS "source_template" varchar(64);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "size_profiles_tenant_nm_template_idx"
  ON "size_profiles" ("tenant_id", "nm_id", "source_template");
