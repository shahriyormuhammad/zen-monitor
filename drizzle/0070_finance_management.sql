-- PnL-plus finance contour: accounts/cashboxes, operation journal,
-- debts and plan-fact budget. WB finance remains a source; this ledger is
-- for seller-side management accounting and manual money movements.

CREATE TABLE IF NOT EXISTS "finance_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "type" varchar(32) DEFAULT 'bank' NOT NULL,
  "currency" varchar(8) DEFAULT 'RUB' NOT NULL,
  "opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
  "opening_balance_date" date DEFAULT CURRENT_DATE NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 100 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_accounts_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "finance_accounts_tenant_name_idx"
  ON "finance_accounts" ("tenant_id", "name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_accounts_tenant_type_idx"
  ON "finance_accounts" ("tenant_id", "type", "is_active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "finance_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" varchar(180) NOT NULL,
  "kind" varchar(32) DEFAULT 'expense' NOT NULL,
  "cashflow_section" varchar(32) DEFAULT 'operating' NOT NULL,
  "pnl_section" varchar(32) DEFAULT 'opex' NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 100 NOT NULL,
  "color" varchar(32),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_categories_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "finance_categories_tenant_name_idx"
  ON "finance_categories" ("tenant_id", "name");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_categories_tenant_kind_idx"
  ON "finance_categories" ("tenant_id", "kind", "is_active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "finance_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "economic_date" date,
  "operation_type" varchar(32) NOT NULL,
  "status" varchar(24) DEFAULT 'actual' NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "currency" varchar(8) DEFAULT 'RUB' NOT NULL,
  "from_account_id" uuid,
  "to_account_id" uuid,
  "category_id" uuid,
  "counterparty" varchar(255),
  "description" text,
  "source_type" varchar(40) DEFAULT 'manual' NOT NULL,
  "source_id" text,
  "external_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_transactions_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "finance_transactions_from_account_id_fk"
    FOREIGN KEY ("from_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "finance_transactions_to_account_id_fk"
    FOREIGN KEY ("to_account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "finance_transactions_category_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_transactions_tenant_occurred_idx"
  ON "finance_transactions" ("tenant_id", "occurred_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_transactions_tenant_status_idx"
  ON "finance_transactions" ("tenant_id", "status", "occurred_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_transactions_tenant_category_idx"
  ON "finance_transactions" ("tenant_id", "category_id", "occurred_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_transactions_from_account_idx"
  ON "finance_transactions" ("from_account_id", "occurred_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_transactions_to_account_idx"
  ON "finance_transactions" ("to_account_id", "occurred_at" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "finance_debts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" varchar(180) NOT NULL,
  "debt_type" varchar(32) DEFAULT 'loan' NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "counterparty" varchar(255),
  "principal_amount" numeric(14, 2) NOT NULL,
  "outstanding_amount" numeric(14, 2) NOT NULL,
  "currency" varchar(8) DEFAULT 'RUB' NOT NULL,
  "opened_at" date DEFAULT CURRENT_DATE NOT NULL,
  "due_at" date,
  "interest_rate_percent" numeric(7, 3),
  "account_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_debts_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "finance_debts_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_debts_tenant_status_idx"
  ON "finance_debts" ("tenant_id", "status", "due_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_debts_tenant_type_idx"
  ON "finance_debts" ("tenant_id", "debt_type");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "finance_budget_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "period_month" date NOT NULL,
  "name" varchar(180) NOT NULL,
  "direction" varchar(16) DEFAULT 'outflow' NOT NULL,
  "planned_amount" numeric(14, 2) NOT NULL,
  "actual_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
  "category_id" uuid,
  "account_id" uuid,
  "due_at" date,
  "status" varchar(24) DEFAULT 'planned' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_budget_items_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "finance_budget_items_category_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "finance_budget_items_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_budget_items_tenant_month_idx"
  ON "finance_budget_items" ("tenant_id", "period_month");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "finance_budget_items_tenant_status_idx"
  ON "finance_budget_items" ("tenant_id", "status", "due_at");
--> statement-breakpoint

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'finance_accounts',
    'finance_categories',
    'finance_transactions',
    'finance_debts',
    'finance_budget_items'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (current_setting(''app.tenant_id'', true)::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                           OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)
                    WITH CHECK (current_setting(''app.tenant_id'', true)::uuid = ''00000000-0000-0000-0000-000000000000''::uuid
                                OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)', tbl);
  END LOOP;
END $$;
