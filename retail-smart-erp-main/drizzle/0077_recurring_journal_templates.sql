CREATE TABLE IF NOT EXISTS "recurring_journal_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "entry_type" varchar(50) NOT NULL DEFAULT 'journal',
  "remarks" text,
  "recurrence_pattern" varchar(20) NOT NULL DEFAULT 'monthly',
  "start_date" varchar(10) NOT NULL,
  "end_date" varchar(10),
  "next_run_date" varchar(10),
  "items" jsonb NOT NULL DEFAULT '[]',
  "last_generated_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "recurring_journal_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "recurring_journal_templates"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
