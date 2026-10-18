-- Migration: Workspace Configs (ERPNext-style customizable workspaces)
-- Stores per-user workspace block customizations

-- ==================== CREATE TABLE ====================

CREATE TABLE IF NOT EXISTS workspace_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  workspace_key VARCHAR(50) NOT NULL,
  blocks JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- ==================== INDEXES ====================

CREATE UNIQUE INDEX IF NOT EXISTS workspace_configs_tenant_user_key
  ON workspace_configs(tenant_id, user_id, workspace_key);

CREATE INDEX IF NOT EXISTS idx_workspace_configs_tenant_id
  ON workspace_configs(tenant_id);

-- ==================== ROW LEVEL SECURITY ====================

ALTER TABLE workspace_configs ENABLE ROW LEVEL SECURITY;

-- Policy: tenant isolation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workspace_configs' AND policyname = 'workspace_configs_tenant_isolation'
  ) THEN
    CREATE POLICY workspace_configs_tenant_isolation ON workspace_configs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ==================== GRANTS ====================

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_configs TO app_user;
