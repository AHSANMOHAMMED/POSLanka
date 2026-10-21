-- D1: sale line batch allocations, quarantine returns, purchasing fixes, per-tenant document numbering.
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. item_batches: allocation support
--    current_quantity is the remaining quantity of the batch in its warehouse (already present).
--    Legacy batches without a warehouse are attached to the tenant's default (else first active)
--    warehouse so FEFO allocation per warehouse can see them.
-- ---------------------------------------------------------------------------
UPDATE item_batches b
SET warehouse_id = (
      SELECT w.id FROM warehouses w
      WHERE w.tenant_id = b.tenant_id
      ORDER BY w.is_default DESC, w.is_active DESC, w.created_at
      LIMIT 1
    ),
    updated_at = now()
WHERE b.warehouse_id IS NULL
  AND EXISTS (SELECT 1 FROM warehouses w WHERE w.tenant_id = b.tenant_id);

-- batches that are already empty are 'consumed' (they are re-activated when stock comes back)
UPDATE item_batches SET status = 'consumed', updated_at = now()
WHERE status = 'active' AND current_quantity <= 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_batches_current_quantity_nonneg') THEN
    ALTER TABLE item_batches ADD CONSTRAINT item_batches_current_quantity_nonneg CHECK (current_quantity >= 0) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_item_batches_alloc
  ON item_batches (tenant_id, item_id, warehouse_id, expiry_date)
  WHERE current_quantity > 0;
CREATE INDEX IF NOT EXISTS idx_item_batches_item_number
  ON item_batches (tenant_id, item_id, batch_number);

