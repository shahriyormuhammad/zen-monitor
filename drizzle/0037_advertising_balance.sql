-- P66: Advertising balance cache and auto-refill

CREATE TABLE IF NOT EXISTS "advertising_balance_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "real_money" numeric(14,2) NOT NULL,
  "bonus_sum" numeric(14,2) DEFAULT '0' NOT NULL,
  "bonus_percent" integer DEFAULT 0 NOT NULL,
  "bonus_expires_at" timestamp with time zone,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "advertising_balance_snapshots_tenant_idx"
  ON "advertising_balance_snapshots" ("tenant_id", "synced_at");

CREATE TABLE IF NOT EXISTS "advertising_auto_refill_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "enabled" boolean DEFAULT false NOT NULL,
  "campaign_id" bigint,
  "threshold_rub" numeric(12,2) DEFAULT '500' NOT NULL,
  "top_up_amount_rub" numeric(12,2) DEFAULT '2000' NOT NULL,
  "daily_cap_rub" numeric(12,2) DEFAULT '10000' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "advertising_auto_refill_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "campaign_id" bigint NOT NULL,
  "amount_rub" numeric(12,2) NOT NULL,
  "triggered_by" varchar(16) DEFAULT 'auto' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "advertising_auto_refill_logs_tenant_idx"
  ON "advertising_auto_refill_logs" ("tenant_id", "created_at");
