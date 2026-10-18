-- Migration: Add account status fields and system_settings table
-- Date: 2026-01-30

-- Add is_active, deactivated_at, deactivation_reason to accounts table
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deactivated_at timestamp;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deactivation_reason text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Create system_settings table if not exists
CREATE TABLE IF NOT EXISTS system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(255) NOT NULL UNIQUE,
  value jsonb,
  description text,
  updated_by uuid REFERENCES accounts(id),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Create index on key for fast lookups
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);
