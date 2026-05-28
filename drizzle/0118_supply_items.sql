-- Supply items ("список поставки") — accumulated rows the user is going to
-- ship to WB. Built either via Шаг 1 (manual form) or Шаг 2 (накладная
-- bulk import). Each row freezes a snapshot of the picked ростовка at the
-- moment of adding — so even if the profile is edited later, the shipment
-- numbers stay stable.

CREATE TABLE IF NOT EXISTS "supply_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "vendor_code" varchar(255) NOT NULL,
  "nm_id" bigint,
  "profile_id" uuid REFERENCES "size_profiles"("id") ON DELETE SET NULL,
  "profile_name" varchar(255),
  "boxes" integer NOT NULL DEFAULT 1,
  "sum_per_box" integer NOT NULL DEFAULT 0,
  "total_pieces" integer NOT NULL DEFAULT 0,
  -- Rows array: [{ size, perBox, boxes, total, barcode }] — frozen at insert.
  "rows" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "missing_bc" integer NOT NULL DEFAULT 0,
  "source" varchar(32) NOT NULL DEFAULT 'manual',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "supply_items_tenant_created_idx"
  ON "supply_items" ("tenant_id", "created_at" DESC);
--> statement-breakpoint

-- Dedup key matches Постал: same (vendor_code, profile_id) — adding the
-- same article twice with the same profile overwrites the row.
CREATE UNIQUE INDEX IF NOT EXISTS "supply_items_dedup_idx"
  ON "supply_items" ("tenant_id", "vendor_code", COALESCE("profile_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint

ALTER TABLE "supply_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "supply_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "supply_items"
  USING (
    (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
    OR (tenant_id = current_setting('app.tenant_id', true)::uuid)
  )
  WITH CHECK (
    (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
    OR (tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "supply_items" TO "enterprise_wb_analytics_user";
