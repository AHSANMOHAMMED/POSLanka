-- W2 inventory core: item_change_log (field / price change audit trail per item)
CREATE TABLE IF NOT EXISTS "item_change_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  -- No FK on item_id: the 'delete' entry must survive the item row.
  "item_id" uuid NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(20) NOT NULL,
  "source" varchar(20) NOT NULL DEFAULT 'manual',
  "changes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "price_changed" boolean NOT NULL DEFAULT false,
  "import_job_id" uuid,
  "intake_batch_id" uuid,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_item_change_log_tenant_item_created"
  ON "item_change_log" ("tenant_id", "item_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_item_change_log_tenant_created"
  ON "item_change_log" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_item_change_log_import_job"
  ON "item_change_log" ("import_job_id") WHERE import_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_item_change_log_intake_batch"
  ON "item_change_log" ("intake_batch_id") WHERE intake_batch_id IS NOT NULL;

ALTER TABLE "item_change_log" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'item_change_log' AND policyname = 'item_change_log_tenant_isolation'
  ) THEN
    CREATE POLICY "item_change_log_tenant_isolation" ON "item_change_log"
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "item_change_log" TO app_user;
  END IF;
END $$;
