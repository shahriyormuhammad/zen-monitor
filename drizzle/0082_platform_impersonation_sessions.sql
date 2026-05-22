CREATE TABLE IF NOT EXISTS "platform_impersonation_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid,
  "actor_role" varchar(50) NOT NULL,
  "tenant_id" uuid NOT NULL,
  "reason" varchar(120) NOT NULL,
  "note" text,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "platform_impersonation_sessions"
  ADD CONSTRAINT "platform_impersonation_sessions_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "platform_impersonation_sessions"
  ADD CONSTRAINT "platform_impersonation_sessions_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_impersonation_actor_active_idx"
  ON "platform_impersonation_sessions" ("actor_user_id", "status", "expires_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_impersonation_tenant_started_idx"
  ON "platform_impersonation_sessions" ("tenant_id", "started_at");
--> statement-breakpoint

ALTER TABLE "platform_impersonation_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "platform_impersonation_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS platform_impersonation_admin_sentinel ON "platform_impersonation_sessions";
--> statement-breakpoint

CREATE POLICY platform_impersonation_admin_sentinel ON "platform_impersonation_sessions"
  USING (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid)
  WITH CHECK (current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid);
