CREATE TABLE IF NOT EXISTS "telegram_chat_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "chat_id" bigint NOT NULL,
  "chat_type" varchar(32) DEFAULT 'private' NOT NULL,
  "telegram_user_id" bigint,
  "telegram_username" varchar(255),
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "linked_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_chat_links_active_chat_uidx"
  ON "telegram_chat_links" ("chat_id")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_chat_links_tenant_status_idx"
  ON "telegram_chat_links" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_chat_links_user_idx"
  ON "telegram_chat_links" ("telegram_user_id");
--> statement-breakpoint
WITH unique_legacy_chats AS (
  SELECT
    MIN("id"::text)::uuid AS "tenant_id",
    "telegram_chat_id" AS "chat_id"
  FROM "tenants"
  WHERE "telegram_chat_id" IS NOT NULL
  GROUP BY "telegram_chat_id"
  HAVING COUNT(*) = 1
)
INSERT INTO "telegram_chat_links" (
  "tenant_id",
  "chat_id",
  "chat_type",
  "status",
  "created_at"
)
SELECT
  "tenant_id",
  "chat_id",
  'legacy',
  'active',
  NOW()
FROM unique_legacy_chats
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "telegram_chat_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "telegram_chat_links";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "telegram_chat_links"
  USING (
    NULLIF(current_setting('app.tenant_id', true), '')::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '')::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
