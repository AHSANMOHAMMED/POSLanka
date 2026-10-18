-- Migration: Cancellation Reasons per tenant
-- Stores business-type-specific cancellation reasons by document type

CREATE TABLE IF NOT EXISTS cancellation_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  document_type VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Create index for common query pattern
CREATE INDEX idx_cancellation_reasons_tenant_doctype
  ON cancellation_reasons(tenant_id, document_type);

-- Enable RLS
ALTER TABLE cancellation_reasons ENABLE ROW LEVEL SECURITY;

-- RLS policy for tenant isolation
CREATE POLICY tenant_isolation_policy ON cancellation_reasons
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grant permissions to app_user
GRANT SELECT, INSERT, UPDATE, DELETE ON cancellation_reasons TO app_user;
