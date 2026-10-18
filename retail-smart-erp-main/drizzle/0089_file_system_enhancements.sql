-- Migration 0089: File system enhancements
-- Adds versioning, collections, audit logs, tags, full-text search, and metadata to the files system.

-- ==================== STEP 1: Add new columns to files table ====================

ALTER TABLE files ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE files ADD COLUMN IF NOT EXISTS tags text[];
ALTER TABLE files ADD COLUMN IF NOT EXISTS processing_status varchar(20) DEFAULT 'none';
ALTER TABLE files ADD COLUMN IF NOT EXISTS preview_url text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS version_number integer DEFAULT 1;
ALTER TABLE files ADD COLUMN IF NOT EXISTS latest_version_id uuid;
ALTER TABLE files ADD COLUMN IF NOT EXISTS original_file_id uuid;
ALTER TABLE files ADD COLUMN IF NOT EXISTS search_content text;
ALTER TABLE files ADD COLUMN IF NOT EXISTS is_starred boolean DEFAULT false;

-- Self-referencing foreign keys for versioning
ALTER TABLE files ADD CONSTRAINT files_latest_version_fk
  FOREIGN KEY (latest_version_id) REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE files ADD CONSTRAINT files_original_file_fk
  FOREIGN KEY (original_file_id) REFERENCES files(id) ON DELETE SET NULL;

-- ==================== STEP 2: Create file_versions table ====================

CREATE TABLE IF NOT EXISTS file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  content_hash varchar(64),
  change_description text,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT file_versions_file_version_unique UNIQUE (file_id, version_number)
);

-- ==================== STEP 3: Create collections table ====================

CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(255) NOT NULL,
  description text,
  color varchar(7),
  icon varchar(50),
  is_smart_collection boolean DEFAULT false,
  filter_rules jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- ==================== STEP 4: Create collection_files junction table ====================

CREATE TABLE IF NOT EXISTS collection_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id),
  added_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT collection_files_unique UNIQUE (collection_id, file_id)
);

-- ==================== STEP 5: Create file_audit_logs table ====================

CREATE TABLE IF NOT EXISTS file_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id),
  action varchar(50) NOT NULL,
  file_name varchar(255),
  ip_address varchar(45),
  user_agent text,
  details jsonb,
  created_at timestamp DEFAULT now() NOT NULL
);

-- ==================== STEP 6: Create indexes ====================

-- files table indexes
CREATE INDEX IF NOT EXISTS idx_files_tags ON files USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_files_processing_status ON files (processing_status);
CREATE INDEX IF NOT EXISTS idx_files_original_file_id ON files (original_file_id);
CREATE INDEX IF NOT EXISTS idx_files_is_starred ON files (is_starred) WHERE is_starred = true;
CREATE INDEX IF NOT EXISTS idx_files_search_content ON files USING GIN (to_tsvector('english', coalesce(search_content, '')));

-- file_versions indexes
CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions (file_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_tenant_id ON file_versions (tenant_id);

-- collections indexes
CREATE INDEX IF NOT EXISTS idx_collections_tenant_id ON collections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_collections_created_by ON collections (created_by);

-- collection_files indexes
CREATE INDEX IF NOT EXISTS idx_collection_files_collection_id ON collection_files (collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_files_file_id ON collection_files (file_id);

-- file_audit_logs indexes
CREATE INDEX IF NOT EXISTS idx_file_audit_logs_tenant_id ON file_audit_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_file_audit_logs_file_id ON file_audit_logs (file_id);
CREATE INDEX IF NOT EXISTS idx_file_audit_logs_user_id ON file_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_file_audit_logs_action ON file_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_file_audit_logs_created_at ON file_audit_logs (created_at DESC);

-- ==================== STEP 7: Enable Row Level Security ====================

ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_audit_logs ENABLE ROW LEVEL SECURITY;

-- collection_files doesn't have tenant_id directly, it inherits via collection/file
-- We still enable RLS but use a join-based or permissive policy
ALTER TABLE collection_files ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners too
ALTER TABLE file_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE collections FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_files FORCE ROW LEVEL SECURITY;
ALTER TABLE file_audit_logs FORCE ROW LEVEL SECURITY;

-- ==================== STEP 8: Create RLS policies ====================

DO $$ BEGIN
  -- file_versions: tenant isolation
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'file_versions' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON file_versions
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  -- collections: tenant isolation
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'collections' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON collections
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;

  -- collection_files: access via collection's tenant (join-based)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'collection_files' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON collection_files
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM collections c
          WHERE c.id = collection_files.collection_id
          AND c.tenant_id = current_setting('app.tenant_id', true)::uuid
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM collections c
          WHERE c.id = collection_files.collection_id
          AND c.tenant_id = current_setting('app.tenant_id', true)::uuid
        )
      );
  END IF;

  -- file_audit_logs: tenant isolation
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'file_audit_logs' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON file_audit_logs
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ==================== STEP 9: Grant permissions to app_user ====================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON file_versions TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON collections TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON collection_files TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON file_audit_logs TO app_user;
  END IF;
END $$;
