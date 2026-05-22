ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "vat_mode" varchar(50) DEFAULT 'none' NOT NULL,
  ADD COLUMN IF NOT EXISTS "vat_rate" numeric(5, 2) DEFAULT '0.00' NOT NULL;
--> statement-breakpoint
UPDATE "tenants"
SET
  "tax_type" = 'usn_income',
  "tax_rate" = '6.00'
WHERE "tax_type" = 'patent';
