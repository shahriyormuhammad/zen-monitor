-- Add production pipeline fields to stock_planning_inputs
-- in_production_qty: units currently being manufactured at factory
-- production_days: estimated production lead time in days

ALTER TABLE stock_planning_inputs
  ADD COLUMN IF NOT EXISTS in_production_qty INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS production_days INTEGER;
