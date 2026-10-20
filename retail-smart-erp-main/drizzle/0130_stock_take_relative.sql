-- W2 inventory core: relative stock take completion (preserves sales made during the count)
ALTER TABLE "stock_take_items" ADD COLUMN IF NOT EXISTS "system_qty_at_count" numeric(12,3);
ALTER TABLE "stock_take_items" ADD COLUMN IF NOT EXISTS "applied_movement_id" uuid;
ALTER TABLE "stock_take_items" ADD COLUMN IF NOT EXISTS "applied_at" timestamp;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_items_applied_movement_fk') THEN
    ALTER TABLE "stock_take_items" ADD CONSTRAINT "stock_take_items_applied_movement_fk"
      FOREIGN KEY ("applied_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_stock_take_items_stock_take" ON "stock_take_items" ("stock_take_id");
