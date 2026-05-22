-- P73: гибридные режимы ставок (CPM / ROAS / DRR / Hybrid).
-- Legacy-стратегии получают default `drr`, что воспроизводит прежнее поведение.

ALTER TABLE advertising_auto_bid_strategies
  ADD COLUMN IF NOT EXISTS bidding_mode varchar(16) NOT NULL DEFAULT 'drr',
  ADD COLUMN IF NOT EXISTS target_cpm_rub numeric(10, 2) NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS target_roas numeric(8, 2) NOT NULL DEFAULT 4;

ALTER TABLE advertising_auto_bid_strategies
  DROP CONSTRAINT IF EXISTS advertising_auto_bid_strategies_bidding_mode_check;

ALTER TABLE advertising_auto_bid_strategies
  ADD CONSTRAINT advertising_auto_bid_strategies_bidding_mode_check
    CHECK (bidding_mode IN ('drr', 'cpm', 'roas', 'hybrid'));
