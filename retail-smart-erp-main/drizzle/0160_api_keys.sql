-- H4: tenant API keys for the public /api/v1 API. Only a SHA-256 hash of the secret is stored;
-- `key_prefix` (the non-secret first part of the key, e.g. "plk_AbCd1234") is unique across
-- tenants so the authenticating request can find the key before any tenant context exists.
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  key_prefix varchar(32) NOT NULL,
  key_hash varchar(64) NOT NULL,               -- hex sha256 of the full key
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["items:read","sales:write"]
  created_by uuid NOT NULL REFERENCES users(id),
  last_used_at timestamp,
  last_used_ip varchar(64),
  expires_at timestamp,
  revoked_at timestamp,
  revoked_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_prefix_uidx ON api_keys (key_prefix);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys (tenant_id, created_at);
--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON api_keys;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON api_keys FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON api_keys;
--> statement-breakpoint
CREATE POLICY platform_login_access ON api_keys FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO app_user;
  END IF;
END $$;
