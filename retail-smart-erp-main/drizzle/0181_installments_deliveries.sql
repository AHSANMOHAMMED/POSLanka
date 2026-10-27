-- 0181 (2026-10): electronics & appliance shops (and hardware / retail): hire purchase, deliveries &
-- installation, warranty claims.
--  * installment_plans: one hire-purchase agreement (from a credit sale or a manual plan): buyer
--    (NIC, address), guarantor, the goods with serial / IMEI numbers, cash price, down payment,
--    flat-rate or fixed interest, term, frequency, late-fee rule; status active | completed |
--    defaulted | cancelled | repossessed. Branch = the sale's warehouse.
--  * installment_schedule: the generated due rows (principal / interest split, paid, late fee)
--  * installment_payments: receipts (HPR-…) against a plan: down payment, installment, settlement
--  * deliveries: delivery / installation runs for a sale (DN-…): slot, vehicle, driver, technician,
--    status scheduled | out_for_delivery | delivered | installed | failed | cancelled, proof
--  * warranty_claims: service tickets by serial / IMEI / invoice (WC-…), in / out of warranty,
--    status received | diagnosing | sent_to_supplier | repairing | ready | delivered | rejected
-- Statuses are varchar + CHECK (no new enums). Idempotent.
CREATE TABLE IF NOT EXISTS installment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_no varchar(50) NOT NULL,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  customer_name varchar(255) NOT NULL,
  customer_nic varchar(20),
  customer_phone varchar(50),
  customer_address text,
  guarantor_name varchar(255),
  guarantor_nic varchar(20),
  guarantor_phone varchar(50),
  guarantor_address text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  cash_price numeric(12,2) NOT NULL,
  down_payment numeric(12,2) NOT NULL DEFAULT 0,
  financed_amount numeric(12,2) NOT NULL,
  interest_type varchar(10) NOT NULL DEFAULT 'flat',
  interest_rate numeric(7,3) NOT NULL DEFAULT 0,
  interest_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_payable numeric(12,2) NOT NULL,
  installment_amount numeric(12,2) NOT NULL,
  installment_count integer NOT NULL,
  term_months integer NOT NULL,
  frequency varchar(10) NOT NULL DEFAULT 'monthly',
  start_date date NOT NULL,
  late_fee_type varchar(10) NOT NULL DEFAULT 'none',
  late_fee_value numeric(12,2) NOT NULL DEFAULT 0,
  grace_days integer NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  late_fees_paid numeric(12,2) NOT NULL DEFAULT 0,
  rebate_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  terms text,
  notes text,
  status_reason text,
  closed_at timestamp,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE installment_plans ADD CONSTRAINT installment_plans_status_check
    CHECK (status IN ('active', 'completed', 'defaulted', 'cancelled', 'repossessed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE installment_plans ADD CONSTRAINT installment_plans_terms_check
    CHECK (interest_type IN ('flat', 'fixed') AND frequency IN ('monthly', 'weekly')
      AND late_fee_type IN ('none', 'fixed', 'percent') AND installment_count > 0 AND term_months > 0
      AND cash_price >= 0 AND down_payment >= 0 AND financed_amount >= 0 AND grace_days >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_installment_plans_tenant_no ON installment_plans (tenant_id, plan_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant_status ON installment_plans (tenant_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant_warehouse ON installment_plans (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_plans_sale ON installment_plans (sale_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_plans_customer ON installment_plans (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_plans_nic ON installment_plans (tenant_id, customer_nic) WHERE customer_nic IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS installment_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_id uuid NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
  installment_no integer NOT NULL,
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  principal numeric(12,2) NOT NULL,
  interest numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  late_fee numeric(12,2) NOT NULL DEFAULT 0,
  late_fee_paid numeric(12,2) NOT NULL DEFAULT 0,
  status varchar(10) NOT NULL DEFAULT 'pending',
  paid_at timestamp
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE installment_schedule ADD CONSTRAINT installment_schedule_status_check
    CHECK (status IN ('pending', 'partial', 'paid', 'waived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_installment_schedule_plan_no ON installment_schedule (plan_id, installment_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_schedule_tenant_due ON installment_schedule (tenant_id, due_date) WHERE status IN ('pending', 'partial');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS installment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_id uuid NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id),
  receipt_no varchar(50) NOT NULL,
  kind varchar(20) NOT NULL DEFAULT 'installment',
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12,2) NOT NULL,
  principal_amount numeric(12,2) NOT NULL DEFAULT 0,
  interest_amount numeric(12,2) NOT NULL DEFAULT 0,
  late_fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  rebate_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_method varchar(20) NOT NULL DEFAULT 'cash',
  reference varchar(255),
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  sale_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  notes text,
  received_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE installment_payments ADD CONSTRAINT installment_payments_kind_check
    CHECK (kind IN ('down_payment', 'installment', 'settlement') AND amount > 0
      AND payment_method IN ('cash', 'card', 'bank_transfer', 'cheque'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_installment_payments_tenant_receipt ON installment_payments (tenant_id, receipt_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_payments_plan ON installment_payments (plan_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_payments_tenant_date ON installment_payments (tenant_id, payment_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  delivery_no varchar(50) NOT NULL,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  installment_plan_id uuid REFERENCES installment_plans(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name varchar(255) NOT NULL,
  customer_phone varchar(50),
  address text NOT NULL,
  city varchar(100),
  scheduled_date date NOT NULL,
  time_slot varchar(30),
  vehicle_no varchar(30),
  driver_id uuid REFERENCES users(id) ON DELETE SET NULL,
  driver_name varchar(255),
  installation_required boolean NOT NULL DEFAULT false,
  technician_id uuid REFERENCES users(id) ON DELETE SET NULL,
  technician_name varchar(255),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_charge numeric(12,2) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'scheduled',
  dispatched_at timestamp,
  delivered_at timestamp,
  installed_at timestamp,
  recipient_name varchar(255),
  recipient_phone varchar(50),
  proof_notes text,
  proof_photo_url text,
  failure_reason text,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
    CHECK (status IN ('scheduled', 'out_for_delivery', 'delivered', 'installed', 'failed', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_tenant_no ON deliveries (tenant_id, delivery_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant_date ON deliveries (tenant_id, scheduled_date, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_deliveries_tenant_warehouse ON deliveries (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_deliveries_sale ON deliveries (sale_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  claim_no varchar(50) NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id),
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  sale_item_id uuid REFERENCES sale_items(id) ON DELETE SET NULL,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  serial_number_id uuid REFERENCES item_serial_numbers(id) ON DELETE SET NULL,
  serial_number varchar(255),
  item_name varchar(255) NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name varchar(255) NOT NULL,
  customer_phone varchar(50),
  purchase_date date,
  warranty_until date,
  in_warranty boolean NOT NULL DEFAULT false,
  complaint text NOT NULL,
  accessories text,
  condition_notes text,
  technician_id uuid REFERENCES users(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_ref varchar(100),
  status varchar(20) NOT NULL DEFAULT 'received',
  diagnosis text,
  resolution varchar(20),
  replacement_serial varchar(255),
  estimated_charge numeric(12,2) NOT NULL DEFAULT 0,
  final_charge numeric(12,2) NOT NULL DEFAULT 0,
  expected_date date,
  delivered_at timestamp,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE warranty_claims ADD CONSTRAINT warranty_claims_status_check
    CHECK (status IN ('received', 'diagnosing', 'sent_to_supplier', 'repairing', 'ready', 'delivered', 'rejected')
      AND (resolution IS NULL OR resolution IN ('repaired', 'replaced', 'refunded', 'no_fault', 'rejected')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_warranty_claims_tenant_no ON warranty_claims (tenant_id, claim_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_warranty_claims_tenant_status ON warranty_claims (tenant_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_warranty_claims_tenant_warehouse ON warranty_claims (tenant_id, warehouse_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_warranty_claims_serial ON warranty_claims (tenant_id, lower(serial_number)) WHERE serial_number IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['installment_plans', 'installment_schedule', 'installment_payments', 'deliveries', 'warranty_claims'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON %I FOR ALL TO public
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON %I', t);
    EXECUTE format($p$CREATE POLICY platform_login_access ON %I FOR ALL TO public
      USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
      WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;
END $$;
