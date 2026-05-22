-- P3-39: Telegram update_id replay protection
-- Stores processed update_ids for 24 h (Telegram max retry window).
-- PRIMARY KEY on update_id ensures atomic insert-or-skip at DB level.

CREATE TABLE IF NOT EXISTS "telegram_processed_updates" (
  "update_id" bigint PRIMARY KEY,
  "processed_at" timestamptz NOT NULL DEFAULT now()
);

-- Index for fast cleanup of expired rows (DELETE WHERE processed_at < now() - interval '25 hours')
CREATE INDEX IF NOT EXISTS "telegram_processed_updates_processed_at_idx"
  ON "telegram_processed_updates" ("processed_at");
