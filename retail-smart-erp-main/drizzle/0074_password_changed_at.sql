-- Add password_changed_at column to accounts table.
-- Used to invalidate existing JWT sessions after a password change:
-- if password_changed_at > token.iat, the session is marked invalid.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;
