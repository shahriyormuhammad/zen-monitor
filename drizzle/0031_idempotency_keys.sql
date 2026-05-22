CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(255) NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "request_hash" varchar(64) NOT NULL,
  "response_status" integer NOT NULL,
  "response_body" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_key_tenant_idx" ON "idempotency_keys" ("key", "tenant_id");
