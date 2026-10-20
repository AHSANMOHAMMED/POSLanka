-- W8 returns / exchange / offline receipts.
--  * sales.offline_ref: receipt number printed while offline ('OFF-<device>-<seq>'), unique per tenant
--  * sales.exchange_of: on the sale half of an exchange, the id of the linked return (RTN-)
--  * sales.return_reason / return_notes: why a return was made ('no_receipt' for manual returns)
--  * sale_items.returned_quantity: quantity of this line already returned (maintained under the
--    original sale's row lock by src/lib/sales/returns.ts)
--  * sale_items.original_sale_item_id: on return lines, the original sale line being returned

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "offline_ref" varchar(40);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "exchange_of" uuid;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "return_reason" varchar(50);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "return_notes" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales" ADD CONSTRAINT "sales_exchange_of_fkey"
    FOREIGN KEY ("exchange_of") REFERENCES "sales"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_sales_tenant_offline_ref"
  ON "sales" ("tenant_id", "offline_ref") WHERE "offline_ref" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_tenant_invoice_no" ON "sales" ("tenant_id", "invoice_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_tenant_return_against"
  ON "sales" ("tenant_id", "return_against") WHERE "return_against" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_exchange_of" ON "sales" ("exchange_of") WHERE "exchange_of" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "returned_quantity" numeric(12, 3) DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "original_sale_item_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_original_sale_item_fkey"
    FOREIGN KEY ("original_sale_item_id") REFERENCES "sale_items"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_returned_quantity_nonneg"
    CHECK ("returned_quantity" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_items_sale_id" ON "sale_items" ("sale_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sale_items_original_line"
  ON "sale_items" ("original_sale_item_id") WHERE "original_sale_item_id" IS NOT NULL;
--> statement-breakpoint

-- Backfill returned_quantity from existing (non-void) returns: per original sale and item, the
-- total returned quantity is spread over that sale's lines for the item in line order, each line
-- capped at its own quantity. Only rows still at 0 are touched, so re-running is harmless.
WITH returned AS (
  SELECT r.tenant_id, r.return_against AS sale_id, ri.item_id, SUM(ABS(ri.quantity)) AS qty
  FROM sales r
  JOIN sale_items ri ON ri.sale_id = r.id
  WHERE r.is_return = true AND r.return_against IS NOT NULL AND r.status <> 'void'
    AND ri.item_id IS NOT NULL
  GROUP BY r.tenant_id, r.return_against, ri.item_id
),
lines AS (
  SELECT si.id, si.sale_id, si.item_id, ABS(si.quantity) AS qty,
         SUM(ABS(si.quantity)) OVER (PARTITION BY si.sale_id, si.item_id ORDER BY si.id) AS cum
  FROM sale_items si
  JOIN returned rt ON rt.sale_id = si.sale_id AND rt.item_id = si.item_id
  WHERE si.quantity > 0
),
alloc AS (
  SELECT l.id, LEAST(l.qty, GREATEST(0, rt.qty - (l.cum - l.qty))) AS ret
  FROM lines l
  JOIN returned rt ON rt.sale_id = l.sale_id AND rt.item_id = l.item_id
)
UPDATE sale_items si
SET returned_quantity = alloc.ret
FROM alloc
WHERE si.id = alloc.id AND alloc.ret > 0 AND si.returned_quantity = 0;
