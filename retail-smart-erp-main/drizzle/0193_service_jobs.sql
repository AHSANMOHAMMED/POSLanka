-- Service jobs (2026-11): one job-card module, worded per business type (src/lib/terminology.ts):
-- repair jobs (electronics & appliances), tailoring / alteration orders (textile), service tickets
-- (office), also retail / hardware.
--  * service_jobs: customer, branch, intake / promised dates, technician, status pipeline
--    received → diagnosing → awaiting_approval → in_progress → ready → delivered (or cancelled),
--    estimate + customer approval, totals and advances; sale_id once converted to an invoice;
--    repair warranty (days → until) given on delivery.
--    Device fields (repairs): device type, brand, model, serial / IMEI / IMEI2, passcode (shown only
--    to staff who work on jobs), fault, accessories received, condition checklist, warranty check
--    against the shop's own sale (serial_number_id / warranty_sale_id / warranty_until).
--    Tailoring fields: garment, measurements (key → value), fabric supplied by the customer,
--    trial / fitting date.
--  * service_job_items: parts (stock items, deducted when invoiced), labour and other lines
--  * service_job_payments: advances (Dr Cash / Cr Customer Advance), settled on the invoice;
--    shift links like print_job_payments (0187)
--  * service_job_history: status changes and notes
--  * item_serial_numbers.imei / imei2: phones carry one or two IMEIs besides the serial
-- Additive and idempotent.
ALTER TABLE item_serial_numbers ADD COLUMN IF NOT EXISTS imei varchar(20);
--> statement-breakpoint
ALTER TABLE item_serial_numbers ADD COLUMN IF NOT EXISTS imei2 varchar(20);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_item_serial_numbers_imei ON item_serial_numbers (tenant_id, lower(imei)) WHERE imei IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_item_serial_numbers_imei2 ON item_serial_numbers (tenant_id, lower(imei2)) WHERE imei2 IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS service_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_no varchar(50) NOT NULL,
  job_type varchar(20) NOT NULL DEFAULT 'repair',
  warehouse_id uuid REFERENCES warehouses(id),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name varchar(255) NOT NULL,
  customer_phone varchar(50),
  title varchar(255) NOT NULL,
  -- repairs
  device_type varchar(100),
  brand varchar(100),
  model varchar(150),
  serial_number varchar(255),
  imei varchar(20),
  imei2 varchar(20),
  serial_number_id uuid REFERENCES item_serial_numbers(id) ON DELETE SET NULL,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  passcode varchar(100),
  fault_reported text,
  accessories_received text,
  condition_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  condition_notes text,
  diagnosis text,
  work_done text,
  under_warranty boolean NOT NULL DEFAULT false,
  warranty_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  warranty_until date,
  -- tailoring
  garment varchar(150),
  measurements jsonb NOT NULL DEFAULT '{}'::jsonb,
  fabric_supplied boolean NOT NULL DEFAULT false,
  fitting_date date,
  -- common
  received_at timestamp NOT NULL DEFAULT now(),
  promised_at timestamp,
  is_urgent boolean NOT NULL DEFAULT false,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'received',
  estimate_amount numeric(12, 2),
  estimate_status varchar(20) NOT NULL DEFAULT 'none',
  estimate_responded_at timestamp,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_breakdown jsonb,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  paid_amount numeric(12, 2) NOT NULL DEFAULT 0,
  balance_due numeric(12, 2) NOT NULL DEFAULT 0,
  repair_warranty_days integer,
  repair_warranty_until date,
  notes text,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  delivered_at timestamp,
  cancelled_at timestamp,
  cancellation_reason text,
  notified_at timestamp,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT service_jobs_type_check CHECK (job_type IN ('repair', 'tailoring', 'service')),
  CONSTRAINT service_jobs_status_check CHECK (status IN ('received', 'diagnosing', 'awaiting_approval', 'in_progress', 'ready', 'delivered', 'cancelled')),
  CONSTRAINT service_jobs_estimate_status_check CHECK (estimate_status IN ('none', 'pending', 'approved', 'declined')),
  CONSTRAINT service_jobs_warranty_days_check CHECK (repair_warranty_days IS NULL OR repair_warranty_days BETWEEN 0 AND 3650)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_jobs_tenant_job_no ON service_jobs (tenant_id, job_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_status_promised ON service_jobs (tenant_id, status, promised_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_warehouse ON service_jobs (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_phone ON service_jobs (tenant_id, customer_phone);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_serial ON service_jobs (tenant_id, lower(serial_number)) WHERE serial_number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_jobs_tenant_imei ON service_jobs (tenant_id, imei) WHERE imei IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_jobs_assigned ON service_jobs (tenant_id, assigned_to) WHERE assigned_to IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_jobs_sale ON service_jobs (sale_id) WHERE sale_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS service_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_job_id uuid NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  line_type varchar(10) NOT NULL DEFAULT 'labour',
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  description varchar(255) NOT NULL,
  quantity numeric(14, 4) NOT NULL DEFAULT 1,
  unit_price numeric(12, 2) NOT NULL DEFAULT 0,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  CONSTRAINT service_job_items_type_check CHECK (line_type IN ('part', 'labour', 'other')),
  CONSTRAINT service_job_items_qty_check CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_job_items_job ON service_job_items (service_job_id, sort_order);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS service_job_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_job_id uuid NOT NULL REFERENCES service_jobs(id),
  amount numeric(12, 2) NOT NULL,
  payment_method payment_method NOT NULL,
  reference varchar(255),
  received_by uuid REFERENCES users(id) ON DELETE SET NULL,
  refunded_at timestamp,
  pos_opening_entry_id uuid REFERENCES pos_opening_entries(id) ON DELETE SET NULL,
  refund_pos_opening_entry_id uuid REFERENCES pos_opening_entries(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT service_job_payments_amount_check CHECK (amount > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_job_payments_job ON service_job_payments (service_job_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_job_payments_shift_idx ON service_job_payments (tenant_id, pos_opening_entry_id) WHERE pos_opening_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_job_payments_refund_shift_idx ON service_job_payments (tenant_id, refund_pos_opening_entry_id) WHERE refund_pos_opening_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS service_job_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_job_id uuid NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  from_status varchar(20),
  to_status varchar(20),
  note text,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_service_job_history_job ON service_job_history (service_job_id, created_at);
--> statement-breakpoint
ALTER TABLE service_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON service_jobs;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON service_jobs FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON service_jobs;
--> statement-breakpoint
CREATE POLICY platform_login_access ON service_jobs FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON service_jobs TO app_user;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE service_job_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_job_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON service_job_items;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON service_job_items FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON service_job_items;
--> statement-breakpoint
CREATE POLICY platform_login_access ON service_job_items FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON service_job_items TO app_user;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE service_job_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_job_payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON service_job_payments;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON service_job_payments FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON service_job_payments;
--> statement-breakpoint
CREATE POLICY platform_login_access ON service_job_payments FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON service_job_payments TO app_user;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE service_job_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_job_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON service_job_history;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON service_job_history FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON service_job_history;
--> statement-breakpoint
CREATE POLICY platform_login_access ON service_job_history FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON service_job_history TO app_user;
  END IF;
END $$;
