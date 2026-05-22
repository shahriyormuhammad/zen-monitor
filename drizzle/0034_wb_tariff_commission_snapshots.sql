-- Store WB tariffs and category commissions in DB so economics-template
-- never needs to call WB API on page load. Synced via Inngest pipeline.

CREATE TABLE IF NOT EXISTS wb_tariff_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tariff_type VARCHAR(32) NOT NULL, -- 'acceptance', 'box', 'return'
  snapshot_date VARCHAR(10) NOT NULL, -- YYYY-MM-DD
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wb_tariff_snapshot_idx ON wb_tariff_snapshots (tenant_id, tariff_type, snapshot_date);

CREATE TABLE IF NOT EXISTS wb_category_commission_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date VARCHAR(10) NOT NULL, -- YYYY-MM-DD
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS wb_category_commission_idx ON wb_category_commission_snapshots (tenant_id, snapshot_date);
