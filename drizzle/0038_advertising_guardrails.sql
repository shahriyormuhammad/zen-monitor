-- P65: Guardrails System
-- Idempotent form: safe to re-run on databases where the DDL is already applied.

-- tenants: kill switch
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "advertising_autopilot_enabled" boolean DEFAULT true NOT NULL;

-- strategies: guardrail config + bid tracking + strategy start date
ALTER TABLE "advertising_auto_bid_strategies"
  ADD COLUMN IF NOT EXISTS "guardrail_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "advertising_auto_bid_strategies"
  ADD COLUMN IF NOT EXISTS "last_bid_changed_at" timestamptz;
ALTER TABLE "advertising_auto_bid_strategies"
  ADD COLUMN IF NOT EXISTS "strategy_started_at" timestamptz DEFAULT now() NOT NULL;

-- new: guardrail event log
CREATE TABLE IF NOT EXISTS "advertising_guardrail_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "strategy_id" uuid NOT NULL REFERENCES "advertising_auto_bid_strategies"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "advertising_auto_bid_runs"("id") ON DELETE SET NULL,
  "trigger" varchar(64) NOT NULL,
  "cluster" varchar(255),
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "advertising_guardrail_events_tenant_idx"
  ON "advertising_guardrail_events" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "advertising_guardrail_events_strategy_idx"
  ON "advertising_guardrail_events" ("strategy_id", "created_at");
