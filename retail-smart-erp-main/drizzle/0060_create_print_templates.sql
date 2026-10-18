-- Create print_templates table
-- This migration adds the missing print_templates table referenced in schema.ts

CREATE TABLE IF NOT EXISTS "print_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(100) NOT NULL,
  "document_type" varchar(50) NOT NULL,
  "letter_head_id" uuid REFERENCES "letter_heads"("id"),
  "paper_size" varchar(20) NOT NULL DEFAULT 'a4',
  "orientation" varchar(10) NOT NULL DEFAULT 'portrait',
  "margins" jsonb,
  "show_logo" boolean NOT NULL DEFAULT true,
  "show_header" boolean NOT NULL DEFAULT true,
  "show_footer" boolean NOT NULL DEFAULT true,
  "custom_css" text,
  "header_fields" jsonb,
  "body_fields" jsonb,
  "footer_fields" jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE "print_templates" ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenant isolation
DROP POLICY IF EXISTS "print_templates_tenant_isolation" ON "print_templates";
CREATE POLICY "print_templates_tenant_isolation" ON "print_templates"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_print_templates_tenant" ON "print_templates" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_print_templates_document_type" ON "print_templates" ("tenant_id", "document_type");
CREATE INDEX IF NOT EXISTS "idx_print_templates_is_default" ON "print_templates" ("tenant_id", "is_default") WHERE "is_default" = true;
CREATE INDEX IF NOT EXISTS "idx_print_templates_is_active" ON "print_templates" ("tenant_id", "is_active") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_print_templates_letter_head" ON "print_templates" ("letter_head_id");