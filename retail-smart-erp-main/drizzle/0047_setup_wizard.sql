-- 0046: Setup wizard + registration improvements
-- Adds email verification OTPs table, Google OAuth support, TOS tracking, and setup wizard support

-- 1. Add googleId and tosAcceptedAt to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMP;

-- Create unique index on google_id (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS accounts_google_id_unique ON accounts(google_id) WHERE google_id IS NOT NULL;

-- 2. Add setupCompletedAt to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMP;

-- 3. Backfill existing tenants so they are NOT forced into setup wizard
UPDATE tenants SET setup_completed_at = created_at WHERE setup_completed_at IS NULL;

-- 4. Create email_verification_otps table (global, no RLS)
CREATE TABLE IF NOT EXISTS email_verification_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  otp_hash TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'registration',
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for looking up OTPs by email and type
CREATE INDEX IF NOT EXISTS idx_email_verification_otps_email_type ON email_verification_otps(email, type);

-- Index for cleanup of expired OTPs
CREATE INDEX IF NOT EXISTS idx_email_verification_otps_expires_at ON email_verification_otps(expires_at);
