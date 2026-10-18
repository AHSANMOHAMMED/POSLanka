-- Add lastActiveAt column to accounts for session inactivity tracking
-- Used to end sessions everywhere after 3 hours of inactivity
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT NOW();

-- Initialize existing accounts with current timestamp
UPDATE accounts SET last_active_at = NOW() WHERE last_active_at IS NULL;
