CREATE TABLE "signal_operator_timeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_email" varchar(255) NOT NULL,
	"actor_role" varchar(50) DEFAULT 'viewer' NOT NULL,
	"opened_from" varchar(50) DEFAULT 'overview' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_operator_timeline" ADD CONSTRAINT "signal_operator_timeline_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_operator_timeline" ADD CONSTRAINT "signal_operator_timeline_signal_id_risk_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."risk_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_operator_timeline" ADD CONSTRAINT "signal_operator_timeline_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_operator_timeline_signal_created_idx" ON "signal_operator_timeline" USING btree ("tenant_id","signal_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_operator_timeline_tenant_created_idx" ON "signal_operator_timeline" USING btree ("tenant_id","created_at");