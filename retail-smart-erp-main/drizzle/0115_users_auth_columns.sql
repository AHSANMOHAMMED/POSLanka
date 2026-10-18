-- Add auth columns to users table for independent staff authentication
-- passwordChangedAt: used for JWT invalidation after password change
-- lastActiveAt: used for inactivity timeout tracking

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP DEFAULT NOW();

-- Data migration: copy passwords from accounts to users where users.passwordHash is empty
-- This ensures existing account-based users can log in via the users table directly
UPDATE users u
SET password_hash = a.password_hash,
    password_changed_at = a.password_changed_at
FROM accounts a
WHERE u.account_id = a.id
  AND (u.password_hash = '' OR u.password_hash IS NULL);
