ALTER TABLE "raw_api_realization_reports" ADD COLUMN "ppvz_for_pay" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "deduction" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "additional_payment" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "acquiring_fee" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_api_realization_reports" ADD COLUMN "return_amount" numeric(12, 2) DEFAULT '0' NOT NULL;
