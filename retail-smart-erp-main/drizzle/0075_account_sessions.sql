-- Active login sessions for session management, revocation, and token rotation.
-- NOT tenant-scoped (no RLS) — sessions belong to the global accounts identity.

CREATE TABLE IF NOT EXISTS account_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_token VARCHAR(255) NOT NULL UNIQUE,
  scope VARCHAR(20) NOT NULL DEFAULT 'company',
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_slug VARCHAR(100),
  ip_address VARCHAR(45),
  user_agent TEXT,
  device_name VARCHAR(255),
  last_activity_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMP,
  revoked_reason VARCHAR(100),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_sessions_account_id ON account_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_account_sessions_token ON account_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_account_sessions_active ON account_sessions(account_id, is_revoked, expires_at);
