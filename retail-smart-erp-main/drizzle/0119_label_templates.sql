-- Label Templates table for barcode label designer
CREATE TABLE IF NOT EXISTS "label_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(100) NOT NULL,
  "description" text,
  "width_mm" numeric(6,2) NOT NULL,
  "height_mm" numeric(6,2) NOT NULL,
  "elements" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_label_templates_tenant" ON "label_templates" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_label_templates_tenant_default" ON "label_templates" ("tenant_id", "is_default");
CREATE INDEX IF NOT EXISTS "idx_label_templates_tenant_active" ON "label_templates" ("tenant_id", "is_active");

-- Row Level Security
ALTER TABLE "label_templates" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'label_templates' AND policyname = 'label_templates_tenant_isolation'
  ) THEN
    CREATE POLICY "label_templates_tenant_isolation" ON "label_templates"
      USING (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- Grant permissions to app_user role
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "label_templates" TO app_user;
  END IF;
END $$;
