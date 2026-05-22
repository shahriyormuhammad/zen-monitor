CREATE TABLE "signal_notification_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_notification_receipts" ADD CONSTRAINT "signal_notification_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_notification_receipts" ADD CONSTRAINT "signal_notification_receipts_event_id_signal_operator_timeline_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."signal_operator_timeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_notification_receipts" ADD CONSTRAINT "signal_notification_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_notification_receipt_unique_idx" ON "signal_notification_receipts" USING btree ("tenant_id","event_id","user_id");--> statement-breakpoint
CREATE INDEX "signal_notification_receipt_user_idx" ON "signal_notification_receipts" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_notification_receipt_ack_idx" ON "signal_notification_receipts" USING btree ("tenant_id","user_id","acknowledged_at");