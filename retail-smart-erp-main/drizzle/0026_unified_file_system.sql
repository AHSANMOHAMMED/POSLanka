-- Migration: Unified File System (ERPNext-Inspired)
-- Replaces 3 separate attachment systems with a single files table

-- ==================== CREATE FILES TABLE ====================

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  file_type VARCHAR(100),
  content_hash VARCHAR(64),
  is_private BOOLEAN NOT NULL DEFAULT false,
  is_folder BOOLEAN NOT NULL DEFAULT false,
  folder_id UUID REFERENCES files(id) ON DELETE SET NULL,
  attached_to_type VARCHAR(50),
  attached_to_id UUID,
  attached_to_field VARCHAR(50),
  thumbnail_url TEXT,
  image_width INTEGER,
  image_height INTEGER,
  description TEXT,
  category VARCHAR(50),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_files_tenant_id ON files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_files_tenant_folder ON files(tenant_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_files_tenant_attached ON files(tenant_id, attached_to_type, attached_to_id);
CREATE INDEX IF NOT EXISTS idx_files_tenant_hash ON files(tenant_id, content_hash) WHERE content_hash IS NOT NULL;

-- ==================== CHECK CONSTRAINTS ====================

-- Folders must not have file-specific fields
ALTER TABLE files ADD CONSTRAINT chk_folder_no_file_data
  CHECK (
    is_folder = false
    OR (file_size IS NULL AND file_type IS NULL AND content_hash IS NULL)
  );

-- Non-folders must have file_size and file_type
ALTER TABLE files ADD CONSTRAINT chk_file_has_metadata
  CHECK (
    is_folder = true
    OR (file_size IS NOT NULL AND file_type IS NOT NULL)
  );

-- ==================== ROW LEVEL SECURITY ====================

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON files
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grant access to app_user role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON files TO app_user;
  END IF;
END $$;

-- ==================== ADD fileId TO inspection_photos ====================
-- Thin junction: links inspection photos to unified files table

ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES files(id) ON DELETE SET NULL;
