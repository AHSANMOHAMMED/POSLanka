-- H3: procure-to-pay accounting + inventory integrity.
--  * Stock Received But Not Billed (SRBNB): a GRN posts Dr Stock / Cr SRBNB; the supplier invoice
--    clears SRBNB. purchase_receipts.gl_posted marks GRNs that posted (older GRNs keep the old
--    "invoice posts the stock" behaviour). purchase_items.srbnb_qty/amount = what a line cleared.
--  * 3-way match result on purchase invoices.
--  * Landed cost vouchers (charges allocated onto GRN / invoice lines).
--  * Reorder: max stock (order-up-to) per warehouse; requisition source (auto reorder).
--  * Stock adjustment reason codes (+ optional per-reason GL account mapping).

ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_srbnb_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_price_variance_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS stock_adjustment_reason_accounts jsonb;
--> statement-breakpoint
ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS gl_posted boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE purchase_receipt_items ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);
--> statement-breakpoint
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS srbnb_qty numeric(12,3) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS srbnb_amount numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS match_status varchar(20);
--> statement-breakpoint
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS match_details jsonb;
--> statement-breakpoint
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS matched_at timestamp;
--> statement-breakpoint
ALTER TABLE warehouse_stock ADD COLUMN IF NOT EXISTS max_stock numeric(12,3);
--> statement-breakpoint
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reason_code varchar(30);
--> statement-breakpoint
ALTER TABLE stock_take_items ADD COLUMN IF NOT EXISTS reason_code varchar(30);
--> statement-breakpoint
ALTER TABLE waste_log ADD COLUMN IF NOT EXISTS reason_code varchar(30);
--> statement-breakpoint
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS source varchar(30);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_movements_reason_idx ON stock_movements (tenant_id, reason_code) WHERE reason_code IS NOT NULL;
--> statement-breakpoint

-- Landed cost vouchers
CREATE TABLE IF NOT EXISTS landed_cost_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  voucher_no varchar(50) NOT NULL,
  posting_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',      -- draft | submitted | cancelled
  allocation_method varchar(20) NOT NULL DEFAULT 'value', -- value | quantity
  total_charges numeric(15,2) NOT NULL DEFAULT 0,
  absorbed_amount numeric(15,2) NOT NULL DEFAULT 0, -- raised the cost of stock still on hand
  expensed_amount numeric(15,2) NOT NULL DEFAULT 0, -- goods already sold / gone: to COGS
  notes text,
  created_by uuid REFERENCES users(id),
  submitted_at timestamp,
  cancelled_at timestamp,
  cancellation_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS landed_cost_vouchers_no_idx ON landed_cost_vouchers (tenant_id, voucher_no);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS landed_cost_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES landed_cost_vouchers(id) ON DELETE CASCADE,
  charge_type varchar(20) NOT NULL,                 -- freight | duty | insurance | clearing | other
  description varchar(255),
  amount numeric(15,2) NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),        -- credited on Accounts Payable when set
  credit_account_id uuid REFERENCES chart_of_accounts(id) -- else this account is credited
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS landed_cost_charges_voucher_idx ON landed_cost_charges (voucher_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS landed_cost_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES landed_cost_vouchers(id) ON DELETE CASCADE,
  source_type varchar(20) NOT NULL,                 -- grn | purchase
  source_id uuid NOT NULL,
  source_no varchar(50),
  item_id uuid NOT NULL REFERENCES items(id),
  item_name varchar(255),
  quantity numeric(12,3) NOT NULL,
  base_value numeric(15,2) NOT NULL,
  allocated_amount numeric(15,2) NOT NULL DEFAULT 0,
  absorbed_amount numeric(15,2) NOT NULL DEFAULT 0,
  expensed_amount numeric(15,2) NOT NULL DEFAULT 0,
  cost_before numeric(12,2),
  cost_after numeric(12,2)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS landed_cost_items_voucher_idx ON landed_cost_items (voucher_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS landed_cost_items_source_idx ON landed_cost_items (tenant_id, source_type, source_id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['landed_cost_vouchers', 'landed_cost_charges', 'landed_cost_items'] LOOP
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
--> statement-breakpoint

-- Seed the SRBNB account (2190, under Current Liabilities 2100) for tenants that already have a
-- chart of accounts, and point accounting settings at it.
INSERT INTO chart_of_accounts (tenant_id, name, account_number, parent_id, root_type, account_type, is_group, is_system_account)
SELECT s.tenant_id, 'Stock Received But Not Billed', '2190', p.id, 'liability', 'current_liability', false, true
FROM accounting_settings s
JOIN chart_of_accounts p ON p.tenant_id = s.tenant_id AND p.account_number = '2100' AND p.is_group = true
WHERE s.default_srbnb_account_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.tenant_id = s.tenant_id AND c.account_number = '2190');
--> statement-breakpoint
UPDATE accounting_settings s
SET default_srbnb_account_id = c.id
FROM chart_of_accounts c
WHERE c.tenant_id = s.tenant_id
  AND c.account_number = '2190'
  AND c.name = 'Stock Received But Not Billed'
  AND c.is_group = false
  AND s.default_srbnb_account_id IS NULL;
--> statement-breakpoint

-- Cost-history sources for landed cost allocation (and its cancellation) and invoice-vs-GRN price variance
ALTER TYPE cost_change_source ADD VALUE IF NOT EXISTS 'landed_cost';
--> statement-breakpoint
ALTER TYPE cost_change_source ADD VALUE IF NOT EXISTS 'landed_cost_cancellation';
--> statement-breakpoint
ALTER TYPE cost_change_source ADD VALUE IF NOT EXISTS 'price_variance';
