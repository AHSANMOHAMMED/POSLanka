-- GC: which item_batches a purchasing document put stock into (GRN receipt, purchase invoice)
-- or took stock out of (purchase return), so cancellations reverse exactly those batches.
CREATE TABLE IF NOT EXISTS purchase_doc_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type varchar(30) NOT NULL,          -- 'grn' | 'purchase'
  document_id uuid NOT NULL,
  line_id uuid,
  batch_id uuid NOT NULL REFERENCES item_batches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  quantity numeric(12,3) NOT NULL,             -- signed: + into the batch, - out of it
  reversed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_doc_batches_doc_idx ON purchase_doc_batches (tenant_id, document_type, document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_doc_batches_batch_idx ON purchase_doc_batches (batch_id);
--> statement-breakpoint
ALTER TABLE purchase_doc_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE purchase_doc_batches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON purchase_doc_batches;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON purchase_doc_batches FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON purchase_doc_batches;
--> statement-breakpoint
CREATE POLICY platform_login_access ON purchase_doc_batches FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_doc_batches TO app_user;
  END IF;
END $$;
