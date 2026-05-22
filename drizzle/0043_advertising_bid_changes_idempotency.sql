-- P1 (audit 2026-04-17): idempotency key on advertising_bid_changes.
-- Protects against duplicate audit rows when Inngest retries a step after a transient error.

ALTER TABLE "advertising_bid_changes"
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);

-- Partial unique index: NULL keys (historical rows) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS "advertising_bid_changes_idempotency_uidx"
  ON "advertising_bid_changes" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
