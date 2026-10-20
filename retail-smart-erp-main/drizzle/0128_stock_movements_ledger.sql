-- W2 inventory core: stock ledger (signed qty_change, before/after, idempotency) + backfill + legacy trigger
-- Idempotent: every backfill step only touches rows whose qty_change is still NULL.

ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "qty_change" numeric(12,3);
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "stock_before" numeric(12,3);
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "stock_after" numeric(12,3);
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "sign_source" varchar(20);
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "source" varchar(20);
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(150);

-- ---------------------------------------------------------------------------
-- Backfill qty_change (signed). Order matters: the first rule that matches wins.
-- ---------------------------------------------------------------------------

-- a) 'in' is always an increase
UPDATE stock_movements
SET qty_change = abs(quantity), sign_source = 'derived_type'
WHERE qty_change IS NULL AND type = 'in';

-- b) 'out' is always a decrease (also repairs rows that were stored negative)
UPDATE stock_movements
SET qty_change = -abs(quantity), sign_source = 'derived_type'
WHERE qty_change IS NULL AND type = 'out';

-- c) adjustments that already stored a signed quantity
UPDATE stock_movements
SET qty_change = quantity, sign_source = 'native'
WHERE qty_change IS NULL AND type = 'adjustment'
  AND (reference_type = 'manual_adjustment' OR quantity < 0);

-- d) stock take adjustments: sign from the stock take line variance
UPDATE stock_movements sm
SET qty_change = sti.variance, sign_source = 'derived_stock_take'
FROM stock_take_items sti
WHERE sm.qty_change IS NULL AND sm.type = 'adjustment'
  AND sm.reference_type = 'stock_take'
  AND sti.stock_take_id = sm.reference_id
  AND sti.item_id = sm.item_id
  AND sti.variance IS NOT NULL
  AND abs(sti.variance) = abs(sm.quantity);

-- e) adjustments posted to GL: debit on the stock account = increase, credit = decrease
UPDATE stock_movements sm
SET qty_change = CASE WHEN g.debit > 0 THEN abs(sm.quantity) ELSE -abs(sm.quantity) END,
    sign_source = 'derived_gl'
FROM gl_entries g
JOIN accounting_settings acs ON acs.tenant_id = g.tenant_id
WHERE sm.qty_change IS NULL AND sm.type = 'adjustment'
  AND g.tenant_id = sm.tenant_id
  AND g.voucher_type = 'stock_adjustment'
  AND g.voucher_id = sm.id
  AND acs.default_stock_account_id IS NOT NULL
  AND g.account_id = acs.default_stock_account_id
  AND (g.debit > 0 OR g.credit > 0);

-- f) sign from the notes text written by the old code paths
UPDATE stock_movements
SET qty_change = -abs(quantity), sign_source = 'derived_notes'
WHERE qty_change IS NULL AND type = 'adjustment'
  AND (notes ~ '^Bulk adjustment: -' OR notes ILIKE '%shortage%');

UPDATE stock_movements
SET qty_change = abs(quantity), sign_source = 'derived_notes'
WHERE qty_change IS NULL AND type = 'adjustment'
  AND (notes ~ '^Bulk adjustment: \+' OR notes ~ '^Bulk adjustment: [0-9]' OR notes ILIKE '%surplus%');

-- g) anything left: keep as-is, flag as unknown (ignored by the stock audit)
UPDATE stock_movements
SET qty_change = quantity, sign_source = 'unknown'
WHERE qty_change IS NULL;

-- quantity becomes the unsigned magnitude
UPDATE stock_movements SET quantity = abs(quantity) WHERE quantity < 0;

-- ---------------------------------------------------------------------------
-- Ledger baseline: one zero-qty movement per warehouse_stock row capturing the
-- current stock. Audits reconcile from the latest baseline onward.
-- ---------------------------------------------------------------------------
INSERT INTO stock_movements (tenant_id, warehouse_id, item_id, type, quantity, qty_change,
                             stock_before, stock_after, reference_type, notes, source, sign_source, created_at)
SELECT ws.tenant_id, ws.warehouse_id, ws.item_id, 'adjustment', 0, 0,
       ws.current_stock, ws.current_stock, 'ledger_baseline',
       'Ledger baseline (stock ledger migration)', 'system', 'native', now()
FROM warehouse_stock ws
WHERE NOT EXISTS (
  SELECT 1 FROM stock_movements sm
  WHERE sm.tenant_id = ws.tenant_id AND sm.warehouse_id = ws.warehouse_id
    AND sm.item_id = ws.item_id AND sm.reference_type = 'ledger_baseline'
);

-- ---------------------------------------------------------------------------
-- Constraints & indexes
-- ---------------------------------------------------------------------------
ALTER TABLE "stock_movements" ALTER COLUMN "qty_change" SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_quantity_nonneg') THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_nonneg" CHECK (quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_before_after_consistent') THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_before_after_consistent"
      CHECK (stock_before IS NULL OR stock_after = stock_before + qty_change);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_tenant_idem_unique"
  ON "stock_movements" ("tenant_id", "idempotency_key") WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_stock_movements_tenant_item_created"
  ON "stock_movements" ("tenant_id", "item_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_stock_movements_tenant_wh_item_created"
  ON "stock_movements" ("tenant_id", "warehouse_id", "item_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Transitional trigger: legacy writers that do not set qty_change yet.
-- (Dropped by 0138 once every writer goes through applyStockChange.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_movements_legacy_fill() RETURNS trigger AS $$
BEGIN
  IF NEW.qty_change IS NULL THEN
    IF NEW.type = 'in' THEN
      NEW.qty_change := abs(NEW.quantity);
    ELSIF NEW.type = 'out' THEN
      NEW.qty_change := -abs(NEW.quantity);
    ELSE
      NEW.qty_change := NEW.quantity;
    END IF;
    NEW.sign_source := 'legacy_trigger';
  END IF;
  IF NEW.quantity < 0 THEN
    NEW.quantity := abs(NEW.quantity);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_movements_legacy_fill ON stock_movements;
CREATE TRIGGER stock_movements_legacy_fill
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_legacy_fill();
