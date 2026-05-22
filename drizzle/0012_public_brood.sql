CREATE TABLE "signal_automation_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"saved_view_id" uuid,
	"saved_view_name" varchar(120),
	"shared_owner_user_id" uuid,
	"shared_owner_email" varchar(255),
	"actor_user_id" uuid,
	"actor_email" varchar(255) NOT NULL,
	"actor_role" varchar(50) DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD CONSTRAINT "signal_automation_suppressions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD CONSTRAINT "signal_automation_suppressions_saved_view_id_signal_saved_views_id_fk" FOREIGN KEY ("saved_view_id") REFERENCES "public"."signal_saved_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD CONSTRAINT "signal_automation_suppressions_shared_owner_user_id_users_id_fk" FOREIGN KEY ("shared_owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_automation_suppressions" ADD CONSTRAINT "signal_automation_suppressions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_automation_suppressions_tenant_target_idx" ON "signal_automation_suppressions" USING btree ("tenant_id","target_type","created_at");--> statement-breakpoint
CREATE INDEX "signal_automation_suppressions_saved_view_idx" ON "signal_automation_suppressions" USING btree ("tenant_id","saved_view_id");--> statement-breakpoint
CREATE INDEX "signal_automation_suppressions_owner_idx" ON "signal_automation_suppressions" USING btree ("tenant_id","shared_owner_user_id");