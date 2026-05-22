CREATE TABLE "redistribution_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_source" varchar(50) DEFAULT 'scheduled_daily' NOT NULL,
	"status" varchar(50) DEFAULT 'planned' NOT NULL,
	"requested_from" timestamp with time zone NOT NULL,
	"requested_to" timestamp with time zone NOT NULL,
	"snapshot_date" timestamp with time zone,
	"snapshot_period_from" timestamp with time zone,
	"snapshot_period_to" timestamp with time zone,
	"requested_date_window_days" integer DEFAULT 0 NOT NULL,
	"effective_date_window_days" integer DEFAULT 0 NOT NULL,
	"window_aligned" boolean DEFAULT true NOT NULL,
	"methodology" varchar(120) NOT NULL,
	"recommendation_count" integer DEFAULT 0 NOT NULL,
	"sku_count" integer DEFAULT 0 NOT NULL,
	"transfer_units" integer DEFAULT 0 NOT NULL,
	"estimated_savings_rub" numeric(15, 2) DEFAULT '0' NOT NULL,
	"current_krp_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"simulated_krp_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"current_local_share_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"simulated_local_share_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"assumptions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"csv_file_path" text,
	"csv_file_name" varchar(255),
	"csv_checksum_sha256" varchar(64),
	"csv_generated_at" timestamp with time zone,
	"telegram_sent_at" timestamp with time zone,
	"telegram_message_id" bigint,
	"rpa_requested_at" timestamp with time zone,
	"rpa_started_at" timestamp with time zone,
	"rpa_finished_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redistribution_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'planned' NOT NULL,
	"nm_id" bigint NOT NULL,
	"vendor_code" varchar(255),
	"brand" varchar(255),
	"size_name" varchar(64) NOT NULL,
	"chrt_id" bigint,
	"from_region_name" varchar(255) NOT NULL,
	"from_warehouse" varchar(255) NOT NULL,
	"from_office_id" bigint,
	"to_region_name" varchar(255) NOT NULL,
	"to_warehouse" varchar(255) NOT NULL,
	"to_office_id" bigint,
	"transfer_units" integer NOT NULL,
	"priority_score" numeric(12, 2) DEFAULT '0' NOT NULL,
	"estimated_savings_rub" numeric(15, 2) DEFAULT '0' NOT NULL,
	"current_local_share_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"simulated_local_share_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"current_krp_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"simulated_krp_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"from_coverage_days_before" numeric(10, 2),
	"to_coverage_days_before" numeric(10, 2),
	"application_comment" text,
	"execution_note" text,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redistribution_runs" ADD CONSTRAINT "redistribution_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "redistribution_items" ADD CONSTRAINT "redistribution_items_run_id_redistribution_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."redistribution_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "redistribution_items" ADD CONSTRAINT "redistribution_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "redistribution_runs_tenant_created_idx" ON "redistribution_runs" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "redistribution_runs_tenant_status_idx" ON "redistribution_runs" USING btree ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "redistribution_runs_tenant_window_idx" ON "redistribution_runs" USING btree ("tenant_id","requested_from","requested_to");
--> statement-breakpoint
CREATE INDEX "redistribution_items_run_idx" ON "redistribution_items" USING btree ("run_id","status");
--> statement-breakpoint
CREATE INDEX "redistribution_items_tenant_status_idx" ON "redistribution_items" USING btree ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "redistribution_items_tenant_nm_idx" ON "redistribution_items" USING btree ("tenant_id","nm_id","created_at");
