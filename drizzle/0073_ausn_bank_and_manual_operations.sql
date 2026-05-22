ALTER TABLE "ausn_monthly_inputs"
  ADD COLUMN IF NOT EXISTS "bank_income_return" numeric(14, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "bank_expense" numeric(14, 2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS "bank_expense_return" numeric(14, 2) NOT NULL DEFAULT '0';
--> statement-breakpoint

ALTER TABLE "ausn_document_rows"
  DROP CONSTRAINT IF EXISTS "ausn_document_rows_document_type_check";
--> statement-breakpoint

ALTER TABLE "ausn_document_rows"
  ADD CONSTRAINT "ausn_document_rows_document_type_check"
    CHECK ("document_type" IN (
      'buyout_income',
      'weekly_withholding',
      'weekly_withholding_return',
      'detail_income',
      'detail_income_return',
      'upd_expense',
      'ukd_expense_return',
      'manual_income',
      'manual_income_return',
      'manual_expense',
      'manual_expense_return'
    ));
