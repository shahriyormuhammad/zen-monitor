CREATE TABLE "signal_automation_control_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"automation_type" varchar(50) DEFAULT 'sla' NOT NULL,
	"automation_source" varchar(50) DEFAULT 'manual' NOT NULL,
	"trigger_type" varchar(50) DEFAULT 'ad_hoc' NOT NULL,
	"trigger_label" varchar(120),
	"actor_user_id" uuid,
	"actor_email" varchar(255) NOT NULL,
	"actor_role" varchar(50) DEFAULT 'viewer' NOT NULL,
	"saved_view_id" uuid,
	"saved_view_name" varchar(120),
	"shared_owner_user_id" uuid,
	"shared_owner_email" varchar(255),
	"linked_event_id" uuid,
	"automation_run_id" uuid,
	"target_type" varchar(50),
	"reason" text,
	"suppress_until" timestamp with time zone,
	"target_signal_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"awaiting_outcome_count" integer DEFAULT 0 NOT NULL,
	"matched_suppression_count" integer DEFAULT 0 NOT NULL,
	"applied_presets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD COLUMN "suppress_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD COLUMN "cleared_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD COLUMN "cleared_by_email" varchar(255);--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD COLUMN "cleared_by_role" varchar(50);--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD COLUMN "clear_reason" text;--> statement-breakpoint
ALTER TABLE "signal_automation_control_events" ADD CONSTRAINT "signal_automation_control_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_control_events" ADD CONSTRAINT "signal_automation_control_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_control_events" ADD CONSTRAINT "signal_automation_control_events_saved_view_id_signal_saved_views_id_fk" FOREIGN KEY ("saved_view_id") REFERENCES "public"."signal_saved_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_control_events" ADD CONSTRAINT "signal_automation_control_events_shared_owner_user_id_users_id_fk" FOREIGN KEY ("shared_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_control_events" ADD CONSTRAINT "signal_automation_control_events_automation_run_id_signal_automation_runs_id_fk" FOREIGN KEY ("automation_run_id") REFERENCES "public"."signal_automation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_automation_control_events_tenant_created_idx" ON "signal_automation_control_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_automation_control_events_event_type_idx" ON "signal_automation_control_events" USING btree ("tenant_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "signal_automation_control_events_run_idx" ON "signal_automation_control_events" USING btree ("tenant_id","automation_run_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_automation_control_events_linked_idx" ON "signal_automation_control_events" USING btree ("tenant_id","linked_event_id","created_at");--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD CONSTRAINT "signal_automation_suppressions_cleared_by_user_id_users_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_automation_suppressions_active_idx" ON "signal_automation_suppressions" USING btree ("tenant_id","target_type","cleared_at","suppress_until","created_at");