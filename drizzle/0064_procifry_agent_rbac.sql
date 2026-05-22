CREATE TABLE IF NOT EXISTS "procifry_approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "worker_id" varchar(80) NOT NULL,
  "client_id" varchar(120) NOT NULL,
  "cabinet_oid" varchar(120) NOT NULL,
  "action_type" varchar(120) NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source" varchar(120) NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "period_from" timestamp with time zone NOT NULL,
  "period_to" timestamp with time zone NOT NULL,
  "confidence" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'requested' NOT NULL,
  "decided_by" varchar(255),
  "decided_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "procifry_worker_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "worker_id" varchar(80) NOT NULL,
  "client_id" varchar(120) NOT NULL,
  "cabinet_oid" varchar(120) NOT NULL,
  "artifact_type" varchar(80) NOT NULL,
  "action_type" varchar(120),
  "access_mode" varchar(32) NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source" varchar(120) NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "period_from" timestamp with time zone NOT NULL,
  "period_to" timestamp with time zone NOT NULL,
  "confidence" varchar(32) NOT NULL,
  "approval_request_id" uuid REFERENCES "public"."procifry_approval_requests"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "procifry_agent_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "tenant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "multi_tenant" boolean DEFAULT false NOT NULL,
  "worker_id" varchar(80) NOT NULL,
  "client_id" varchar(120) NOT NULL,
  "cabinet_oid" varchar(120) NOT NULL,
  "period_from" timestamp with time zone NOT NULL,
  "period_to" timestamp with time zone NOT NULL,
  "source" varchar(120) NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "confidence" varchar(32) NOT NULL,
  "access_mode" varchar(32) NOT NULL,
  "resource_type" varchar(80) NOT NULL,
  "action_type" varchar(120),
  "outcome" varchar(32) DEFAULT 'accepted' NOT NULL,
  "artifact_id" uuid REFERENCES "public"."procifry_worker_artifacts"("id") ON DELETE set null,
  "approval_request_id" uuid REFERENCES "public"."procifry_approval_requests"("id") ON DELETE set null,
  "request_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "response_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_approval_tenant_status_idx"
  ON "procifry_approval_requests" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_approval_tenant_worker_idx"
  ON "procifry_approval_requests" ("tenant_id", "worker_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_approval_tenant_action_idx"
  ON "procifry_approval_requests" ("tenant_id", "action_type", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_artifacts_tenant_created_idx"
  ON "procifry_worker_artifacts" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_artifacts_tenant_worker_idx"
  ON "procifry_worker_artifacts" ("tenant_id", "worker_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_artifacts_tenant_type_idx"
  ON "procifry_worker_artifacts" ("tenant_id", "artifact_type", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_artifacts_approval_idx"
  ON "procifry_worker_artifacts" ("tenant_id", "approval_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_audit_tenant_created_idx"
  ON "procifry_agent_audit_log" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_audit_tenant_worker_idx"
  ON "procifry_agent_audit_log" ("tenant_id", "worker_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_audit_tenant_resource_idx"
  ON "procifry_agent_audit_log" ("tenant_id", "resource_type", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "procifry_audit_approval_idx"
  ON "procifry_agent_audit_log" ("tenant_id", "approval_request_id", "created_at");
--> statement-breakpoint
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'procifry_agent_audit_log',
    'procifry_approval_requests',
    'procifry_worker_artifacts'
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
