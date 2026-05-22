ALTER TABLE "raw_api_stocks" ADD COLUMN "in_way_to_client" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_api_stocks" ADD COLUMN "in_way_from_client" integer DEFAULT 0 NOT NULL;