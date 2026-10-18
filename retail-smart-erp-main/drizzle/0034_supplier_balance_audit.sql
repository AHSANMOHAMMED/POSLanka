-- Migration 0033: Supplier Balance Audit Trail
-- Tracks all changes to supplier balances with full audit history

-- ============================================================
-- 1. Create supplier_balance_audit table
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_balance_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  type VARCHAR(50) NOT NULL, -- 'purchase', 'payment', 'cancel', 'adjustment', 'delete'
  amount DECIMAL(12,2) NOT NULL,
  previous_balance DECIMAL(12,2) NOT NULL,
  new_balance DECIMAL(12,2) NOT NULL,
  reference_type VARCHAR(50), -- 'purchase', 'purchase_payment'
  reference_id UUID,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Create indexes for efficient querying
-- ============================================================
CREATE INDEX idx_supplier_balance_audit_tenant ON supplier_balance_audit(tenant_id);
CREATE INDEX idx_supplier_balance_audit_supplier ON supplier_balance_audit(supplier_id);
CREATE INDEX idx_supplier_balance_audit_created ON supplier_balance_audit(created_at);
CREATE INDEX idx_supplier_balance_audit_type ON supplier_balance_audit(type);
CREATE INDEX idx_supplier_balance_audit_reference ON supplier_balance_audit(reference_type, reference_id);

-- ============================================================
-- 3. Enable Row Level Security
-- ============================================================
ALTER TABLE supplier_balance_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON supplier_balance_audit
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- 4. Grant access to app_user
-- ============================================================
GRANT ALL ON supplier_balance_audit TO app_user;
