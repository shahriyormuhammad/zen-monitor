ALTER TABLE "risk_signals" ADD COLUMN "workflow_state" varchar(50) DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD COLUMN "assignee_user_id" uuid;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD COLUMN "assignee_email" varchar(255);--> statement-breakpoint
ALTER TABLE "risk_signals" ADD COLUMN "workflow_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD COLUMN "workflow_updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD COLUMN "workflow_updated_by_email" varchar(255);--> statement-breakpoint
ALTER TABLE "signal_operator_timeline" ADD COLUMN "event_type" varchar(50) DEFAULT 'view' NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_operator_timeline" ADD COLUMN "event_body" text;--> statement-breakpoint
ALTER TABLE "signal_operator_timeline" ADD COLUMN "event_payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" varchar(255);--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_workflow_updated_by_user_id_users_id_fk" FOREIGN KEY ("workflow_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "risk_assignee_idx" ON "risk_signals" USING btree ("tenant_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "signal_operator_timeline_event_idx" ON "signal_operator_timeline" USING btree ("tenant_id","event_type","created_at");