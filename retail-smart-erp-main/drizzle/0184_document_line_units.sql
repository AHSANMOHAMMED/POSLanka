-- 0184_document_line_units: sales orders, purchase orders, purchase invoices and GRNs keep the
-- unit a line was entered in. quantity / unit price / received / fulfilled quantities are in
-- `uom`; stock, reservations and costing use quantity × uom_factor base units (items.unit).
-- uom NULL = the item's base unit (factor 1), the same convention as sale_items.
ALTER TABLE "sales_order_items" ADD COLUMN IF NOT EXISTS "uom" varchar(20);
--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD COLUMN IF NOT EXISTS "uom_factor" numeric(14,6) NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "uom" varchar(20);
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "uom_factor" numeric(14,6) NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "uom" varchar(20);
--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN IF NOT EXISTS "uom_factor" numeric(14,6) NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD COLUMN IF NOT EXISTS "uom" varchar(20);
--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD COLUMN IF NOT EXISTS "uom_factor" numeric(14,6) NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_uom_factor_pos" CHECK ("uom_factor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_uom_factor_pos" CHECK ("uom_factor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_uom_factor_pos" CHECK ("uom_factor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_uom_factor_pos" CHECK ("uom_factor" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
