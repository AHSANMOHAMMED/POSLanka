-- H5: price lists, promotions, extra barcodes per item, units of measure + conversions, product type.
-- Idempotent; safe to re-run. Pricing maths: src/lib/pricing/engine.ts; checkout integration plan:
-- docs/INTEGRATION_PRICING.md (sale line columns below are written by the sales route).

-- ---------------------------------------------------------------------------
-- 1. Product type (stockable | consumable | service), kept consistent with items.track_stock
-- ---------------------------------------------------------------------------
ALTER TABLE items ADD COLUMN IF NOT EXISTS product_type varchar(20) NOT NULL DEFAULT 'stockable';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_product_type_check') THEN
    ALTER TABLE items ADD CONSTRAINT items_product_type_check CHECK (product_type IN ('stockable', 'consumable', 'service'));
  END IF;
END $$;
--> statement-breakpoint
-- Backfill once: untracked gift cards are consumable, other untracked items are services.
UPDATE items SET product_type = CASE WHEN is_gift_card THEN 'consumable' ELSE 'service' END
WHERE track_stock = false AND product_type = 'stockable';
--> statement-breakpoint
-- stockable ⇔ track_stock. Whichever side a writer changes wins; product_type wins when both change.
CREATE OR REPLACE FUNCTION items_sync_product_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.product_type <> 'stockable' THEN
      NEW.track_stock := false;
    ELSIF NOT NEW.track_stock THEN
      NEW.product_type := CASE WHEN NEW.is_gift_card THEN 'consumable' ELSE 'service' END;
    END IF;
  ELSIF NEW.product_type IS DISTINCT FROM OLD.product_type THEN
    NEW.track_stock := (NEW.product_type = 'stockable');
  ELSIF NEW.track_stock IS DISTINCT FROM OLD.track_stock THEN
    NEW.product_type := CASE
      WHEN NEW.track_stock THEN 'stockable'
      WHEN NEW.is_gift_card THEN 'consumable'
      ELSE 'service' END;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS items_sync_product_type_trg ON items;
