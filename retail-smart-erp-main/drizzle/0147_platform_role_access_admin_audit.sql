-- 1) Managed PostgreSQL (DigitalOcean, etc.) does not allow BYPASSRLS on the login role.
--    Tables are owned by that login role and most use FORCE ROW LEVEL SECURITY, so platform
--    code (super-admin console, billing, cron, auth lookups) saw no rows / could not insert.
--    Vendor requests always run as app_user (SET LOCAL ROLE in withTenant), so a policy for
--    every role EXCEPT app_user grants the login role exactly what BYPASSRLS would, and
--    tenant isolation for app_user is unchanged.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY platform_login_access ON public.%I FOR ALL TO public USING (current_user <> %L) WITH CHECK (current_user <> %L)',
      t.relname, 'app_user', 'app_user');
  END LOOP;
END $$;
--> statement-breakpoint
-- 2) Super-admin audit trail: admin ids were written to account_id (FK to accounts), so every
--    insert failed and the audit log stayed empty. Record the super admin in its own column.
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS super_admin_id uuid REFERENCES super_admins(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE admin_audit_logs ALTER COLUMN account_id DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admin_audit_logs_super_admin_idx ON admin_audit_logs (super_admin_id, created_at DESC);
