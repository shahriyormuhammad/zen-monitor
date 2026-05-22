-- Draft SKU support for production / own-stock rows before a WB card exists.

CREATE TABLE IF NOT EXISTS "procifry_draft_skus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "cabinet_oid" varchar(64),
  "source" varchar(64) DEFAULT 'procifry-agent' NOT NULL,
  "source_key" varchar(255),
  "external_sku_key" varchar(255),
  "supplier_article" varchar(255),
  "source_article" varchar(255),
  "title" text NOT NULL,
  "comment" text,
  "variant" varchar(255),
  "color" varchar(255),
  "image_url" text,
  "attachment_url" text,
  "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "linked_nm_id" bigint,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "procifry_draft_skus_status_chk"
    CHECK ("status" IN ('draft', 'linked')),
  CONSTRAINT "procifry_draft_skus_linked_chk"
    CHECK (("status" = 'draft' AND "linked_nm_id" IS NULL) OR ("status" = 'linked' AND "linked_nm_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "procifry_draft_skus_tenant_source_external_idx"
  ON "procifry_draft_skus" ("tenant_id", "source_key", "external_sku_key")
  WHERE "external_sku_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_draft_skus_tenant_status_idx"
  ON "procifry_draft_skus" ("tenant_id", "status", "updated_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_draft_skus_tenant_linked_nm_idx"
  ON "procifry_draft_skus" ("tenant_id", "linked_nm_id")
  WHERE "linked_nm_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_draft_skus_tenant_supplier_idx"
  ON "procifry_draft_skus" ("tenant_id", "supplier_article", "source_article");
--> statement-breakpoint

ALTER TABLE "production_order_lines"
  ALTER COLUMN "nm_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_order_lines"
  ADD COLUMN IF NOT EXISTS "draft_sku_id" uuid REFERENCES "procifry_draft_skus"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "production_order_lines"
  ADD CONSTRAINT "production_order_lines_sku_ref_chk"
  CHECK ("nm_id" IS NOT NULL OR "draft_sku_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "production_order_lines"
  VALIDATE CONSTRAINT "production_order_lines_sku_ref_chk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_order_lines_tenant_draft_sku_idx"
  ON "production_order_lines" ("tenant_id", "draft_sku_id")
  WHERE "draft_sku_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "own_stock_batches"
  ALTER COLUMN "nm_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "own_stock_batches"
  ADD COLUMN IF NOT EXISTS "draft_sku_id" uuid REFERENCES "procifry_draft_skus"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "own_stock_batches"
  ADD CONSTRAINT "own_stock_batches_sku_ref_chk"
  CHECK ("nm_id" IS NOT NULL OR "draft_sku_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "own_stock_batches"
  VALIDATE CONSTRAINT "own_stock_batches_sku_ref_chk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_batches_tenant_draft_sku_idx"
  ON "own_stock_batches" ("tenant_id", "draft_sku_id")
  WHERE "draft_sku_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "own_stock_movements"
  ALTER COLUMN "nm_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "own_stock_movements"
  ADD COLUMN IF NOT EXISTS "draft_sku_id" uuid REFERENCES "procifry_draft_skus"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "own_stock_movements"
  ADD CONSTRAINT "own_stock_movements_sku_ref_chk"
  CHECK ("nm_id" IS NOT NULL OR "draft_sku_id" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "own_stock_movements"
  VALIDATE CONSTRAINT "own_stock_movements_sku_ref_chk";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_stock_movements_tenant_draft_sku_idx"
  ON "own_stock_movements" ("tenant_id", "draft_sku_id")
  WHERE "draft_sku_id" IS NOT NULL;
