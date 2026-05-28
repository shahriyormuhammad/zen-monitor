-- "Собрать поставку" splits a planned article across warehouses, so a
-- supply_item now carries which WB warehouse it ships to. The dedup key
-- becomes (vendor_code, profile_id, warehouse) — the same article+ростовка
-- can legitimately ship to two warehouses as two rows.

ALTER TABLE "supply_items"
  ADD COLUMN IF NOT EXISTS "warehouse" varchar(255);
--> statement-breakpoint

DROP INDEX IF EXISTS "supply_items_dedup_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "supply_items_dedup_idx"
  ON "supply_items" (
    "tenant_id",
    "vendor_code",
    COALESCE("profile_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("warehouse", '')
  );
