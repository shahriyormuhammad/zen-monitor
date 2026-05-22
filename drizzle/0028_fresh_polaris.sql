CREATE INDEX "risk_tenant_status_created_idx" ON "risk_signals" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "risk_tenant_status_workflow_idx" ON "risk_signals" USING btree ("tenant_id","status","workflow_state","created_at");--> statement-breakpoint
CREATE INDEX "risk_tenant_status_assignee_idx" ON "risk_signals" USING btree ("tenant_id","status","assignee_user_id","created_at");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");