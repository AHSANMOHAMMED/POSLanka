-- W10b: close tenant-isolation gaps on pre-existing tables.
-- Idempotent: every policy is dropped before it is (re)created; ENABLE/FORCE RLS are idempotent.
--
-- Policy vocabulary used below
--   tenant_isolation_policy  rows of the current tenant (app.tenant_id), TO PUBLIC like the
--                            existing tenant tables so it also works in "owner_force_rls" mode.
--   global_rows_read_policy  shared/system rows (tenant_id IS NULL): READ-ONLY for tenant code.
--   platform_login_access    the plain `db` connection (login role, no tenant context set) keeps
--                            full access. It never matches app_user and never matches a connection
--                            that has app.tenant_id set, so tenant code cannot use it.
--                            (Superuser / BYPASSRLS login roles bypass RLS anyway; this policy keeps
--                            account dashboard, billing, cron, auth and super admin working when the
--                            login role is a plain, non-bypass member of app_user.)

-- ---------------------------------------------------------------------------
-- a) Tenant business data, only accessed through tenant helpers
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotations', 'quotation_items', 'credit_notes', 'credit_note_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- b/c) Platform / account-level tables. Written by the plain db (billing, auth, cron,
--      account dashboard, super admin). Tenant code may only READ its own rows
--      (account_tenants: read + update, used by users/[id] status sync).
--      account_sessions and user_devices keep tenant_id nullable: NULL = account-level or
--      super-admin row, which tenant code can never see.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_tenants', 'subscriptions', 'subscription_payments', 'tenant_usage',
                           'account_sessions', 'user_devices', 'ai_error_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_read_policy ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update_policy ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON %I', t);
    EXECUTE format($p$CREATE POLICY platform_login_access ON %I
      USING (current_user <> 'app_user' AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
      WITH CHECK (current_user <> 'app_user' AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;
END $$;

-- read-only for tenant code
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_tenants', 'subscriptions', 'subscription_payments', 'tenant_usage',
                           'account_sessions', 'user_devices'] LOOP
    EXECUTE format($p$CREATE POLICY tenant_read_policy ON %I FOR SELECT
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- account_tenants: users/[id] syncs is_active for the current tenant's members
CREATE POLICY tenant_update_policy ON account_tenants FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ai_error_logs: tenants read/write their own logs (bug reports, deduplication, AI analysis).
-- System logs (tenant_id IS NULL) are super-admin only — previously every tenant could read
-- and resolve them through /api/ai/error-logs.
CREATE POLICY tenant_isolation_policy ON ai_error_logs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- d) Global + tenant tables: system defaults (tenant_id IS NULL) are READ-ONLY for tenants,
--    tenant rows are read/write for the owning tenant only. Previously the single FOR ALL
--    policy "tenant_id IS NULL OR tenant_id = current" let any tenant insert/update/delete
--    global rows (e.g. deactivate a system vehicle type for every company).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_types', 'vehicle_type_diagram_views', 'inspection_templates',
                           'inspection_categories', 'inspection_checklist_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS global_rows_read_policy ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format($p$CREATE POLICY global_rows_read_policy ON %I FOR SELECT
      USING (tenant_id IS NULL)$p$, t);
    -- seed-defaults / super admin write global rows through the plain db
    EXECUTE format($p$CREATE POLICY platform_login_access ON %I
      USING (current_user <> 'app_user' AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
      WITH CHECK (current_user <> 'app_user' AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- settings: only ever written per tenant (print/label settings). Rows without a tenant are
-- unreachable leftovers that would shadow a tenant's own row in findFirst(key) lookups.
-- ---------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM settings WHERE tenant_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'settings: removed % row(s) without tenant_id', n; END IF;
END $$;
ALTER TABLE settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON settings;
CREATE POLICY tenant_isolation_policy ON settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON settings TO app_user;
  END IF;
END $$;
