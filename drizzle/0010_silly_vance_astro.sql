ALTER TABLE "signal_saved_views" ADD COLUMN "scope" varchar(20) DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD COLUMN "sort_preset" varchar(50) DEFAULT 'severity' NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_saved_views" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "signal_saved_views_scope_position_idx" ON "signal_saved_views" USING btree ("tenant_id","scope","is_pinned","position");