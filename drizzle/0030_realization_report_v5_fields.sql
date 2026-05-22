-- Add WB API v5 realization report fields for accurate profit and tax calculations
-- retail_price_withdisc_rub: buyer's price after all discounts (correct tax base for USN Доходы)
-- acceptance: intake/receiving fee at WB warehouse (financially material cost)
-- cashback_amount: cashback expense (added WB API July 2025)
-- ppvz_spp_prc: SPP discount percentage applied to transaction
-- ppvz_kvw_prc_base: base WB commission rate before SPP adjustment
-- ppvz_kvw_prc: effective WB commission rate after SPP adjustment

ALTER TABLE raw_api_realization_reports
  ADD COLUMN IF NOT EXISTS retail_price_withdisc_rub NUMERIC(12,2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS acceptance NUMERIC(12,2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS cashback_amount NUMERIC(12,2) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS ppvz_spp_prc NUMERIC(8,4) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS ppvz_kvw_prc_base NUMERIC(8,4) NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS ppvz_kvw_prc NUMERIC(8,4) NOT NULL DEFAULT '0';
