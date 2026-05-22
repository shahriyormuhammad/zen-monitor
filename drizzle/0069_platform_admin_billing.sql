CREATE TABLE IF NOT EXISTS "platform_admins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "role" varchar(50) DEFAULT 'readonly' NOT NULL,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "created_by" uuid,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "platform_admins_user_idx"
  ON "platform_admins" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_admins_status_role_idx"
  ON "platform_admins" ("status", "role");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL,
  "name" varchar(120) NOT NULL,
  "price_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
  "billing_period" varchar(20) DEFAULT 'month' NOT NULL,
  "max_tenants" integer,
  "max_users" integer,
  "features" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "plans_code_idx"
  ON "plans" ("code");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plans_active_idx"
  ON "plans" ("is_active", "code");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid NOT NULL,
  "status" varchar(50) DEFAULT 'trialing' NOT NULL,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "trial_ends_at" timestamp with time zone,
  "grace_until" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "canceled_at" timestamp with time zone,
  "provider" varchar(50) DEFAULT 'manual' NOT NULL,
  "provider_customer_id" varchar(255),
  "provider_subscription_id" varchar(255),
  "provider_payment_method_id" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk"
  FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subscriptions_tenant_status_idx"
  ON "subscriptions" ("tenant_id", "status", "current_period_end");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subscriptions_provider_idx"
  ON "subscriptions" ("provider", "provider_subscription_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subscription_id" uuid,
  "provider" varchar(50) DEFAULT 'manual' NOT NULL,
  "provider_payment_id" varchar(255),
  "idempotency_key" varchar(255),
  "amount_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
  "currency" varchar(3) DEFAULT 'RUB' NOT NULL,
  "status" varchar(50) DEFAULT 'pending' NOT NULL,
  "paid_at" timestamp with time zone,
  "due_at" timestamp with time zone,
  "failure_code" varchar(120),
  "failure_message" text,
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk"
  FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payments_tenant_status_idx"
  ON "payments" ("tenant_id", "status", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "payments_subscription_idx"
  ON "payments" ("subscription_id", "created_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_payment_idx"
  ON "payments" ("provider", "provider_payment_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_idx"
  ON "payments" ("provider", "idempotency_key");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(50) NOT NULL,
  "provider_event_id" varchar(255) NOT NULL,
  "event_type" varchar(120) NOT NULL,
  "payment_id" uuid,
  "subscription_id" uuid,
  "processing_status" varchar(50) DEFAULT 'received' NOT NULL,
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_message" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_subscription_id_subscriptions_id_fk"
  FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_provider_event_idx"
  ON "billing_events" ("provider", "provider_event_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "billing_events_status_received_idx"
  ON "billing_events" ("processing_status", "received_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid,
  "actor_role" varchar(50) NOT NULL,
  "action" varchar(120) NOT NULL,
  "entity_type" varchar(120) NOT NULL,
  "entity_id" varchar(255),
  "tenant_id" uuid,
  "before" jsonb,
  "after" jsonb,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "platform_audit_log"
  ADD CONSTRAINT "platform_audit_log_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "platform_audit_log"
  ADD CONSTRAINT "platform_audit_log_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_audit_tenant_created_idx"
  ON "platform_audit_log" ("tenant_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_audit_actor_created_idx"
  ON "platform_audit_log" ("actor_user_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_audit_entity_idx"
  ON "platform_audit_log" ("entity_type", "entity_id", "created_at");
--> statement-breakpoint

ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "platform_admins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS platform_admin_sentinel ON "platform_admins";
--> statement-breakpoint

CREATE POLICY platform_admin_sentinel ON "platform_admins"
  USING (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
  WITH CHECK (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid);
--> statement-breakpoint

ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "billing_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS billing_events_admin_sentinel ON "billing_events";
--> statement-breakpoint

CREATE POLICY billing_events_admin_sentinel ON "billing_events"
  USING (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
  WITH CHECK (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid);
--> statement-breakpoint

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'subscriptions',
    'payments',
    'platform_audit_log'
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
