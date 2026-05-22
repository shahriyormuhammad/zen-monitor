CREATE INDEX "ad_costs_tenant_date_idx" ON "raw_api_ad_costs" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "orders_tenant_date_idx" ON "raw_api_orders" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "orders_tenant_nm_date_idx" ON "raw_api_orders" USING btree ("tenant_id","nm_id","date");--> statement-breakpoint
CREATE INDEX "realization_tenant_date_idx" ON "raw_api_realization_reports" USING btree ("tenant_id","date_from","date_to");--> statement-breakpoint
CREATE INDEX "realization_tenant_nm_date_idx" ON "raw_api_realization_reports" USING btree ("tenant_id","nm_id","date_from");--> statement-breakpoint
CREATE INDEX "sales_tenant_date_idx" ON "raw_api_sales" USING btree ("tenant_id","date");