-- Performance indexes (2026-11 DB audit). Additive and idempotent; plain CREATE INDEX (no
-- CONCURRENTLY) so it runs inside the migrator. Supersedes the manual root add-indexes.sql:
-- its vehicles(customer_id), vehicles(tenant_id, license_plate) and customers phone/email
-- entries already exist (idx_vehicles_customer_id, vehicles_tenant_license_plate_unique,
-- customers_tenant_phone_unique / customers_tenant_email_unique), so they are not repeated here.

-- payment_entry_references: AR/AP/outstanding/reconciliation sum allocations per document
CREATE INDEX IF NOT EXISTS "idx_per_reference" ON "payment_entry_references" ("reference_type", "reference_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_per_source_je_item" ON "payment_entry_references" ("source_je_item_id") WHERE "source_je_item_id" IS NOT NULL;
--> statement-breakpoint

-- journal_entry_items: loaded per journal entry, by account, and by party (AR/AP JE lines)
CREATE INDEX IF NOT EXISTS "idx_jei_journal_entry" ON "journal_entry_items" ("journal_entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jei_account" ON "journal_entry_items" ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jei_tenant_party" ON "journal_entry_items" ("tenant_id", "party_type", "party_id");
--> statement-breakpoint

-- sales by branch/warehouse, newest first (POS history, branch reports)
CREATE INDEX IF NOT EXISTS "idx_sales_tenant_wh_created" ON "sales" ("tenant_id", "warehouse_id", "created_at" DESC);
--> statement-breakpoint

-- stock movement list (newest first, no item filter)
CREATE INDEX IF NOT EXISTS "idx_stock_movements_tenant_created" ON "stock_movements" ("tenant_id", "created_at" DESC);
--> statement-breakpoint

-- general ledger / account ledger: one account over a date range
CREATE INDEX IF NOT EXISTS "idx_gl_entries_tenant_account_date" ON "gl_entries" ("tenant_id", "account_id", "posting_date");
--> statement-breakpoint

-- purchase lines loaded per purchase
CREATE INDEX IF NOT EXISTS "idx_purchase_items_purchase" ON "purchase_items" ("purchase_id");
--> statement-breakpoint

-- Trigram indexes for ILIKE '%term%' searches (customers list, sales list, journal entries list).
-- Wrapped like 0123 so a database without permission to install pg_trgm still migrates cleanly.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "idx_customers_name_trgm" ON "customers" USING gin ("name" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_customers_phone_trgm" ON "customers" USING gin ("phone" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_customers_email_trgm" ON "customers" USING gin ("email" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_sales_invoice_no_trgm" ON "sales" USING gin ("invoice_no" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_sales_customer_name_trgm" ON "sales" USING gin ("customer_name" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_journal_entries_entry_number_trgm" ON "journal_entries" USING gin ("entry_number" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm indexes skipped: %', SQLERRM;
END $$;
