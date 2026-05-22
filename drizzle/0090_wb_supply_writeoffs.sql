-- Nightly reconciliation for WB FBW supplies.
-- A row is one accepted WB supply goods line that may write off the seller's
-- own stock once, then reconcile WB accepted quantity against declared quantity.

CREATE TABLE IF NOT EXISTS "wb_supply_writeoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "supply_key" varchar(80) NOT NULL,
  "line_key" varchar(180) NOT NULL,
  "supply_id" bigint,
  "preorder_id" bigint,
  "is_preorder" boolean DEFAULT false NOT NULL,
  "status_id" integer,
  "nm_id" bigint NOT NULL,
  "barcode" varchar(255) DEFAULT '' NOT NULL,
  "vendor_code" varchar(255),
  "warehouse_name" varchar(255),
  "actual_warehouse_name" varchar(255),
  "supply_date" timestamp with time zone,
  "fact_date" timestamp with time zone,
  "wb_quantity" integer DEFAULT 0 NOT NULL,
  "local_written_off_quantity" integer DEFAULT 0 NOT NULL,
  "accepted_quantity" integer,
  "unloading_quantity" integer,
  "ready_for_sale_quantity" integer,
  "write_off_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "write_off_error" text,
  "written_off_at" timestamp with time zone,
  "write_off_error_notified_at" timestamp with time zone,
  "discrepancy_quantity" integer,
  "discrepancy_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "discrepancy_notified_at" timestamp with time zone,
  "raw_supply" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "raw_goods" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "wb_supply_writeoffs_tenant_line_idx"
  ON "wb_supply_writeoffs" ("tenant_id", "line_key");

CREATE INDEX IF NOT EXISTS "wb_supply_writeoffs_tenant_supply_idx"
  ON "wb_supply_writeoffs" ("tenant_id", "supply_key");

CREATE INDEX IF NOT EXISTS "wb_supply_writeoffs_tenant_status_idx"
  ON "wb_supply_writeoffs" ("tenant_id", "write_off_status", "discrepancy_status", "last_seen_at" DESC);
