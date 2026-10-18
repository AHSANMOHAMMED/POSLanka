-- Migration: Custom Role Permissions System
-- Adds per-tenant permission overrides for built-in roles
-- and support for custom tenant-defined roles

-- Table 1: custom_roles
-- Tenant-created roles with a base built-in role for hierarchy
CREATE TABLE IF NOT EXISTS custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  base_role user_role NOT NULL,
  description TEXT,
  color VARCHAR(7),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_tenant ON custom_roles(tenant_id);

ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON custom_roles
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON custom_roles TO app_user;

-- Table 2: role_permission_overrides
-- Per-tenant permission deviations from system defaults
-- Either role (for built-in) OR custom_role_id (for custom) must be set
CREATE TABLE IF NOT EXISTS role_permission_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  role user_role,
  custom_role_id UUID REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(60) NOT NULL,
  is_granted BOOLEAN NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT chk_role_xor_custom CHECK (
    (role IS NOT NULL AND custom_role_id IS NULL) OR
    (role IS NULL AND custom_role_id IS NOT NULL)
  )
);

-- Unique indexes for upsert operations
CREATE UNIQUE INDEX IF NOT EXISTS idx_rpo_builtin
  ON role_permission_overrides(tenant_id, role, permission_key)
  WHERE role IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rpo_custom
  ON role_permission_overrides(tenant_id, custom_role_id, permission_key)
  WHERE custom_role_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rpo_tenant ON role_permission_overrides(tenant_id);

ALTER TABLE role_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON role_permission_overrides
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON role_permission_overrides TO app_user;

-- Add custom_role_id to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id);

-- Add custom_role_id to account_tenants table
ALTER TABLE account_tenants ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id);
