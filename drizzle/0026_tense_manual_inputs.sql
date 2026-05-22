CREATE TABLE "unit_economics_manual_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"manual_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_economics_manual_inputs" ADD CONSTRAINT "unit_economics_manual_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "unit_economics_manual_inputs_tenant_nm_idx" ON "unit_economics_manual_inputs" USING btree ("tenant_id","nm_id");
--> statement-breakpoint
CREATE INDEX "unit_economics_manual_inputs_tenant_updated_idx" ON "unit_economics_manual_inputs" USING btree ("tenant_id","updated_at");
