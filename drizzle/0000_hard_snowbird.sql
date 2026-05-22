CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"vendor_code" varchar(255) NOT NULL,
	"barcode" varchar(255),
	"brand" varchar(255),
	"category" varchar(255),
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_orders" (
	"srid" varchar(255) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"total_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_cancel" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_realization_reports" (
	"rrd_id" bigint PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"realizationreport_id" bigint NOT NULL,
	"date_from" timestamp with time zone NOT NULL,
	"date_to" timestamp with time zone NOT NULL,
	"nm_id" bigint NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"retail_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"commission_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"delivery_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
	"storage_fee_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
	"penalty_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
	"spp_rub" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"wb_api_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_economics_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"cost_price" numeric(12, 2) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_orders" ADD CONSTRAINT "raw_api_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD CONSTRAINT "raw_api_realization_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_economics_configs" ADD CONSTRAINT "unit_economics_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;