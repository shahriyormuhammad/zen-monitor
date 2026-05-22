CREATE TABLE IF NOT EXISTS "platform_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL,
  "name" varchar(255),
  "phone" varchar(64),
  "source" varchar(120) DEFAULT 'site' NOT NULL,
  "status" varchar(50) DEFAULT 'registered' NOT NULL,
  "selected_plan_code" varchar(50),
  "user_id" uuid,
  "tenant_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "note" text,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "platform_leads"
  ADD CONSTRAINT "platform_leads_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "platform_leads"
  ADD CONSTRAINT "platform_leads_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "platform_leads_email_idx"
  ON "platform_leads" ("email");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_leads_status_activity_idx"
  ON "platform_leads" ("status", "last_activity_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_leads_tenant_idx"
  ON "platform_leads" ("tenant_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_leads_user_idx"
  ON "platform_leads" ("user_id");
--> statement-breakpoint

ALTER TABLE "platform_leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "platform_leads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS platform_leads_admin_sentinel ON "platform_leads";
--> statement-breakpoint

CREATE POLICY platform_leads_admin_sentinel ON "platform_leads"
  USING (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
  WITH CHECK (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid);
