-- P2 (audit 2026-04-17): advertising_audit_log.nm_id integer -> bigint.
-- Protects against silent truncation if WB starts issuing nmId values >= 2^31.

ALTER TABLE "advertising_audit_log"
  ALTER COLUMN "nm_id" TYPE bigint USING "nm_id"::bigint;
