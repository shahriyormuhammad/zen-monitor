CREATE TABLE IF NOT EXISTS "procifry_search_positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "cabinet_oid" varchar(120) NOT NULL,
  "observed_date" date NOT NULL,
  "keyword" text NOT NULL,
  "nm_id" bigint NOT NULL,
  "position" integer,
  "frequency" integer,
  "impressions" integer,
  "organic_or_ad" varchar(32),
  "source" varchar(120) NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "confidence" varchar(32) DEFAULT 'confirmed' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "procifry_competitor_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "cabinet_oid" varchar(120) NOT NULL,
  "observed_date" date NOT NULL,
  "our_nm_id" bigint,
  "competitor_nm_id" bigint NOT NULL,
  "keyword" text,
  "subject" text,
  "title" text,
  "brand" text,
  "price" numeric(14, 2),
  "rating" numeric(4, 2),
  "reviews_count" integer,
  "orders_count" integer,
  "revenue" numeric(14, 2),
  "stock_qty" integer,
  "photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "videos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "positions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source" varchar(120) NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "confidence" varchar(32) DEFAULT 'confirmed' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "procifry_ab_tests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "cabinet_oid" varchar(120) NOT NULL,
  "test_id" varchar(120) NOT NULL,
  "nm_id" bigint NOT NULL,
  "variant" varchar(120) NOT NULL,
  "period_from" date NOT NULL,
  "period_to" date NOT NULL,
  "impressions" integer DEFAULT 0 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "ctr" numeric(10, 4),
  "carts" integer DEFAULT 0 NOT NULL,
  "orders" integer DEFAULT 0 NOT NULL,
  "revenue" numeric(14, 2),
  "profit" numeric(14, 2),
  "significance" numeric(10, 4),
  "status" varchar(40) DEFAULT 'unknown' NOT NULL,
  "source" varchar(120) NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "confidence" varchar(32) DEFAULT 'confirmed' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_search_positions_tenant_date_idx"
  ON "procifry_search_positions" ("tenant_id", "observed_date", "nm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_search_positions_tenant_keyword_idx"
  ON "procifry_search_positions" ("tenant_id", "keyword", "observed_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_competitor_cards_tenant_date_idx"
  ON "procifry_competitor_cards" ("tenant_id", "observed_date", "our_nm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_competitor_cards_tenant_competitor_idx"
  ON "procifry_competitor_cards" ("tenant_id", "competitor_nm_id", "observed_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_ab_tests_tenant_period_idx"
  ON "procifry_ab_tests" ("tenant_id", "period_from", "period_to", "nm_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_ab_tests_tenant_test_idx"
  ON "procifry_ab_tests" ("tenant_id", "test_id", "nm_id");
--> statement-breakpoint
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'procifry_search_positions',
    'procifry_competitor_cards',
    'procifry_ab_tests'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                           OR tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
                    WITH CHECK (NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                                OR tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', tbl);
  END LOOP;
END $$;
