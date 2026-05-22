ALTER TABLE "risk_signals" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "risk_signals"
  ADD COLUMN IF NOT EXISTS "signal_key" varchar(160);
--> statement-breakpoint

WITH keyed AS (
  SELECT
    id,
    base_key,
    row_number() OVER (
      PARTITION BY tenant_id, base_key
      ORDER BY
        CASE WHEN status = 'active' THEN 0 ELSE 1 END,
        created_at DESC,
        id
    ) AS key_rank
  FROM (
    SELECT
      id,
      tenant_id,
      status,
      created_at,
      CASE
        WHEN nm_id IS NULL THEN 'tenant:' || type
        WHEN type = 'content_risk' AND title = 'Мало фотографий'
          THEN 'sku:' || nm_id::text || ':content:low_photo_count'
        WHEN type = 'content_risk' AND title = 'Нет видео-обзора'
          THEN 'sku:' || nm_id::text || ':content:missing_video'
        WHEN type = 'seo_risk' AND title = 'Короткий заголовок'
          THEN 'sku:' || nm_id::text || ':seo:short_title'
        ELSE 'sku:' || nm_id::text || ':' || type
      END AS base_key
    FROM "risk_signals"
    WHERE signal_key IS NULL
  ) base
)
UPDATE "risk_signals" r
SET signal_key = CASE
  WHEN keyed.key_rank = 1 THEN keyed.base_key
  ELSE keyed.base_key || ':legacy:' || left(r.id::text, 8)
END
FROM keyed
WHERE r.id = keyed.id
  AND r.signal_key IS NULL;
--> statement-breakpoint

UPDATE "risk_signals"
SET signal_key = 'legacy:' || id::text
WHERE signal_key IS NULL;
--> statement-breakpoint

ALTER TABLE "risk_signals"
  ALTER COLUMN "signal_key" SET NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "risk_tenant_signal_key_idx"
  ON "risk_signals" ("tenant_id", "signal_key");
--> statement-breakpoint

ALTER TABLE "risk_signals" FORCE ROW LEVEL SECURITY;
