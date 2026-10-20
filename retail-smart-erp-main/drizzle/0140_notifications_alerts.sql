-- W5: vendor alerts & reminders (in-app inbox, per-user preferences, de-duplication).
-- Idempotent: tables/indexes use IF NOT EXISTS, policies are dropped before being (re)created.
-- Tenant alert settings live in tenants.settings->'alerts' (jsonb, no column needed):
--   { defaultMinStock?: number, expiryWarningDays: 7, largeRefundAmount?: number,
--     varianceThreshold: 1, digestEnabled: true }

-- ---------------------------------------------------------------------------
-- 1. Per-user alert preferences (no row = defaults)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled_types text[],                         -- NULL = all alert types
  muted_types text[] NOT NULL DEFAULT '{}',
  quiet_start time,                             -- local time (timezone below, else tenant timezone)
  quiet_end time,
  timezone varchar(50),
  digest_hour smallint DEFAULT 8,               -- NULL = no daily digest
  push_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_preferences_tenant_idx ON notification_preferences (tenant_id);

-- ---------------------------------------------------------------------------
-- 2. In-app inbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  title varchar(255) NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS in_app_notifications_inbox_idx
  ON in_app_notifications (tenant_id, user_id, read_at, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. De-duplication window per (tenant, key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_dedupe (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dedupe_key varchar(200) NOT NULL,
  last_sent_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, dedupe_key)
);

-- ---------------------------------------------------------------------------
-- RLS (same vocabulary as 0139: tenant_isolation_policy TO PUBLIC, FORCE RLS)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_preferences', 'in_app_notifications', 'alert_dedupe'] LOOP
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
-- 4. SMS/e-mail auto-trigger names: the template editor used to save dotted names
--    ('work_order.completed') while the trigger code fires underscore names
--    ('work_order_completed'). Convert stored templates to the canonical form.
--    FORCE RLS is lifted for the duration so a non-superuser owner sees every tenant's rows.
-- ---------------------------------------------------------------------------
ALTER TABLE notification_templates NO FORCE ROW LEVEL SECURITY;
UPDATE notification_templates
SET trigger_event = CASE
      WHEN trigger_event IN ('work_order.invoice_created', 'work_order.invoiced') THEN 'work_order_invoiced'
      ELSE replace(trigger_event, '.', '_')
    END,
    updated_at = now()
WHERE trigger_event LIKE '%.%';
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
