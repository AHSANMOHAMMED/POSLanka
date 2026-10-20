-- POS PIN for lock-screen unlock and supervisor overrides
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pin_hash" text;

-- Fast exact-match scan lookups by PLU code (barcode already has a unique tenant index)
CREATE INDEX IF NOT EXISTS "idx_items_tenant_plu_code" ON "items" ("tenant_id", "plu_code") WHERE "plu_code" IS NOT NULL;

-- Trigram indexes so POS product search (ILIKE '%term%') stays fast on large catalogs.
-- Wrapped so a database without permission to install pg_trgm still migrates cleanly.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "idx_items_name_trgm" ON "items" USING gin ("name" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_items_sku_trgm" ON "items" USING gin ("sku" gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS "idx_items_barcode_trgm" ON "items" USING gin ("barcode" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm indexes skipped: %', SQLERRM;
END $$;
