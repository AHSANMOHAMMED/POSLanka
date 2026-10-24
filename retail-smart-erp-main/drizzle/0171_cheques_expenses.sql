-- K1 (2026-10): cheques register, cashier money-out (expenses / petty cash / reimbursement
-- claims) and the cost recorded on sale lines for the owner dashboard.
--  * payment_method gains 'cheque' (POS sales, receipts against credit, supplier payments)
--  * cheques: received (customer) / issued (supplier, expense) with the status life cycle
--      pending -> deposited -> cleared | bounced ; pending -> cancelled ; bounced -> returned
--    A bounced / cancelled cheque that settled an invoice re-opens it (src/lib/cheques).
--  * expense_categories / expenses: expenses paid from the POS drawer (a pos_cash_movement),
--    office cash, bank or cheque, and staff reimbursement claims (pending -> approved -> paid).
--  * pos_profiles.expense_limit: drawer expenses a cashier may record without a supervisor.
--  * sale_items.unit_cost: cost of one unit sold (items.cost_price x uom_factor, the same figure
--    the GL posts as COGS), filled by a trigger for every writer; returns copy the original line.
-- Idempotent.
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'cheque';
--> statement-breakpoint
ALTER TABLE pos_profiles ADD COLUMN IF NOT EXISTS expense_limit numeric(15,2);
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost numeric(15,4);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sale_items_set_unit_cost() RETURNS trigger AS $$
BEGIN
  IF NEW.unit_cost IS NULL THEN
    IF NEW.original_sale_item_id IS NOT NULL THEN
      SELECT si.unit_cost INTO NEW.unit_cost FROM sale_items si WHERE si.id = NEW.original_sale_item_id;
    END IF;
    IF NEW.unit_cost IS NULL AND NEW.item_id IS NOT NULL THEN
      SELECT ROUND(i.cost_price * COALESCE(NEW.uom_factor, 1), 4) INTO NEW.unit_cost FROM items i WHERE i.id = NEW.item_id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_sale_items_unit_cost ON sale_items;
--> statement-breakpoint
CREATE TRIGGER trg_sale_items_unit_cost BEFORE INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION sale_items_set_unit_cost();
--> statement-breakpoint
UPDATE sale_items si SET unit_cost = ROUND(i.cost_price * COALESCE(si.uom_factor, 1), 4)
  FROM items i WHERE i.id = si.item_id AND si.unit_cost IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_tenant_name ON expense_categories (tenant_id, lower(name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_no varchar(30) NOT NULL,
  kind varchar(20) NOT NULL DEFAULT 'expense',
  status varchar(20) NOT NULL DEFAULT 'paid',
  expense_date date NOT NULL,
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  amount numeric(15,2) NOT NULL,
  payment_method varchar(20),
  paid_from varchar(20),
  payee varchar(255),
  receipt_no varchar(100),
  description text,
  notes text,
  attachment_url text,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  pos_opening_entry_id uuid REFERENCES pos_opening_entries(id) ON DELETE SET NULL,
  cash_movement_id uuid REFERENCES pos_cash_movements(id) ON DELETE SET NULL,
  claimant_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamp,
  rejected_reason text,
  paid_by uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at timestamp,
  voided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  voided_at timestamp,
  void_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT expenses_kind_check CHECK (kind IN ('expense', 'reimbursement')),
  CONSTRAINT expenses_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'paid', 'void')),
  CONSTRAINT expenses_method_check CHECK (payment_method IS NULL OR payment_method IN ('cash', 'card', 'bank_transfer', 'cheque')),
  CONSTRAINT expenses_paid_from_check CHECK (paid_from IS NULL OR paid_from IN ('drawer', 'cash', 'bank'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_tenant_no ON expenses (tenant_id, expense_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date ON expenses (tenant_id, expense_date DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_status ON expenses (tenant_id, kind, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cheques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  direction varchar(10) NOT NULL,
  cheque_no varchar(50) NOT NULL,
  bank_name varchar(100) NOT NULL,
  branch_name varchar(100),
  cheque_date date NOT NULL,
  amount numeric(15,2) NOT NULL,
  party_name varchar(255),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  purchase_payment_id uuid REFERENCES purchase_payments(id) ON DELETE SET NULL,
  expense_id uuid REFERENCES expenses(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  deposit_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  deposited_at timestamp,
  cleared_at timestamp,
  bounced_at timestamp,
  cancelled_at timestamp,
  returned_at timestamp,
  bounce_reason text,
  settlement_reversed boolean NOT NULL DEFAULT false,
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT cheques_amount_positive CHECK (amount > 0),
  CONSTRAINT cheques_direction_check CHECK (direction IN ('received', 'issued')),
  CONSTRAINT cheques_status_check CHECK (status IN ('pending', 'deposited', 'cleared', 'bounced', 'cancelled', 'returned'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_tenant_status_date ON cheques (tenant_id, status, cheque_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_sale ON cheques (sale_id) WHERE sale_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_purchase ON cheques (purchase_id) WHERE purchase_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_customer ON cheques (customer_id) WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_supplier ON cheques (supplier_id) WHERE supplier_id IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_categories', 'expenses', 'cheques'] LOOP
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
