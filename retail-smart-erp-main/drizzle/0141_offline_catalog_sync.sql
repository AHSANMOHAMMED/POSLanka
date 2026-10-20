-- W6 offline selling: item tombstones + delta-sync indexes for the mobile catalog cache,
-- and a `flags` column on sales for offline sale annotations
-- (e.g. {"offline": true, "priceDifferences": [{"itemId": "...", "sold": 95, "catalog": 100}]}).
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. item_tombstones: hard-deleted items, so phones can drop them from their local catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "item_tombstones" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL,
  "deleted_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "item_tombstones_pkey" PRIMARY KEY ("tenant_id", "item_id")
);

CREATE INDEX IF NOT EXISTS "idx_item_tombstones_tenant_deleted_at"
  ON "item_tombstones" ("tenant_id", "deleted_at");

ALTER TABLE "item_tombstones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_tombstones" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON "item_tombstones";
CREATE POLICY tenant_isolation_policy ON "item_tombstones"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "item_tombstones" TO app_user;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Delta-sync keysets
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_items_tenant_updated_at_id" ON "items" ("tenant_id", "updated_at", "id");
CREATE INDEX IF NOT EXISTS "idx_warehouse_stock_wh_updated_at" ON "warehouse_stock" ("warehouse_id", "updated_at");

-- Keep updated_at moving on every write so delta sync never misses a change made by a
-- writer that forgot to set it. An explicit new value set by the writer is kept.
CREATE OR REPLACE FUNCTION w6_touch_updated_at() RETURNS trigger AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_w6_touch_updated_at ON "items";
CREATE TRIGGER items_w6_touch_updated_at BEFORE UPDATE ON "items"
  FOR EACH ROW EXECUTE FUNCTION w6_touch_updated_at();

DROP TRIGGER IF EXISTS warehouse_stock_w6_touch_updated_at ON "warehouse_stock";
CREATE TRIGGER warehouse_stock_w6_touch_updated_at BEFORE UPDATE ON "warehouse_stock"
  FOR EACH ROW EXECUTE FUNCTION w6_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. sales.flags (offline annotations: price / tax differences, stock shortfalls)
-- ---------------------------------------------------------------------------
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "flags" jsonb NOT NULL DEFAULT '{}'::jsonb;
