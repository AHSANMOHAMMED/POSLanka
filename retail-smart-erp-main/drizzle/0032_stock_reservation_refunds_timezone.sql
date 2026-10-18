-- Migration 0031: Stock Reservation, Refund Tracking, Configurable Timezone
-- 8G: Materialized reserved_stock on warehouse_stock
-- 8K: Refund audit trail table
-- 8L: Tenant-level timezone setting

-- ============================================================
-- 1. Add reserved_stock to warehouse_stock (8G)
-- ============================================================
ALTER TABLE warehouse_stock ADD COLUMN IF NOT EXISTS reserved_stock DECIMAL(12,3) NOT NULL DEFAULT 0;

-- Backfill from currently approved transfers (in_transit already deducted from currentStock)
UPDATE warehouse_stock ws SET reserved_stock = COALESCE((
  SELECT SUM(CAST(sti.quantity AS DECIMAL))
  FROM stock_transfer_items sti
  JOIN stock_transfers st ON sti.transfer_id = st.id
  WHERE st.from_warehouse_id = ws.warehouse_id
    AND sti.item_id = ws.item_id
    AND st.status = 'approved'
    AND st.tenant_id = ws.tenant_id
), 0);

-- ============================================================
-- 2. Create refunds table (8K)
-- ============================================================
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  sale_id UUID NOT NULL REFERENCES sales(id),
  original_sale_id UUID REFERENCES sales(id),
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(50) NOT NULL,
  processed_by UUID REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for refunds
CREATE INDEX IF NOT EXISTS idx_refunds_tenant ON refunds(tenant_id);
CREATE INDEX IF NOT EXISTS idx_refunds_sale ON refunds(sale_id);
CREATE INDEX IF NOT EXISTS idx_refunds_original_sale ON refunds(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at);

-- Enable RLS on refunds
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON refunds
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grant access to app_user
GRANT ALL ON refunds TO app_user;

-- ============================================================
-- 3. Add timezone to tenants (8L)
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Colombo';
