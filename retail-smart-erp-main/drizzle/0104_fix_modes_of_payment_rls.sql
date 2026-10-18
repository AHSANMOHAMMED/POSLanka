-- Fix: modes_of_payment has RLS enabled but no policy (blocks all operations for app_user)
-- This was missed when the table was created

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polrelid = 'modes_of_payment'::regclass AND polname = 'tenant_isolation_policy'
  ) THEN
    CREATE POLICY tenant_isolation_policy ON modes_of_payment
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Grant permissions to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON modes_of_payment TO app_user;

-- Cleanup: drop leftover renamed table
DROP TABLE IF EXISTS pos_profiles_old;
