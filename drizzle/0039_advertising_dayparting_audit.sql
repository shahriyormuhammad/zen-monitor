-- P67: Dayparting Rules + Audit Log

-- Dayparting schedule: boolean[168] = 24h × 7d (index 0 = Mon 00:00)
CREATE TABLE IF NOT EXISTS "advertising_dayparting_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "campaign_id" bigint NOT NULL,
  "schedule" boolean[] NOT NULL DEFAULT '{}'::boolean[],
  "template_name" varchar(64),
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "advertising_dayparting_rules_tenant_idx"
  ON "advertising_dayparting_rules" ("tenant_id", "enabled");

CREATE UNIQUE INDEX IF NOT EXISTS "advertising_dayparting_rules_tenant_campaign_uidx"
  ON "advertising_dayparting_rules" ("tenant_id", "campaign_id");

-- Audit log: tracks all autopilot actions with rollback support
CREATE TABLE IF NOT EXISTS "advertising_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "campaign_id" bigint,
  "nm_id" integer,
  "action_type" varchar(32) NOT NULL,
  "object_type" varchar(32) NOT NULL DEFAULT 'campaign',
  "value_before" jsonb,
  "value_after" jsonb,
  "reason" text,
  "rolled_back" boolean DEFAULT false NOT NULL,
  "rolled_back_at" timestamptz,
  "rolled_back_by" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "source" varchar(32) DEFAULT 'autopilot' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "advertising_audit_log_tenant_idx"
  ON "advertising_audit_log" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "advertising_audit_log_tenant_campaign_idx"
  ON "advertising_audit_log" ("tenant_id", "campaign_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "advertising_audit_log_tenant_type_idx"
  ON "advertising_audit_log" ("tenant_id", "action_type", "created_at" DESC);
