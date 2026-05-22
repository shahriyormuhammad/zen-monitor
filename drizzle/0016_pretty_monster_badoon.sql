CREATE TABLE "raw_api_stock_offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"stock_type" varchar(16) DEFAULT 'wb' NOT NULL,
	"region_name" varchar(255) NOT NULL,
	"office_id" bigint,
	"office_name" varchar(255) NOT NULL,
	"orders_count" numeric(14, 2) DEFAULT '0' NOT NULL,
	"orders_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"buyout_count" numeric(14, 2) DEFAULT '0' NOT NULL,
	"buyout_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"stock_count" integer DEFAULT 0 NOT NULL,
	"stock_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"to_client_count" integer DEFAULT 0 NOT NULL,
	"from_client_count" integer DEFAULT 0 NOT NULL,
	"lost_orders_count" numeric(14, 2) DEFAULT '0' NOT NULL,
	"lost_orders_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"avg_stock_turnover_days" numeric(10, 2),
	"sale_rate_days" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_stock_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"stock_type" varchar(16) DEFAULT 'wb' NOT NULL,
	"nm_id" bigint NOT NULL,
	"size_name" varchar(64) NOT NULL,
	"chrt_id" bigint,
	"region_name" varchar(255) NOT NULL,
	"office_id" bigint,
	"office_name" varchar(255) NOT NULL,
	"orders_count" numeric(14, 2) DEFAULT '0' NOT NULL,
	"orders_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"buyout_count" numeric(14, 2) DEFAULT '0' NOT NULL,
	"buyout_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"stock_count" integer DEFAULT 0 NOT NULL,
	"stock_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"to_client_count" integer DEFAULT 0 NOT NULL,
	"from_client_count" integer DEFAULT 0 NOT NULL,
	"lost_orders_count" numeric(14, 2) DEFAULT '0' NOT NULL,
	"lost_orders_sum" numeric(14, 2) DEFAULT '0' NOT NULL,
	"avg_stock_turnover_days" numeric(10, 2),
	"sale_rate_days" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_api_stock_offices" ADD CONSTRAINT "raw_api_stock_offices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_stock_sizes" ADD CONSTRAINT "raw_api_stock_sizes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_offices_composite_idx" ON "raw_api_stock_offices" USING btree ("tenant_id","snapshot_date","stock_type","region_name","office_id","office_name");--> statement-breakpoint
CREATE INDEX "stock_offices_period_idx" ON "raw_api_stock_offices" USING btree ("tenant_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_sizes_composite_idx" ON "raw_api_stock_sizes" USING btree ("tenant_id","snapshot_date","stock_type","nm_id","size_name","chrt_id","region_name","office_id","office_name");--> statement-breakpoint
CREATE INDEX "stock_sizes_nm_period_idx" ON "raw_api_stock_sizes" USING btree ("tenant_id","nm_id","period_start","period_end");