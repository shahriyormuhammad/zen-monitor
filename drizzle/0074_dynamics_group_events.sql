CREATE TABLE IF NOT EXISTS "dynamics_group_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "event_date" date NOT NULL,
  "event_type" varchar(32) DEFAULT 'note' NOT NULL,
  "status" varchar(32) DEFAULT 'open' NOT NULL,
  "title" varchar(180) NOT NULL,
  "body" text,
  "assignee" varchar(120),
  "due_date" date,
  "check_date" date,
  "created_by_user_id" uuid,
  "created_by_email" varchar(255),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dynamics_group_events_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "dynamics_group_events_group_id_product_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "dynamics_group_events_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "dynamics_group_events_type_check"
    CHECK ("event_type" IN ('note', 'photo', 'ads', 'price', 'content', 'stock', 'task')),
  CONSTRAINT "dynamics_group_events_status_check"
    CHECK ("status" IN ('open', 'watching', 'done'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dynamics_group_events_tenant_group_date_idx"
  ON "dynamics_group_events" ("tenant_id", "group_id", "event_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dynamics_group_events_tenant_status_due_idx"
  ON "dynamics_group_events" ("tenant_id", "status", "due_date");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dynamics_group_events_tenant_created_idx"
  ON "dynamics_group_events" ("tenant_id", "created_at");
--> statement-breakpoint

ALTER TABLE dynamics_group_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE dynamics_group_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS tenant_isolation ON dynamics_group_events;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON dynamics_group_events
  USING (current_setting('app.tenant_id', true) IS NULL
         OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
              OR tenant_id = current_setting('app.tenant_id', true)::uuid);
