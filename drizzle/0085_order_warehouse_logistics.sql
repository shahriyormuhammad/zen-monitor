ALTER TABLE "raw_api_orders"
  ADD COLUMN IF NOT EXISTS "warehouse_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "warehouse_type" varchar(120),
  ADD COLUMN IF NOT EXISTS "country_name" varchar(128),
  ADD COLUMN IF NOT EXISTS "oblast_okrug_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "region_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "supplier_article" varchar(255),
  ADD COLUMN IF NOT EXISTS "barcode" varchar(255),
  ADD COLUMN IF NOT EXISTS "category" varchar(255),
  ADD COLUMN IF NOT EXISTS "subject" varchar(255),
  ADD COLUMN IF NOT EXISTS "brand" varchar(255),
  ADD COLUMN IF NOT EXISTS "tech_size" varchar(64),
  ADD COLUMN IF NOT EXISTS "income_id" bigint,
  ADD COLUMN IF NOT EXISTS "spp" numeric(8, 2),
  ADD COLUMN IF NOT EXISTS "finished_price" numeric(12, 2),
  ADD COLUMN IF NOT EXISTS "price_with_disc" numeric(12, 2);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_tenant_nm_warehouse_date_idx"
  ON "raw_api_orders" ("tenant_id", "nm_id", "warehouse_name", "date")
  WHERE "is_cancel" = false AND "warehouse_name" IS NOT NULL;
