-- Pooled connections keep custom settings: after a transaction that ran
-- set_config('app.tenant_id', <id>, true), current_setting('app.tenant_id', true) returns ''
-- (not NULL) on that connection. Policies written as current_setting(...)::uuid then raise
-- "invalid input syntax for type uuid" whenever they are evaluated - which happens for the
-- login role on managed databases (DigitalOcean: owner + FORCE RLS, no BYPASSRLS).
-- Rewrite every policy to NULLIF(current_setting(...), '')::uuid; behaviour is otherwise identical.
DO $$
DECLARE
  p record;
  guarded constant text := 'NULLIF(current_setting(''app.tenant_id''::text, true), ''''::text)';
  raw constant text := 'current_setting(''app.tenant_id''::text, true)';
  newq text;
  newc text;
  role_list text;
BEGIN
  FOR p IN
    SELECT * FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%' || raw || '%'
  LOOP
    newq := p.qual;
    newc := p.with_check;
    IF newq IS NOT NULL THEN
      newq := replace(replace(replace(newq, guarded, '@@GUARDED@@'), raw, guarded), '@@GUARDED@@', guarded);
    END IF;
    IF newc IS NOT NULL THEN
      newc := replace(replace(replace(newc, guarded, '@@GUARDED@@'), raw, guarded), '@@GUARDED@@', guarded);
    END IF;
    IF newq IS NOT DISTINCT FROM p.qual AND newc IS NOT DISTINCT FROM p.with_check THEN
      CONTINUE;
    END IF;
    SELECT string_agg(CASE WHEN r = 'public' THEN 'public' ELSE quote_ident(r) END, ', ')
      INTO role_list FROM unnest(p.roles) AS r;
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s',
      p.policyname, p.tablename, p.permissive, p.cmd, role_list,
      CASE WHEN newq IS NOT NULL THEN ' USING (' || newq || ')' ELSE '' END,
      CASE WHEN newc IS NOT NULL THEN ' WITH CHECK (' || newc || ')' ELSE '' END);
  END LOOP;
END $$;
