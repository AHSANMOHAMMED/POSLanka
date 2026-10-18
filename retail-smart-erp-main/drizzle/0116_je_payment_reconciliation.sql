-- Allow payment_entry_references to track JE-based payments (not just payment_entries)
ALTER TABLE payment_entry_references ALTER COLUMN payment_entry_id DROP NOT NULL;
ALTER TABLE payment_entry_references ADD COLUMN source_je_item_id UUID REFERENCES journal_entry_items(id);

-- Grant column access to app_user role for RLS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE ON payment_entry_references TO app_user;
  END IF;
END $$;
