-- Fix RLS policy for ai_error_logs to properly handle NULL current_setting
-- The previous policy failed when current_setting('app.tenant_id', true) returned NULL
-- (when the setting wasn't set), because NULLIF(NULL, '') returns NULL and
-- tenant_id = NULL::uuid is always false.

-- Drop existing policy
DROP POLICY IF EXISTS tenant_isolation_policy ON ai_error_logs;

-- Create corrected policy for ai_error_logs
-- Allows:
-- 1. tenant_id IS NULL (system-wide errors) - always allowed
-- 2. tenant_id = current_setting::uuid, but only if current_setting is NOT NULL and not empty
CREATE POLICY tenant_isolation_policy ON ai_error_logs
  FOR ALL
  USING (
    tenant_id IS NULL
    OR (
      NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id IS NULL
    OR (
      NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

-- Also fix ai_alerts table which has similar issue
DROP POLICY IF EXISTS tenant_isolation_policy ON ai_alerts;

-- ai_alerts table requires tenant_id (NOT NULL), so we don't need NULL check
CREATE POLICY tenant_isolation_policy ON ai_alerts
  FOR ALL
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );