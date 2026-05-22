-- Split own stock batches into physical seller warehouse and China warehouse.
-- Existing rows stay on the seller warehouse through DEFAULT 'own'.

ALTER TABLE "own_stock_batches"
  ADD COLUMN IF NOT EXISTS "stock_location" varchar(16) DEFAULT 'own' NOT NULL;
--> statement-breakpoint
ALTER TABLE "own_stock_movements"
  ADD COLUMN IF NOT EXISTS "stock_location" varchar(16) DEFAULT 'own' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_batches_tenant_location_nm_idx"
  ON "own_stock_batches" ("tenant_id", "stock_location", "nm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_movements_tenant_location_created_idx"
  ON "own_stock_movements" ("tenant_id", "stock_location", "created_at" DESC);
