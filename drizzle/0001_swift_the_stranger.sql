CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'viewer' NOT NULL,
	"token" varchar(255) NOT NULL,
	"invited_by" uuid NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_ad_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"cluster" varchar(500) NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"ctr" numeric(12, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_ad_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"type" varchar(100),
	"placement" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_funnel_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"open_card_count" integer DEFAULT 0 NOT NULL,
	"add_to_cart_count" integer DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"order_sum" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_paid_storage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"warehouse_name" varchar(255),
	"nm_id" bigint NOT NULL,
	"storage_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"spp" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_product_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"title" varchar(255),
	"description" text,
	"photos_count" integer DEFAULT 0 NOT NULL,
	"has_video" boolean DEFAULT false NOT NULL,
	"characteristics_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" varchar(255) NOT NULL,
	"nm_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"price_with_discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"warehouse_name" varchar(255),
	"is_storno" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_api_stocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint NOT NULL,
	"warehouse_name" varchar(255) NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nm_id" bigint,
	"type" varchar(100) NOT NULL,
	"severity" varchar(50) DEFAULT 'medium' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"impact_rub" numeric(15, 2) DEFAULT '0',
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" varchar(50) DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "box_delivery_base" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "box_delivery_liter" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "box_storage_base" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "box_storage_liter" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "payment_schedule_rub" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "shop_name" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tax_type" varchar(50) DEFAULT 'usn_income' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tax_rate" numeric(5, 2) DEFAULT '6.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "telegram_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_group_members" ADD CONSTRAINT "product_group_members_group_id_product_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_ad_clusters" ADD CONSTRAINT "raw_api_ad_clusters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_ad_costs" ADD CONSTRAINT "raw_api_ad_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_funnel_stats" ADD CONSTRAINT "raw_api_funnel_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_paid_storage" ADD CONSTRAINT "raw_api_paid_storage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_prices" ADD CONSTRAINT "raw_api_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_product_metadata" ADD CONSTRAINT "raw_api_product_metadata_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_sales" ADD CONSTRAINT "raw_api_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_api_stocks" ADD CONSTRAINT "raw_api_stocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_idx" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_email_tenant_idx" ON "invitations" USING btree ("email","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_nm_unique_idx" ON "product_group_members" USING btree ("group_id","nm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_clusters_composite_idx" ON "raw_api_ad_clusters" USING btree ("tenant_id","nm_id","date","cluster");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_costs_composite_idx" ON "raw_api_ad_costs" USING btree ("tenant_id","nm_id","date","placement");--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_stats_tenant_nm_date_idx" ON "raw_api_funnel_stats" USING btree ("tenant_id","nm_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "paid_storage_composite_idx" ON "raw_api_paid_storage" USING btree ("tenant_id","nm_id","warehouse_name","date");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_nm_price_idx" ON "raw_api_prices" USING btree ("tenant_id","nm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_tenant_nm_idx" ON "raw_api_product_metadata" USING btree ("tenant_id","nm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_composite_v2_idx" ON "raw_api_sales" USING btree ("tenant_id","nm_id","sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stocks_composite_idx" ON "raw_api_stocks" USING btree ("tenant_id","nm_id","warehouse_name");--> statement-breakpoint
CREATE INDEX "risk_tenant_idx" ON "risk_signals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "risk_nm_idx" ON "risk_signals" USING btree ("nm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_tenant_unique_idx" ON "user_tenants" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_nm_id_idx" ON "products" USING btree ("tenant_id","nm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "config_historical_idx" ON "unit_economics_configs" USING btree ("tenant_id","nm_id","effective_from");