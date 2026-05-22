ALTER TABLE "raw_api_price_snapshots"
  ADD COLUMN IF NOT EXISTS "customer_price" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_price_snapshots"
  ADD COLUMN IF NOT EXISTS "implied_spp" numeric(8, 4) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_price_snapshots"
  ADD COLUMN IF NOT EXISTS "public_price_source" varchar(32) DEFAULT 'wb_card_v4' NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_price_snapshots"
  ADD COLUMN IF NOT EXISTS "public_dest" varchar(32) DEFAULT '-1257786' NOT NULL;
