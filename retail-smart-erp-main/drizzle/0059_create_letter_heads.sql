-- Create letter_heads table and related enum
-- This migration adds the missing table referenced in schema.ts

-- Create enum if not exists
DO $$ BEGIN
  CREATE TYPE "letter_head_alignment" AS ENUM ('left', 'center', 'right');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Create letter_heads table
CREATE TABLE IF NOT EXISTS "letter_heads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(100) NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "header_html" text,
  "footer_html" text,
  "header_image" text,
  "footer_image" text,
  "header_height" integer NOT NULL DEFAULT 60,
  "footer_height" integer NOT NULL DEFAULT 30,
  "alignment" "letter_head_alignment" NOT NULL DEFAULT 'center',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE "letter_heads" ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenant isolation
DROP POLICY IF EXISTS "letter_heads_tenant_isolation" ON "letter_heads";
CREATE POLICY "letter_heads_tenant_isolation" ON "letter_heads"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_letter_heads_tenant" ON "letter_heads" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_letter_heads_is_default" ON "letter_heads" ("tenant_id", "is_default") WHERE "is_default" = true;
CREATE INDEX IF NOT EXISTS "idx_letter_heads_is_active" ON "letter_heads" ("tenant_id", "is_active") WHERE "is_active" = true;