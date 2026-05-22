CREATE TABLE IF NOT EXISTS "wb_feedback_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "item_type" varchar(16) NOT NULL,
  "wb_item_id" varchar(160) NOT NULL,
  "nm_id" bigint,
  "rating" integer,
  "text" text,
  "answer_text" text,
  "is_answered" boolean DEFAULT false NOT NULL,
  "answer_outcome" varchar(32) DEFAULT 'unknown' NOT NULL,
  "product_name" text,
  "brand_name" text,
  "user_name" text,
  "created_at_wb" timestamp with time zone,
  "source_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wb_feedback_snapshots_unique_idx"
  ON "wb_feedback_snapshots" ("tenant_id", "item_type", "wb_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wb_feedback_snapshots_tenant_type_date_idx"
  ON "wb_feedback_snapshots" ("tenant_id", "item_type", "created_at_wb" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wb_feedback_snapshots_tenant_nm_idx"
  ON "wb_feedback_snapshots" ("tenant_id", "nm_id", "created_at_wb" DESC);
--> statement-breakpoint
ALTER TABLE "wb_feedback_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wb_feedback_snapshots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "wb_feedback_snapshots";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "wb_feedback_snapshots"
  USING (
    NULLIF(current_setting('app.tenant_id', true), '')::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '')::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
