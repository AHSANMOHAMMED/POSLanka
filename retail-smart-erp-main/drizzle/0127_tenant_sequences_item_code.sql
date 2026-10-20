-- W2 inventory core: tenant_sequences, items.item_code/created_by/updated_by/version, invoice sequences
-- Idempotent: safe to re-run.

-- 1. Per-tenant counters (item codes, generated barcodes, invoice / return numbers, ...)
CREATE TABLE IF NOT EXISTS "tenant_sequences" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "seq_key" varchar(40) NOT NULL,
  "next_value" bigint NOT NULL DEFAULT 1,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id", "seq_key")
);

ALTER TABLE "tenant_sequences" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tenant_sequences' AND policyname = 'tenant_sequences_tenant_isolation'
  ) THEN
    CREATE POLICY "tenant_sequences_tenant_isolation" ON "tenant_sequences"
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_sequences" TO app_user;
  END IF;
END $$;

-- 2. Item code + audit columns
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "item_code" varchar(30);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_created_by_users_id_fk') THEN
    ALTER TABLE "items" ADD CONSTRAINT "items_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_updated_by_users_id_fk') THEN
    ALTER TABLE "items" ADD CONSTRAINT "items_updated_by_users_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill item codes per tenant in creation order (only rows still missing a code;
-- numbering continues after any code already assigned).
WITH base AS (
  SELECT tenant_id,
         COALESCE(MAX(NULLIF(substring(item_code FROM '^ITM-(\d{1,15})$'), '')::bigint), 0) AS max_no
  FROM items
  GROUP BY tenant_id
), numbered AS (
  SELECT i.id,
         b.max_no + row_number() OVER (PARTITION BY i.tenant_id ORDER BY i.created_at, i.id) AS n
  FROM items i
  JOIN base b ON b.tenant_id = i.tenant_id
  WHERE i.item_code IS NULL
)
UPDATE items i
SET item_code = 'ITM-' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE numbered.id = i.id;

ALTER TABLE "items" ALTER COLUMN "item_code" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "items_tenant_item_code_unique" ON "items" ("tenant_id", "item_code");

-- Seed item_code sequence = highest numeric ITM code + 1
INSERT INTO tenant_sequences (tenant_id, seq_key, next_value)
SELECT t.id,
       'item_code',
       COALESCE((SELECT MAX(substring(i.item_code FROM '^ITM-(\d{1,15})$')::bigint)
                 FROM items i WHERE i.tenant_id = t.id), 0) + 1
FROM tenants t
ON CONFLICT (tenant_id, seq_key) DO UPDATE
  SET next_value = GREATEST(tenant_sequences.next_value, EXCLUDED.next_value), updated_at = now();

INSERT INTO tenant_sequences (tenant_id, seq_key, next_value)
SELECT t.id, 'item_barcode', 1 FROM tenants t
ON CONFLICT (tenant_id, seq_key) DO NOTHING;

-- 3. PLU uniqueness (only when existing data allows it)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'items_tenant_plu_unique') THEN
    IF EXISTS (
      SELECT 1 FROM items
      WHERE plu_code IS NOT NULL AND plu_code <> ''
      GROUP BY tenant_id, plu_code HAVING count(*) > 1
    ) THEN
      RAISE NOTICE 'items_tenant_plu_unique not created: duplicate PLU codes exist; clean them up and re-run';
    ELSE
      CREATE UNIQUE INDEX "items_tenant_plu_unique" ON "items" ("tenant_id", "plu_code")
        WHERE plu_code IS NOT NULL AND plu_code <> '';
    END IF;
  END IF;
END $$;

-- 4. Invoice / return number sequences seeded from the numeric max (not lexicographic MAX)
INSERT INTO tenant_sequences (tenant_id, seq_key, next_value)
SELECT t.id,
       'invoice',
       COALESCE((SELECT MAX(substring(s.invoice_no FROM '^INV-(\d{1,15})$')::bigint)
                 FROM sales s WHERE s.tenant_id = t.id), 0) + 1
FROM tenants t
ON CONFLICT (tenant_id, seq_key) DO UPDATE
  SET next_value = GREATEST(tenant_sequences.next_value, EXCLUDED.next_value), updated_at = now();

INSERT INTO tenant_sequences (tenant_id, seq_key, next_value)
SELECT t.id,
       'return',
       COALESCE((SELECT MAX(substring(s.invoice_no FROM '^RTN-(\d{1,15})$')::bigint)
                 FROM sales s WHERE s.tenant_id = t.id), 0) + 1
FROM tenants t
ON CONFLICT (tenant_id, seq_key) DO UPDATE
  SET next_value = GREATEST(tenant_sequences.next_value, EXCLUDED.next_value), updated_at = now();

-- 5. Safety net: writers that do not go through createItem() (e.g. generic CSV import)
--    still get an item code allocated from the same per-tenant sequence.
CREATE OR REPLACE FUNCTION items_fill_item_code() RETURNS trigger AS $$
DECLARE
  v_next bigint;
BEGIN
  IF NEW.item_code IS NULL OR NEW.item_code = '' THEN
    INSERT INTO tenant_sequences (tenant_id, seq_key, next_value)
    VALUES (NEW.tenant_id, 'item_code', 2)
    ON CONFLICT (tenant_id, seq_key) DO UPDATE
      SET next_value = tenant_sequences.next_value + 1, updated_at = now()
    RETURNING next_value - 1 INTO v_next;
    NEW.item_code := 'ITM-' || lpad(v_next::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_fill_item_code ON items;
CREATE TRIGGER items_fill_item_code
  BEFORE INSERT ON items
  FOR EACH ROW EXECUTE FUNCTION items_fill_item_code();
