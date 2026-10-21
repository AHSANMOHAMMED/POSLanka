-- saved_reports was declared in schema.ts (and used by /api/saved-reports and the report
-- pages) but no migration ever created it, so saving/listing reports failed with 500.
CREATE TABLE IF NOT EXISTS saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  report_type varchar(50) NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  columns jsonb,
  created_by uuid REFERENCES users(id),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_reports_tenant_idx ON saved_reports (tenant_id);
--> statement-breakpoint
ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE saved_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON saved_reports;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON saved_reports FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP TRIGGER IF EXISTS track_storage ON saved_reports;
--> statement-breakpoint
CREATE TRIGGER track_storage AFTER INSERT OR DELETE ON saved_reports FOR EACH ROW EXECUTE FUNCTION track_storage_bytes();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports TO app_user;
  END IF;
END $$;
