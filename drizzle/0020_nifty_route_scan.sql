CREATE TABLE "redistribution_warehouse_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_name" varchar(255) NOT NULL,
	"office_id" bigint,
	"source" varchar(50) DEFAULT 'stock_snapshot' NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redistribution_warehouse_registry" ADD CONSTRAINT "redistribution_warehouse_registry_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "redistribution_warehouse_registry_tenant_warehouse_idx" ON "redistribution_warehouse_registry" USING btree ("tenant_id","warehouse_name");
--> statement-breakpoint
CREATE INDEX "redistribution_warehouse_registry_tenant_status_idx" ON "redistribution_warehouse_registry" USING btree ("tenant_id","status","last_seen_at");
--> statement-breakpoint
CREATE TABLE "redistribution_route_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_warehouse" varchar(255) NOT NULL,
	"to_warehouse" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'unknown' NOT NULL,
	"reason" text,
	"source" varchar(50) DEFAULT 'rpa_modal' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_run_id" uuid,
	"success_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redistribution_route_availability" ADD CONSTRAINT "redistribution_route_availability_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "redistribution_route_availability" ADD CONSTRAINT "redistribution_route_availability_last_run_id_redistribution_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."redistribution_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "redistribution_route_availability_tenant_route_idx" ON "redistribution_route_availability" USING btree ("tenant_id","from_warehouse","to_warehouse");
--> statement-breakpoint
CREATE INDEX "redistribution_route_availability_tenant_status_idx" ON "redistribution_route_availability" USING btree ("tenant_id","status","last_checked_at");
--> statement-breakpoint
CREATE INDEX "redistribution_route_availability_tenant_expires_idx" ON "redistribution_route_availability" USING btree ("tenant_id","expires_at");
