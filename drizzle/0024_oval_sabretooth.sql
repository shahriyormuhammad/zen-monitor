CREATE TABLE "advertising_bid_pacing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" varchar(160) NOT NULL,
	"advert_id" bigint NOT NULL,
	"nm_id" bigint NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"daily_budget_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
	"soft_cap_pct" numeric(8, 2) DEFAULT '85' NOT NULL,
	"step_down_pct" numeric(8, 2) DEFAULT '20' NOT NULL,
	"min_bid" integer DEFAULT 100 NOT NULL,
	"max_bid" integer DEFAULT 5000 NOT NULL,
	"daypart_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Moscow' NOT NULL,
	"interval_minutes" integer DEFAULT 20 NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_status" varchar(32),
	"last_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertising_bid_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" varchar(160) NOT NULL,
	"brand_filter" varchar(255),
	"nm_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"target_acos_pct" numeric(8, 2) DEFAULT '25' NOT NULL,
	"min_orders" integer DEFAULT 2 NOT NULL,
	"max_cpc_rub" numeric(10, 2) DEFAULT '80' NOT NULL,
	"daily_budget_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
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
ALTER TABLE "tenants" ADD COLUMN "reviews_auto_reply_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "advertising_bid_pacing_rules" ADD CONSTRAINT "advertising_bid_pacing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_bid_pacing_rules" ADD CONSTRAINT "advertising_bid_pacing_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_bid_portfolios" ADD CONSTRAINT "advertising_bid_portfolios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertising_bid_portfolios" ADD CONSTRAINT "advertising_bid_portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertising_bid_pacing_rules_tenant_idx" ON "advertising_bid_pacing_rules" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_pacing_rules_tenant_enabled_idx" ON "advertising_bid_pacing_rules" USING btree ("tenant_id","is_enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_pacing_rules_tenant_advert_nm_idx" ON "advertising_bid_pacing_rules" USING btree ("tenant_id","advert_id","nm_id","updated_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_portfolios_tenant_idx" ON "advertising_bid_portfolios" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_portfolios_tenant_enabled_idx" ON "advertising_bid_portfolios" USING btree ("tenant_id","is_enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "advertising_bid_portfolios_tenant_updated_idx" ON "advertising_bid_portfolios" USING btree ("tenant_id","updated_at");