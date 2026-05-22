CREATE TABLE "stock_planning_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"own_stock" integer DEFAULT 0 NOT NULL,
	"in_transit_china" integer DEFAULT 0 NOT NULL,
	"in_transit_eta_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_planning_inputs" ADD CONSTRAINT "stock_planning_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_planning_tenant_nm_idx" ON "stock_planning_inputs" USING btree ("tenant_id","nm_id");--> statement-breakpoint
CREATE INDEX "stock_planning_tenant_updated_idx" ON "stock_planning_inputs" USING btree ("tenant_id","updated_at");