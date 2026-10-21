-- D3: per-tenant hiding of shared system defaults (vehicle types, inspection templates).
-- System rows (tenant_id IS NULL) are read-only for tenant code; a company that does not want
-- one records an override here instead of changing the shared row for every company.
-- Idempotent.

CREATE TABLE IF NOT EXISTS tenant_hidden_defaults (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity varchar(40) NOT NULL,
  entity_id uuid NOT NULL,
  hidden_at timestamp NOT NULL DEFAULT now(),
  hidden_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, entity, entity_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_hidden_defaults_entity_check') THEN
    ALTER TABLE tenant_hidden_defaults
      ADD CONSTRAINT tenant_hidden_defaults_entity_check
      CHECK (entity IN ('vehicle_type', 'inspection_template'));
  END IF;
END $$;

-- RLS (same vocabulary as 0139/0140: tenant_isolation_policy TO PUBLIC, FORCE RLS)
ALTER TABLE tenant_hidden_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_hidden_defaults FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_hidden_defaults;
CREATE POLICY tenant_isolation_policy ON tenant_hidden_defaults
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_hidden_defaults TO app_user;
  END IF;
END $$;
