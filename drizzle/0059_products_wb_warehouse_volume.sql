ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "wb_warehouse_volume_liters" numeric(8, 3);
--> statement-breakpoint
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "wb_warehouse_volume_updated_at" timestamp with time zone;
