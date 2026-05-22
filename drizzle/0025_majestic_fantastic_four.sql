CREATE TABLE "redistribution_route_availability_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_warehouse" varchar(255) NOT NULL,
	"to_warehouse" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'unknown' NOT NULL,
	"reason" text,
	"source" varchar(50) DEFAULT 'rpa_modal' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redistribution_slot_monitor_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_source" varchar(50) DEFAULT 'scheduler' NOT NULL,
	"mode" varchar(50) DEFAULT 'unknown' NOT NULL,
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"message" text,
	"auto_submit" boolean DEFAULT true NOT NULL,
	"max_routes_per_tenant" integer,
	"probed_items" integer DEFAULT 0 NOT NULL,
	"opened_slots" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redistribution_route_availability_events" ADD CONSTRAINT "redistribution_route_availability_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redistribution_route_availability_events" ADD CONSTRAINT "redistribution_route_availability_events_run_id_redistribution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."redistribution_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redistribution_slot_monitor_runs" ADD CONSTRAINT "redistribution_slot_monitor_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redistribution_route_availability_events_tenant_observed_idx" ON "redistribution_route_availability_events" USING btree ("tenant_id","observed_at");--> statement-breakpoint
CREATE INDEX "redistribution_route_availability_events_tenant_route_observed_idx" ON "redistribution_route_availability_events" USING btree ("tenant_id","from_warehouse","to_warehouse","observed_at");--> statement-breakpoint
CREATE INDEX "redistribution_route_availability_events_tenant_status_observed_idx" ON "redistribution_route_availability_events" USING btree ("tenant_id","status","observed_at");--> statement-breakpoint
CREATE INDEX "redistribution_route_availability_events_tenant_source_observed_idx" ON "redistribution_route_availability_events" USING btree ("tenant_id","source","observed_at");--> statement-breakpoint
CREATE INDEX "redistribution_slot_monitor_runs_tenant_started_idx" ON "redistribution_slot_monitor_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "redistribution_slot_monitor_runs_tenant_status_started_idx" ON "redistribution_slot_monitor_runs" USING btree ("tenant_id","status","started_at");--> statement-breakpoint
CREATE INDEX "redistribution_slot_monitor_runs_tenant_skipped_started_idx" ON "redistribution_slot_monitor_runs" USING btree ("tenant_id","skipped","started_at");