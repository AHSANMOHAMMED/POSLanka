-- Error Logging Enhancements
-- Adds user bug reporting, frontend error capture, resolution workflow, and deduplication

-- New columns for user bug reports
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS reported_by_user_id UUID REFERENCES users(id);
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS user_description TEXT;
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS reported_url TEXT;

-- Error source tracking (system vs user report vs frontend)
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS error_source VARCHAR(20) DEFAULT 'system';

-- Resolution workflow
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS resolution_status VARCHAR(20) DEFAULT 'open';
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

-- Error deduplication
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS error_fingerprint VARCHAR(64);
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS occurrence_count INTEGER DEFAULT 1;
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS last_occurred_at TIMESTAMP;

-- Browser/client info for frontend errors
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE ai_error_logs ADD COLUMN IF NOT EXISTS browser_info JSONB;

-- Indexes for filtering and dedup
CREATE INDEX IF NOT EXISTS idx_ai_error_logs_error_source ON ai_error_logs(error_source);
CREATE INDEX IF NOT EXISTS idx_ai_error_logs_fingerprint ON ai_error_logs(error_fingerprint);
CREATE INDEX IF NOT EXISTS idx_ai_error_logs_resolution ON ai_error_logs(resolution_status);
CREATE INDEX IF NOT EXISTS idx_ai_error_logs_created_at ON ai_error_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_error_logs_reported_by ON ai_error_logs(reported_by_user_id);

-- Enable RLS on ai_error_logs
ALTER TABLE ai_error_logs ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenant users can only see their tenant's errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_error_logs' AND policyname = 'ai_error_logs_tenant_isolation'
  ) THEN
    CREATE POLICY ai_error_logs_tenant_isolation ON ai_error_logs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);
  END IF;
END $$;

-- Backfill existing rows with default values
UPDATE ai_error_logs SET error_source = 'system' WHERE error_source IS NULL;
UPDATE ai_error_logs SET resolution_status = 'open' WHERE resolution_status IS NULL;
UPDATE ai_error_logs SET occurrence_count = 1 WHERE occurrence_count IS NULL;
