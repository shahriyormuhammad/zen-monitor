CREATE TABLE "advertising_auto_bid_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger_source" varchar(32) DEFAULT 'manual' NOT NULL,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "advertising_auto_bid_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" varchar(160) NOT NULL,
	"advert_id" bigint NOT NULL,
	"nm_id" bigint NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"target_acos_pct" numeric(8, 2) DEFAULT '25' NOT NULL,
	"min_orders" integer DEFAULT 2 NOT NULL,
	"max_cpc_rub" numeric(10, 2) DEFAULT '80' NOT NULL,
	"min_bid" integer DEFAULT 100 NOT NULL,
	"max_bid" integer DEFAULT 5000 NOT NULL,
	"step_up_pct" numeric(8, 2) DEFAULT '10' NOT NULL,
	"step_down_pct" numeric(8, 2) DEFAULT '10' NOT NULL,
	"lookback_days" integer DEFAULT 7 NOT NULL,
	"interval_minutes" integer DEFAULT 60 NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_status" varchar(32),
	"last_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertising_bid_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"strategy_id" uuid,
	"run_id" uuid,
	"user_id" uuid,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"advert_id" bigint NOT NULL,
	"nm_id" bigint NOT NULL,
	"cluster" varchar(500) NOT NULL,
	"previous_bid" integer,
	"next_bid" integer,
	"status" varchar(32) DEFAULT 'applied' NOT NULL,
	"reason" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advertising_auto_bid_runs" ADD CONSTRAINT "advertising_auto_bid_runs_strategy_id_advertising_auto_bid_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."advertising_auto_bid_strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_auto_bid_runs" ADD CONSTRAINT "advertising_auto_bid_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_auto_bid_strategies" ADD CONSTRAINT "advertising_auto_bid_strategies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_auto_bid_strategies" ADD CONSTRAINT "advertising_auto_bid_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_bid_changes" ADD CONSTRAINT "advertising_bid_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_bid_changes" ADD CONSTRAINT "advertising_bid_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertising_auto_bid_runs_tenant_idx" ON "advertising_auto_bid_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "advertising_auto_bid_runs_strategy_idx" ON "advertising_auto_bid_runs" USING btree ("strategy_id","started_at");--> statement-breakpoint
CREATE INDEX "advertising_auto_bid_runs_tenant_status_idx" ON "advertising_auto_bid_runs" USING btree ("tenant_id","status","started_at");--> statement-breakpoint
CREATE INDEX "advertising_auto_bid_strategies_tenant_idx" ON "advertising_auto_bid_strategies" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "advertising_auto_bid_strategies_tenant_enabled_idx" ON "advertising_auto_bid_strategies" USING btree ("tenant_id","is_enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "advertising_auto_bid_strategies_tenant_advert_nm_idx" ON "advertising_auto_bid_strategies" USING btree ("tenant_id","advert_id","nm_id","updated_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_changes_tenant_idx" ON "advertising_bid_changes" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_changes_tenant_source_idx" ON "advertising_bid_changes" USING btree ("tenant_id","source","created_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_changes_tenant_strategy_idx" ON "advertising_bid_changes" USING btree ("tenant_id","strategy_id","created_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_changes_tenant_run_idx" ON "advertising_bid_changes" USING btree ("tenant_id","run_id","created_at");