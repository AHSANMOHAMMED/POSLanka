-- 0147's platform_login_access policy gives every role except app_user full access, which is
-- what platform code needs on managed databases without BYPASSRLS. But when the app runs
-- WITHOUT an app role (DATABASE_APP_ROLE unset, "owner_force_rls" mode) tenant requests also
-- run as the login role, so they must be able to opt out: withTenant sets app.rls_strict='on'
-- for the transaction and the platform policy then no longer applies.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY platform_login_access ON public.%I FOR ALL TO public '
      'USING (current_user <> %L AND COALESCE(current_setting(%L, true), %L) <> %L) '
      'WITH CHECK (current_user <> %L AND COALESCE(current_setting(%L, true), %L) <> %L)',
      t.relname, 'app_user', 'app.rls_strict', '', 'on', 'app_user', 'app.rls_strict', '', 'on');
  END LOOP;
END $$;
