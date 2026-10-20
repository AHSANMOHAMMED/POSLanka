-- W4 import: persisted import jobs + per-row state (resumable, multi-instance safe)

CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "entity_name" varchar(50) NOT NULL,
  "mode" varchar(10) NOT NULL DEFAULT 'insert',
  "options" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'queued',
  "file_name" varchar(255),
  "file_hash" varchar(64),
  "total" integer NOT NULL DEFAULT 0,
  "processed" integer NOT NULL DEFAULT 0,
  "inserted" integer NOT NULL DEFAULT 0,
  "updated" integer NOT NULL DEFAULT 0,
  "skipped" integer NOT NULL DEFAULT 0,
  "failed" integer NOT NULL DEFAULT 0,
  "auto_created" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "heartbeat_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "import_jobs_mode_check" CHECK ("mode" IN ('insert', 'update', 'upsert')),
  CONSTRAINT "import_jobs_status_check" CHECK ("status" IN ('queued', 'validating', 'processing', 'done', 'error', 'cancelled', 'interrupted'))
);

CREATE INDEX IF NOT EXISTS "idx_import_jobs_tenant_created" ON "import_jobs" ("tenant_id", "created_at" DESC);

-- The same file cannot run twice at the same time for the same entity
CREATE UNIQUE INDEX IF NOT EXISTS "import_jobs_active_file_unique"
  ON "import_jobs" ("tenant_id", "file_hash", "entity_name")
  WHERE "status" IN ('queued', 'validating', 'processing');

CREATE TABLE IF NOT EXISTS "import_job_rows" (
  "job_id" uuid NOT NULL REFERENCES "import_jobs"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "row_index" integer NOT NULL,
  "action" varchar(10) NOT NULL DEFAULT 'insert',
  "status" varchar(10) NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" text,
  "entity_id" uuid,
  PRIMARY KEY ("job_id", "row_index"),
  CONSTRAINT "import_job_rows_status_check" CHECK ("status" IN ('pending', 'done', 'skipped', 'error'))
);

CREATE INDEX IF NOT EXISTS "idx_import_job_rows_job_status" ON "import_job_rows" ("job_id", "status");

-- Row Level Security
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_job_rows" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'import_jobs' AND policyname = 'import_jobs_tenant_isolation'
  ) THEN
    CREATE POLICY "import_jobs_tenant_isolation" ON "import_jobs"
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'import_job_rows' AND policyname = 'import_job_rows_tenant_isolation'
  ) THEN
    CREATE POLICY "import_job_rows_tenant_isolation" ON "import_job_rows"
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- Grant permissions to app_user role
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "import_jobs" TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "import_job_rows" TO app_user;
  END IF;
END $$;
