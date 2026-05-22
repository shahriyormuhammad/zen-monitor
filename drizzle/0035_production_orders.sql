-- Production pipeline: track manufacturing batches with status history
-- Status flow: ordered → in_production → shipped → customs → delivered

CREATE TABLE IF NOT EXISTS production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nm_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ordered',
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  production_started_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  customs_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  estimated_delivery_at TIMESTAMPTZ,
  tracking_number VARCHAR(255),
  supplier_name VARCHAR(255),
  cost_per_unit NUMERIC(12, 2),
  total_cost NUMERIC(14, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_orders_tenant_nm_status_idx
  ON production_orders(tenant_id, nm_id, status);

CREATE INDEX IF NOT EXISTS production_orders_tenant_status_idx
  ON production_orders(tenant_id, status);
