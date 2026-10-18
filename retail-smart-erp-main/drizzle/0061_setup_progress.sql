-- Create setup_progress table for ERPNext-style setup wizard
CREATE TABLE setup_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL DEFAULT 0,
    data JSONB NOT NULL DEFAULT '{}',
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, step_index)
);

-- Create index for faster lookups
CREATE INDEX idx_setup_progress_tenant_id ON setup_progress(tenant_id);
CREATE INDEX idx_setup_progress_step_index ON setup_progress(step_index);

-- Add RLS policy for setup_progress table
ALTER TABLE setup_progress ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can only access setup progress for their own tenant
CREATE POLICY tenant_access_policy ON setup_progress
    FOR ALL
    USING (
        tenant_id IN (
            SELECT tenant_id 
            FROM account_tenants 
            WHERE account_id = current_setting('app.account_id')::UUID
            AND is_active = true
        )
    );

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_setup_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_setup_progress_updated_at_trigger
    BEFORE UPDATE ON setup_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_setup_progress_updated_at();

-- Create or update the setup_completed_at column in tenants if not exists
-- (Already exists, but ensure it's nullable)
-- Comment: column already exists in tenants table

-- Insert default setup progress for any existing tenants that have setup_completed_at NULL
-- (Optional: can run manually if needed)
-- INSERT INTO setup_progress (tenant_id, step_index, data)
-- SELECT id, 0, '{}' FROM tenants WHERE setup_completed_at IS NULL
-- ON CONFLICT (tenant_id, step_index) DO NOTHING;