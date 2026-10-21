-- Admin user columns on pending_companies for paid company flow
ALTER TABLE pending_companies ADD COLUMN IF NOT EXISTS admin_email varchar(255);
ALTER TABLE pending_companies ADD COLUMN IF NOT EXISTS admin_full_name varchar(255);
ALTER TABLE pending_companies ADD COLUMN IF NOT EXISTS admin_password_hash text;
