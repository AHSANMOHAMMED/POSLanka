-- Audit B (inventory): batch tracking through stock transfers + serial number uniqueness.
-- Idempotent; safe to re-run.

-- 1. Batches picked (FEFO) from the source warehouse when a transfer ships, so the receipt
--    can put them into the destination warehouse and a cancellation can put them back.
--    [{ batchId, batchNumber, expiryDate, quantity }]
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS batch_allocations jsonb;

-- 2. A serial number may exist only once per item (per tenant). Created only when the data
--    has no duplicates yet; otherwise a NOTICE lists the condition and the app-level check
--    keeps guarding new entries.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'item_serial_numbers_tenant_item_serial_unique') THEN
    IF EXISTS (
      SELECT 1 FROM item_serial_numbers
      GROUP BY tenant_id, item_id, serial_number HAVING count(*) > 1
    ) THEN
      RAISE NOTICE 'item_serial_numbers has duplicate (tenant_id, item_id, serial_number) rows; unique index not created';
    ELSE
      CREATE UNIQUE INDEX item_serial_numbers_tenant_item_serial_unique
        ON item_serial_numbers (tenant_id, item_id, serial_number);
    END IF;
  END IF;
END $$;

-- 3. Waste log entries reduce stock: the warehouse the waste came out of, the ledger movement
--    and (batch-tracked items) the batches it was taken from.
ALTER TABLE waste_log ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);
ALTER TABLE waste_log ADD COLUMN IF NOT EXISTS stock_movement_id uuid;
ALTER TABLE waste_log ADD COLUMN IF NOT EXISTS batch_allocations jsonb;