-- ---------------------------------------------------------------------------
-- 2. sale_item_batches: which batches a sale line drew from (and, for return lines, which
--    batch the returned quantity went back into). alloc_order keeps the allocation order so
--    returns restore LIFO.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_item_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES item_batches(id),
  quantity numeric(12,3) NOT NULL,
  returned_quantity numeric(12,3) NOT NULL DEFAULT 0,
  alloc_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT sale_item_batches_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sale_item_batches_returned_range CHECK (returned_quantity >= 0 AND returned_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_sale_item_batches_line ON sale_item_batches (sale_item_id, alloc_order);
CREATE INDEX IF NOT EXISTS idx_sale_item_batches_batch ON sale_item_batches (tenant_id, batch_id);

ALTER TABLE sale_item_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_item_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON sale_item_batches;
CREATE POLICY tenant_isolation_policy ON sale_item_batches
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON sale_item_batches TO app_user;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. purchase_items: link to the PO line and how much this invoice line added to
--    purchase_order_items.received_quantity (NULL = legacy row, unknown).
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS po_received_qty numeric(12,3);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_purchase_order_item_fkey') THEN
    ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_purchase_order_item_fkey
      FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_purchase_items_po_line ON purchase_items (purchase_order_item_id)
  WHERE purchase_order_item_id IS NOT NULL;

-- item_cost_history lookups by document (cost reversal on purchase cancel / delete)
CREATE INDEX IF NOT EXISTS idx_item_cost_history_reference ON item_cost_history (tenant_id, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Per-tenant document sequences (tenant_sequences). Seed every key from the current NUMERIC
--    maximum of existing document numbers per tenant (never lexicographic). Period based series
--    (daily / monthly / yearly) get one key per period: '<key>:<period>'.
--    GREATEST keeps any value already allocated by the application.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- key,                  table,                  column,            regex (period group optional, number group last), periodic
    ('purchase_invoice',     'purchases',            'purchase_no',     '^PI-(\d{8})-(\d{1,15})$',        true),
    ('purchase_return',      'purchases',            'purchase_no',     '^PR-(\d{8})-(\d{1,15})$',        true),
    ('purchase_requisition', 'purchase_requisitions','requisition_no',  '^PR-(\d{8})-(\d{1,15})$',        true),
    ('purchase_order',       'purchase_orders',      'order_no',        '^PO-(\d{8})-(\d{1,15})$',        true),
    ('supplier_quotation',   'supplier_quotations',  'quotation_no',    '^SQ-(\d{8})-(\d{1,15})$',        true),
    ('sales_order',          'sales_orders',         'order_no',        '^SO-(\d{8})-(\d{1,15})$',        true),
    ('grn',                  'purchase_receipts',    'receipt_no',      '^GRN-(\d{8})-(\d{1,15})$',       true),
    ('stock_take',           'stock_takes',          'count_no',        '^SC-(\d{8})-(\d{1,15})$',        true),
    ('dealer_payment',       'dealer_payments',      'payment_no',      '^DP-(\d{8})-(\d{1,15})$',        true),
    ('pos_opening',          'pos_opening_entries',  'entry_number',    '^POS-(\d{8})-(\d{1,15})$',       true),
    ('pos_closing',          'pos_closing_entries',  'entry_number',    '^CLOSE-(\d{8})-(\d{1,15})$',     true),
    ('vehicle_import',       'vehicle_imports',      'import_no',       '^IM-(\d{8})-(\d{1,15})$',        true),
    ('stock_transfer',       'stock_transfers',      'transfer_no',     '^ST(\d{4})(\d{1,15})$',          true),
    ('salary_slip',          'salary_slips',         'slip_no',         '^SAL-(\d{4}-\d{2})-(\d{1,15})$', true),
    ('payroll_run',          'payroll_runs',         'run_no',          '^PR-(\d{4}-\d{2})-(\d{1,15})$',  true),
    ('layaway',              'layaways',             'layaway_no',      '^LAY-(\d{1,15})$',               false),
    ('journal_entry',        'journal_entries',      'entry_number',    '^JE-(\d{1,15})$',                false),
    ('payment_entry',        'payment_entries',      'entry_number',    '^PE-(\d{1,15})$',                false),
    ('dunning',              'dunnings',             'dunning_number',  '^DUN-(\d{1,15})$',               false),
    ('payment_request',      'payment_requests',     'request_number',  '^PRQ-(\d{1,15})$',               false),
    ('quotation',            'quotations',           'quotation_no',    '^QT-(\d{1,15})$',                false),
    ('held_sale',            'held_sales',           'hold_number',     '^HOLD-(\d{1,15})$',              false),
    ('work_order',           'work_orders',          'order_no',        '^WO-(\d{1,15})$',                false),
    ('insurance_estimate',   'insurance_estimates',  'estimate_no',     '^EST-(\d{1,15})$',               false),
    ('vehicle_sale',         'sales',                'invoice_no',      '^VS-(\d{1,15})$',                false),
    ('commission_payout',    'commission_payouts',   'payout_no',       '^PAY-(\d{1,15})$',               false),
    ('employee_advance',     'employee_advances',    'advance_no',      '^ADV-(\d{1,15})$',               false)
  ) AS v(k, t, c, re, periodic)
  LOOP
    IF to_regclass('public.' || r.t) IS NULL THEN CONTINUE; END IF;
    IF r.periodic THEN
      EXECUTE format($f$
        INSERT INTO tenant_sequences (tenant_id, seq_key, next_value, updated_at)
        SELECT tenant_id, %L || ':' || m[1], MAX(m[2]::numeric)::bigint + 1, now()
        FROM (SELECT tenant_id, regexp_match(%I, %L) AS m FROM %I WHERE tenant_id IS NOT NULL) x
        WHERE m IS NOT NULL
        GROUP BY tenant_id, m[1]
        ON CONFLICT (tenant_id, seq_key) DO UPDATE
          SET next_value = GREATEST(tenant_sequences.next_value, EXCLUDED.next_value), updated_at = now()
      $f$, r.k, r.c, r.re, r.t);
    ELSE
      EXECUTE format($f$
        INSERT INTO tenant_sequences (tenant_id, seq_key, next_value, updated_at)
        SELECT tenant_id, %L, MAX(m[1]::numeric)::bigint + 1, now()
        FROM (SELECT tenant_id, regexp_match(%I, %L) AS m FROM %I WHERE tenant_id IS NOT NULL) x
        WHERE m IS NOT NULL
        GROUP BY tenant_id
        ON CONFLICT (tenant_id, seq_key) DO UPDATE
          SET next_value = GREATEST(tenant_sequences.next_value, EXCLUDED.next_value), updated_at = now()
      $f$, r.k, r.c, r.re, r.t);
    END IF;
  END LOOP;
END $$;
