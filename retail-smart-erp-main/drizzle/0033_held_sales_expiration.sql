-- Add expiration feature to held_sales table
-- Held sales will automatically expire after 24 hours by default

-- Add expires_at column with default of 24 hours from creation
ALTER TABLE held_sales ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');

-- Backfill existing records that might have NULL expires_at (set to 24 hours after created_at)
UPDATE held_sales SET expires_at = created_at + INTERVAL '24 hours' WHERE expires_at IS NULL;

-- Create an index for efficient querying of expired held sales
CREATE INDEX IF NOT EXISTS idx_held_sales_expires_at ON held_sales(expires_at);

-- Create an index for tenant + expiration queries (cron job cleanup)
CREATE INDEX IF NOT EXISTS idx_held_sales_tenant_expires ON held_sales(tenant_id, expires_at);
