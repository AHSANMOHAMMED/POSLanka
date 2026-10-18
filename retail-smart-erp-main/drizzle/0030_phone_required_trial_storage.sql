-- Migration: Make phone mandatory + unique on accounts, update trial storage limits
-- 1. Backfill any NULL phone values with a placeholder (needed before NOT NULL)
UPDATE accounts SET phone = 'NEEDS_UPDATE_' || id::text WHERE phone IS NULL;

-- 2. Make phone NOT NULL and add unique constraint
ALTER TABLE accounts ALTER COLUMN phone SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_phone_unique'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_phone_unique UNIQUE (phone);
  END IF;
END $$;

-- 3. Update free trial storage: 80MB database, 200MB file storage
UPDATE pricing_tiers
SET max_database_bytes = 83886080,
    max_file_storage_bytes = 209715200
WHERE name = 'trial';