--> statement-breakpoint
CREATE TRIGGER items_sync_product_type_trg BEFORE INSERT OR UPDATE OF product_type, track_stock ON items
  FOR EACH ROW EXECUTE FUNCTION items_sync_product_type();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Units of measure (per tenant) and per-item conversions to the base unit (items.unit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code varchar(20) NOT NULL,                    -- 'pcs', 'kg', 'box' … (matches items.unit / sale_items.uom)
  name varchar(50) NOT NULL,
  allow_fraction boolean NOT NULL DEFAULT false, -- kg / l may be sold in decimals
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS units_tenant_code_unique ON units (tenant_id, lower(code));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS item_uoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  uom varchar(20) NOT NULL,                     -- unit code
  factor numeric(14,6) NOT NULL CHECK (factor > 0), -- base units per 1 of this unit (box = 12 pcs → 12)
  barcode varchar(100),
  selling_price numeric(12,2),                  -- price of 1 of this unit; null → base price × factor
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS item_uoms_item_uom_unique ON item_uoms (item_id, lower(uom));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS item_uoms_tenant_barcode_unique ON item_uoms (tenant_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_uoms_tenant_idx ON item_uoms (tenant_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Additional barcodes per item (items.barcode stays the primary one)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  barcode varchar(100) NOT NULL,
  uom varchar(20),                              -- null = base unit
  pack_qty numeric(12,3) NOT NULL DEFAULT 1 CHECK (pack_qty > 0), -- quantity (in uom) one scan adds
  price_override numeric(12,2),                 -- unit price when sold through this barcode
  label varchar(100),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS item_barcodes_tenant_barcode_unique ON item_barcodes (tenant_id, barcode);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS item_barcodes_item_idx ON item_barcodes (item_id);
--> statement-breakpoint
-- A barcode is unique per tenant across items.barcode, item_barcodes.barcode and item_uoms.barcode.
-- Violations raise 23505 with constraint items_tenant_barcode_unique so existing duplicate
-- mapping (src/lib/db/errors.ts, createItem's generated-barcode retry) keeps working.
CREATE OR REPLACE FUNCTION catalog_barcode_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  code text;
  clash boolean;
BEGIN
  code := NEW.barcode;
  IF code IS NULL OR code = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.barcode IS NOT DISTINCT FROM OLD.barcode AND NEW.tenant_id = OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('barcode:' || NEW.tenant_id::text || ':' || code, 0));
  IF TG_TABLE_NAME = 'items' THEN
    SELECT EXISTS (SELECT 1 FROM item_barcodes WHERE tenant_id = NEW.tenant_id AND barcode = code)
        OR EXISTS (SELECT 1 FROM item_uoms WHERE tenant_id = NEW.tenant_id AND barcode = code) INTO clash;
  ELSIF TG_TABLE_NAME = 'item_barcodes' THEN
    SELECT EXISTS (SELECT 1 FROM items WHERE tenant_id = NEW.tenant_id AND barcode = code)
        OR EXISTS (SELECT 1 FROM item_barcodes WHERE tenant_id = NEW.tenant_id AND barcode = code AND id <> NEW.id)
        OR EXISTS (SELECT 1 FROM item_uoms WHERE tenant_id = NEW.tenant_id AND barcode = code) INTO clash;
  ELSE
    SELECT EXISTS (SELECT 1 FROM items WHERE tenant_id = NEW.tenant_id AND barcode = code)
        OR EXISTS (SELECT 1 FROM item_barcodes WHERE tenant_id = NEW.tenant_id AND barcode = code)
        OR EXISTS (SELECT 1 FROM item_uoms WHERE tenant_id = NEW.tenant_id AND barcode = code AND id <> NEW.id) INTO clash;
  END IF;
  IF clash THEN
    RAISE EXCEPTION 'duplicate barcode %', code USING
      ERRCODE = 'unique_violation',
      CONSTRAINT = 'items_tenant_barcode_unique',
      DETAIL = format('Key (tenant_id, barcode)=(%s, %s) already exists.', NEW.tenant_id, code);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS items_barcode_guard_trg ON items;
--> statement-breakpoint
CREATE TRIGGER items_barcode_guard_trg BEFORE INSERT OR UPDATE OF barcode ON items
  FOR EACH ROW EXECUTE FUNCTION catalog_barcode_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS item_barcodes_guard_trg ON item_barcodes;
--> statement-breakpoint
CREATE TRIGGER item_barcodes_guard_trg BEFORE INSERT OR UPDATE OF barcode, tenant_id ON item_barcodes
  FOR EACH ROW EXECUTE FUNCTION catalog_barcode_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS item_uoms_barcode_guard_trg ON item_uoms;
--> statement-breakpoint
CREATE TRIGGER item_uoms_barcode_guard_trg BEFORE INSERT OR UPDATE OF barcode, tenant_id ON item_uoms
  FOR EACH ROW EXECUTE FUNCTION catalog_barcode_guard();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Price lists
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'LKR',
  priority integer NOT NULL DEFAULT 0,          -- higher wins
  is_active boolean NOT NULL DEFAULT true,
  valid_from date,
  valid_to date,
  applies_to varchar(20) NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'customer_group', 'customers', 'pos_profiles')),
  customer_types text[] NOT NULL DEFAULT '{}',  -- customers.customer_type values (applies_to = customer_group)
  customer_ids uuid[] NOT NULL DEFAULT '{}',
  pos_profile_ids uuid[] NOT NULL DEFAULT '{}',
  notes text,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS price_lists_tenant_name_unique ON price_lists (tenant_id, lower(name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  uom varchar(20),                              -- null = base unit
  min_qty numeric(12,3) NOT NULL DEFAULT 0,     -- tier threshold (in uom)
  price numeric(12,2),                          -- fixed unit price, or …
  discount_percent numeric(5,2),                -- … % off the item's base price
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT price_list_items_value_check CHECK (
    (price IS NOT NULL AND price >= 0) OR (discount_percent IS NOT NULL AND discount_percent >= 0 AND discount_percent <= 100))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS price_list_items_tier_unique ON price_list_items (price_list_id, item_id, coalesce(lower(uom), ''), min_qty);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_list_items_item_idx ON price_list_items (tenant_id, item_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Promotions (+ redemptions for usage limits)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(150) NOT NULL,
  description text,
  type varchar(20) NOT NULL CHECK (type IN ('percent_off', 'fixed_off', 'buy_x_get_y', 'bundle_price', 'min_spend')),
  apply_to varchar(20) NOT NULL DEFAULT 'items' CHECK (apply_to IN ('items', 'categories', 'cart')),
  discount_type varchar(10) NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent', 'fixed')), -- min_spend
  value numeric(12,2) NOT NULL DEFAULT 0,       -- % or amount (fixed_off: per unit on items, once on cart)
  item_ids uuid[] NOT NULL DEFAULT '{}',
  category_ids uuid[] NOT NULL DEFAULT '{}',
  buy_qty numeric(12,3),
  get_qty numeric(12,3),
  get_item_ids uuid[] NOT NULL DEFAULT '{}',    -- empty = same items as the buy side
  get_discount_percent numeric(5,2) NOT NULL DEFAULT 100,
  bundle_items jsonb NOT NULL DEFAULT '[]',     -- [{ itemId, qty }]
  bundle_price numeric(12,2),
  min_spend numeric(12,2),
  starts_on date,
  ends_on date,
  days_of_week smallint[] NOT NULL DEFAULT '{}', -- 0 = Sunday … 6 = Saturday; empty = every day
  time_from time,
  time_to time,                                 -- time_to < time_from → window runs past midnight
  pos_profile_ids uuid[] NOT NULL DEFAULT '{}',
  customer_types text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 0,
  stackable boolean NOT NULL DEFAULT false,
  coupon_code varchar(50),
  usage_limit integer,
  per_customer_limit integer,
  usage_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS promotions_tenant_coupon_unique ON promotions (tenant_id, upper(coupon_code)) WHERE coupon_code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS promotions_tenant_active_idx ON promotions (tenant_id, is_active);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  customer_id uuid,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  voided_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS promotion_redemptions_sale_unique ON promotion_redemptions (sale_id, promotion_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS promotion_redemptions_customer_idx ON promotion_redemptions (tenant_id, promotion_id, customer_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. What the sales route records per line / sale (see docs/INTEGRATION_PRICING.md)
-- ---------------------------------------------------------------------------
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS price_list_id uuid;
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS list_price numeric(12,2);   -- shared with 0157: catalog price of the unit sold
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS promotion_id uuid;
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS promotion_discount numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS promotions jsonb;
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS uom varchar(20);
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS uom_factor numeric(14,6) NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN IF NOT EXISTS promotion_discount numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN IF NOT EXISTS coupon_code varchar(50);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Default units for every existing tenant (new tenants are seeded on first use: src/lib/pricing/units.ts)
-- ---------------------------------------------------------------------------
INSERT INTO units (tenant_id, code, name, allow_fraction)
SELECT t.id, u.code, u.name, u.allow_fraction
FROM tenants t
CROSS JOIN (VALUES
  ('pcs', 'Pieces', false), ('kg', 'Kilogram', true), ('g', 'Gram', true), ('l', 'Litre', true),
  ('ml', 'Millilitre', true), ('box', 'Box', false), ('pack', 'Pack', false), ('dozen', 'Dozen', false)
) AS u(code, name, allow_fraction)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Tenant isolation (same policies as every tenant table, see drizzle/0152)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['units', 'item_uoms', 'item_barcodes', 'price_lists', 'price_list_items', 'promotions', 'promotion_redemptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON %I FOR ALL TO public
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON %I', t);
    EXECUTE format($p$CREATE POLICY platform_login_access ON %I FOR ALL TO public
      USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
      WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;
END $$;
