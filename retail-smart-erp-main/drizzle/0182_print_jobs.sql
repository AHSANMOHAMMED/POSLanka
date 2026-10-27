-- Print & photo studio (2026-10): size-priced items and print job orders.
--  * items.pricing_mode: unit (per piece, default) | area (selling_price = rate per sq ft / sq m)
--    | length (rate per running ft / m); items.area_unit sqft | sqm; items.min_charge_area =
--    minimum billable area (or length) per piece
--  * print_jobs: job order (customer, branch, due date / urgent, designer, proof, status pipeline
--    received → designing → proof_sent → approved → printing → finishing → ready → delivered,
--    or cancelled), totals, advances; sale_id once delivered & invoiced
--  * print_job_items: sized lines (w × h × qty → billable area × rate + finishing add-ons)
--  * print_job_payments: advances (Dr Cash / Cr Customer Advance), settled on the invoice
-- Idempotent.
ALTER TABLE items ADD COLUMN IF NOT EXISTS pricing_mode varchar(10) NOT NULL DEFAULT 'unit';
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS area_unit varchar(4) NOT NULL DEFAULT 'sqft';
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS min_charge_area numeric(10, 2);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE items ADD CONSTRAINT items_pricing_mode_check CHECK (pricing_mode IN ('unit', 'area', 'length'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE items ADD CONSTRAINT items_area_unit_check CHECK (area_unit IN ('sqft', 'sqm'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_no varchar(50) NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name varchar(255) NOT NULL,
  customer_phone varchar(50),
  title varchar(255) NOT NULL,
  received_at timestamp NOT NULL DEFAULT now(),
  due_at timestamp,
  is_urgent boolean NOT NULL DEFAULT false,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'received',
  proof_status varchar(20) NOT NULL DEFAULT 'not_needed',
  proof_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  proof_note text,
  proof_sent_at timestamp,
  proof_responded_at timestamp,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_breakdown jsonb,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  paid_amount numeric(12, 2) NOT NULL DEFAULT 0,
  balance_due numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  delivered_at timestamp,
  cancelled_at timestamp,
  cancellation_reason text,
  notified_at timestamp,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT print_jobs_status_check CHECK (status IN ('received', 'designing', 'proof_sent', 'approved', 'printing', 'finishing', 'ready', 'delivered', 'cancelled')),
  CONSTRAINT print_jobs_proof_status_check CHECK (proof_status IN ('not_needed', 'pending', 'sent', 'approved', 'changes_requested'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_jobs_tenant_job_no ON print_jobs (tenant_id, job_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_status_due ON print_jobs (tenant_id, status, due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_warehouse ON print_jobs (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_phone ON print_jobs (tenant_id, customer_phone);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_print_jobs_sale ON print_jobs (sale_id) WHERE sale_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS print_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  print_job_id uuid NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  description varchar(255) NOT NULL,
  pricing_mode varchar(10) NOT NULL DEFAULT 'unit',
  width numeric(10, 2),
  height numeric(10, 2),
  size_unit varchar(4),
  quantity numeric(12, 3) NOT NULL DEFAULT 1,
  material varchar(255),
  sides integer NOT NULL DEFAULT 1,
  area_unit varchar(4),
  area_per_piece numeric(12, 2),
  billable_area numeric(12, 2),
  rate numeric(12, 2) NOT NULL DEFAULT 0,
  base_amount numeric(12, 2) NOT NULL DEFAULT 0,
  finishing jsonb NOT NULL DEFAULT '[]'::jsonb,
  finishing_amount numeric(12, 2) NOT NULL DEFAULT 0,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  CONSTRAINT print_job_items_pricing_mode_check CHECK (pricing_mode IN ('unit', 'area', 'length')),
  CONSTRAINT print_job_items_sides_check CHECK (sides BETWEEN 1 AND 2)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_print_job_items_job ON print_job_items (print_job_id, sort_order);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS print_job_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  print_job_id uuid NOT NULL REFERENCES print_jobs(id),
  amount numeric(12, 2) NOT NULL,
  payment_method payment_method NOT NULL,
  reference varchar(255),
  received_by uuid REFERENCES users(id) ON DELETE SET NULL,
  refunded_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT print_job_payments_amount_check CHECK (amount > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_print_job_payments_job ON print_job_payments (print_job_id);
--> statement-breakpoint
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE print_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON print_jobs;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON print_jobs FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON print_jobs;
--> statement-breakpoint
CREATE POLICY platform_login_access ON print_jobs FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON print_jobs TO app_user;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE print_job_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE print_job_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON print_job_items;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON print_job_items FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON print_job_items;
--> statement-breakpoint
CREATE POLICY platform_login_access ON print_job_items FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON print_job_items TO app_user;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE print_job_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE print_job_payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON print_job_payments;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON print_job_payments FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON print_job_payments;
--> statement-breakpoint
CREATE POLICY platform_login_access ON print_job_payments FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON print_job_payments TO app_user;
  END IF;
END $$;
