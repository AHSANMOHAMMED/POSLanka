-- Fix for ai_error_logs RLS policy issue
-- This table was missing from the comprehensive RLS policies

-- Enable RLS on ai_error_logs if not already enabled
ALTER TABLE ai_error_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "ai_error_logs_tenant_isolation" ON ai_error_logs;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON ai_error_logs;

-- Create proper RLS policy for ai_error_logs
-- This table has nullable tenant_id for system-wide errors
CREATE POLICY tenant_isolation_policy ON ai_error_logs
  FOR ALL 
  USING (
    tenant_id IS NULL 
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id IS NULL 
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Force RLS on ai_error_logs
ALTER TABLE ai_error_logs FORCE ROW LEVEL SECURITY;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_ai_error_logs_tenant_id ON ai_error_logs(tenant_id);

-- Also fix ai_alerts table which has the same issue
ALTER TABLE ai_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_alerts_tenant_isolation" ON ai_alerts;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON ai_alerts;

CREATE POLICY tenant_isolation_policy ON ai_alerts
  FOR ALL 
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE ai_alerts FORCE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_alerts_tenant_id ON ai_alerts(tenant_id);