CREATE TABLE "advertising_cluster_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"advert_id" bigint NOT NULL,
	"nm_id" bigint NOT NULL,
	"cluster" varchar(500) NOT NULL,
	"action" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'success' NOT NULL,
	"before_minus_count" integer DEFAULT 0 NOT NULL,
	"after_minus_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advertising_cluster_actions" ADD CONSTRAINT "advertising_cluster_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_cluster_actions" ADD CONSTRAINT "advertising_cluster_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertising_cluster_actions_tenant_idx" ON "advertising_cluster_actions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "advertising_cluster_actions_tenant_nm_cluster_idx" ON "advertising_cluster_actions" USING btree ("tenant_id","nm_id","cluster","created_at");--> statement-breakpoint
CREATE INDEX "advertising_cluster_actions_tenant_advert_idx" ON "advertising_cluster_actions" USING btree ("tenant_id","advert_id","created_at");