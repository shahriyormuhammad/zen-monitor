CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "token_hash" varchar(128) NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "used_at" timestamp with time zone,
  "used_chat_id" bigint,
  "used_telegram_user_id" bigint,
  "used_telegram_username" varchar(255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_link_tokens_hash_uidx"
  ON "telegram_link_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_link_tokens_tenant_status_idx"
  ON "telegram_link_tokens" ("tenant_id", "status", "expires_at");
--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "telegram_link_tokens";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "telegram_link_tokens"
  USING (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true)::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
