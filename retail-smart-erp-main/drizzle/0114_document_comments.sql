-- Document comments table for storing comments on any document type
CREATE TABLE IF NOT EXISTS "document_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "document_type" varchar(50) NOT NULL,
  "document_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_document_comments_tenant" ON "document_comments" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_document_comments_document" ON "document_comments" ("document_type", "document_id");
CREATE INDEX IF NOT EXISTS "idx_document_comments_user" ON "document_comments" ("user_id");

-- Enable RLS
ALTER TABLE "document_comments" ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenant isolation
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'document_comments' AND policyname = 'document_comments_tenant_isolation'
  ) THEN
    CREATE POLICY "document_comments_tenant_isolation" ON "document_comments"
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- Grant permissions to app_user role
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "document_comments" TO app_user;
  END IF;
END $$;
