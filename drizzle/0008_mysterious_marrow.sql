CREATE TABLE "signal_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"queue_view" varchar(50) DEFAULT 'all' NOT NULL,
	"assignee_filter" varchar(64) DEFAULT 'all' NOT NULL,
	"workflow_filter" varchar(50) DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD CONSTRAINT "signal_saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD CONSTRAINT "signal_saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_saved_views_user_updated_idx" ON "signal_saved_views" USING btree ("tenant_id","user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_saved_views_user_name_idx" ON "signal_saved_views" USING btree ("tenant_id","user_id","name");