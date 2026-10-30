-- 0189_measure_precision: stock quantities keep 4 decimal places so a sale in a related unit moves the
-- exact base quantity: 1.5 yd of a metre item = 1.3716 m (was rounded to 1.372), 0.5 in = 0.0127 m,
-- 250 g of a kg item = 0.25 kg. numeric(14,4) also keeps the 9-10 integer digits numeric(12,3) had.
-- Only base-unit stock columns change (warehouse stock, ledger, batches); line quantities stay in the
-- unit they were sold in. No views depend on these columns; RLS policies use tenant_id only.
-- sale_items.unit_price also keeps 4 dp: a unit price derived by a factor is exact (345 / kg sold
-- by the gram = 0.345 / g, so 250 g = 86.25 instead of 250 x 0.35 = 87.50). Line totals stay 2 dp.
-- Re-running is a no-op (same type).
ALTER TABLE "warehouse_stock" ALTER COLUMN "current_stock" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "warehouse_stock" ALTER COLUMN "reserved_stock" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "quantity" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "qty_change" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "stock_before" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "stock_after" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "item_batches" ALTER COLUMN "initial_quantity" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "item_batches" ALTER COLUMN "current_quantity" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "sale_item_batches" ALTER COLUMN "quantity" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "sale_item_batches" ALTER COLUMN "returned_quantity" TYPE numeric(14,4);
--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "unit_price" TYPE numeric(14,4);
