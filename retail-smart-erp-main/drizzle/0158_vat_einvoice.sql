-- H2: Sri Lanka VAT compliance.
--   * tax_templates.tax_category: standard / zero_rated / exempt / out_of_scope, so VAT schedules
--     can tell zero-rated supplies from exempt ones via sale_items.tax_template_id.
--   * credit notes carry a per-line tax breakdown and post to the GL; customer debit notes.
--   * e-invoicing (IRD RAMIS) readiness: a per-tenant switch and one outbox row per document.
ALTER TABLE tax_templates ADD COLUMN IF NOT EXISTS tax_category varchar(20) NOT NULL DEFAULT 'standard';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_templates_tax_category_chk') THEN
    ALTER TABLE tax_templates ADD CONSTRAINT tax_templates_tax_category_chk
      CHECK (tax_category IN ('standard', 'zero_rated', 'exempt', 'out_of_scope'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS einvoice_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS einvoice_enabled_at timestamp;
--> statement-breakpoint
-- Credit notes: posting date, tax breakdown, settlement (Cr receivable or refund) and GL flag
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS posting_date date;
--> statement-breakpoint
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
--> statement-breakpoint
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS settlement varchar(20) NOT NULL DEFAULT 'receivable';
--> statement-breakpoint
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS refund_method varchar(30);
--> statement-breakpoint
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS gl_posted boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cancelled_at timestamp;
--> statement-breakpoint
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS tax_template_id uuid REFERENCES tax_templates(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credit_notes_sale_idx ON credit_notes (tenant_id, sale_id);
--> statement-breakpoint
-- Customer debit notes (additional charge against an invoice: Dr receivable, Cr revenue + output VAT)
CREATE TABLE IF NOT EXISTS debit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  debit_note_no varchar(50) NOT NULL,
  sale_id uuid REFERENCES sales(id),
  customer_id uuid REFERENCES customers(id),
  customer_name varchar(255),
  status varchar(20) NOT NULL DEFAULT 'issued',  -- 'draft' | 'issued' | 'cancelled'
  reason text,
  posting_date date,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  tax_breakdown jsonb,
  gl_posted boolean NOT NULL DEFAULT false,
  created_by uuid,
  cancelled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS debit_notes_tenant_no_uq ON debit_notes (tenant_id, debit_note_no);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS debit_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  debit_note_id uuid NOT NULL REFERENCES debit_notes(id) ON DELETE CASCADE,
  item_id uuid REFERENCES items(id),
  item_name varchar(255) NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  tax_template_id uuid REFERENCES tax_templates(id) ON DELETE SET NULL,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  tax_breakdown jsonb,
  total numeric(12,2) NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS debit_note_items_note_idx ON debit_note_items (debit_note_id);
--> statement-breakpoint
-- E-invoice outbox: one row per fiscal document, transmitted by /api/cron/einvoice-sync
CREATE TABLE IF NOT EXISTS einvoice_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type varchar(20) NOT NULL,          -- 'invoice' | 'credit_note' | 'debit_note'
  source_type varchar(20) NOT NULL,            -- 'sale' | 'sale_return' | 'credit_note' | 'debit_note'
  document_id uuid NOT NULL,
  document_no varchar(60) NOT NULL,
  document_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  last_error text,
  payload jsonb NOT NULL,
  irn varchar(100),
  response jsonb,
  sent_at timestamp,
  acknowledged_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT einvoice_outbox_status_chk CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS einvoice_outbox_doc_uq ON einvoice_outbox (tenant_id, source_type, document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS einvoice_outbox_due_idx ON einvoice_outbox (status, next_attempt_at);
--> statement-breakpoint
ALTER TABLE debit_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE debit_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON debit_notes;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON debit_notes FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON debit_notes;
--> statement-breakpoint
CREATE POLICY platform_login_access ON debit_notes FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
ALTER TABLE debit_note_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE debit_note_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON debit_note_items;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON debit_note_items FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON debit_note_items;
--> statement-breakpoint
CREATE POLICY platform_login_access ON debit_note_items FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
ALTER TABLE einvoice_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE einvoice_outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON einvoice_outbox;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON einvoice_outbox FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON einvoice_outbox;
--> statement-breakpoint
CREATE POLICY platform_login_access ON einvoice_outbox FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON debit_notes, debit_note_items, einvoice_outbox TO app_user;
  END IF;
END $$;
