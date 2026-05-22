-- Regional sales data from WB API /api/v1/analytics/region-sale
-- Shows WHERE customers order FROM (by federal district), not where stock is located.
-- Used for accurate demand distribution when planning supply shipments.

CREATE TABLE IF NOT EXISTS raw_api_region_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nm_id BIGINT NOT NULL,
  fo_name VARCHAR(255) NOT NULL,
  region_name VARCHAR(255) NOT NULL,
  country_name VARCHAR(128) NOT NULL DEFAULT '',
  sale_qty INTEGER NOT NULL DEFAULT 0,
  sale_cost_price NUMERIC(14,2) NOT NULL DEFAULT '0',
  sale_cost_price_perc NUMERIC(8,4) NOT NULL DEFAULT '0',
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS region_sales_tenant_period_idx ON raw_api_region_sales (tenant_id, period_from, period_to);
CREATE INDEX IF NOT EXISTS region_sales_tenant_nm_fo_idx ON raw_api_region_sales (tenant_id, nm_id, fo_name);
