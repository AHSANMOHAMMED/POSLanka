-- Migration: Add cost center tracking to business documents and GL
-- Also adds stock adjustment account to accounting_settings

-- 1. Add cost_center_id to pos_profiles
ALTER TABLE pos_profiles ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- 2. Add cost_center_id to sales
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- 3. Add cost_center_id to purchases
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- 4. Add cost_center_id to work_orders
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- 5. Add cost_center_id to stock_movements
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- 6. Add default_cost_center_id and default_stock_adjustment_account_id to accounting_settings
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_cost_center_id UUID REFERENCES cost_centers(id);
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_stock_adjustment_account_id UUID REFERENCES chart_of_accounts(id);

-- 7. Add FK constraint to existing gl_entries.cost_center_id (column exists but has no FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'gl_entries_cost_center_id_fkey'
    AND table_name = 'gl_entries'
  ) THEN
    ALTER TABLE gl_entries ADD CONSTRAINT gl_entries_cost_center_id_fkey
      FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id);
  END IF;
END $$;

-- 8. Add FK constraint to existing journal_entry_items.cost_center_id (column exists but has no FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'journal_entry_items_cost_center_id_fkey'
    AND table_name = 'journal_entry_items'
  ) THEN
    ALTER TABLE journal_entry_items ADD CONSTRAINT journal_entry_items_cost_center_id_fkey
      FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id);
  END IF;
END $$;

-- 9. Indexes for cost center filtering performance
CREATE INDEX IF NOT EXISTS idx_sales_cost_center_id ON sales(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_purchases_cost_center_id ON purchases(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_cost_center_id ON work_orders(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_cost_center_id ON stock_movements(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_gl_entries_cost_center_id ON gl_entries(cost_center_id);
