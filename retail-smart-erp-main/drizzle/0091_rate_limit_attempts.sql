-- Rate limit attempts table for database-backed rate limiting
-- Replaces in-memory Maps for login, registration, and password reset rate limiting

CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,           -- rate limit key (e.g., "login:user@example.com", "reset:1.2.3.4")
  category text NOT NULL,      -- "login", "register", "reset_password"
  attempts integer NOT NULL DEFAULT 1,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,    -- null if not locked
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint for upsert operations
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_key_category ON rate_limit_attempts (key, category);

-- Index for cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_rate_limit_first_attempt ON rate_limit_attempts (first_attempt_at);

-- Grant access to app_user role
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_attempts TO app_user;
  END IF;
END $$;
