CREATE TABLE "signal_automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
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
	"target_signal_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"applied_presets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'completed' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD COLUMN "shared_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD COLUMN "shared_owner_email" varchar(255);--> statement-breakpoint
ALTER TABLE "signal_automation_runs" ADD CONSTRAINT "signal_automation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_runs" ADD CONSTRAINT "signal_automation_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_runs" ADD CONSTRAINT "signal_automation_runs_saved_view_id_signal_saved_views_id_fk" FOREIGN KEY ("saved_view_id") REFERENCES "public"."signal_saved_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_runs" ADD CONSTRAINT "signal_automation_runs_shared_owner_user_id_users_id_fk" FOREIGN KEY ("shared_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_automation_runs_tenant_created_idx" ON "signal_automation_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_automation_runs_tenant_status_idx" ON "signal_automation_runs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "signal_automation_runs_saved_view_idx" ON "signal_automation_runs" USING btree ("tenant_id","saved_view_id","created_at");--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD CONSTRAINT "signal_saved_views_shared_owner_user_id_users_id_fk" FOREIGN KEY ("shared_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;