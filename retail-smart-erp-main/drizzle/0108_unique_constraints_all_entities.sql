-- Enforce unique constraints on all importable entities per tenant
-- Uses partial unique indexes (WHERE ... IS NOT NULL AND ... != '')

-- Step 1: Deduplicate categories — reassign items to the earliest category, then delete duplicates
WITH dup_categories AS (
  SELECT tenant_id, name,
    (array_agg(id ORDER BY created_at))[1] AS keep_id,
    array_remove(array_agg(id ORDER BY created_at), (array_agg(id ORDER BY created_at))[1]) AS remove_ids
  FROM categories
  WHERE name IS NOT NULL AND name != ''
  GROUP BY tenant_id, name
  HAVING COUNT(*) > 1
)
UPDATE items SET category_id = dc.keep_id
FROM dup_categories dc
WHERE items.category_id = ANY(dc.remove_ids);

WITH dup_categories AS (
  SELECT tenant_id, name,
    (array_agg(id ORDER BY created_at))[1] AS keep_id,
    array_remove(array_agg(id ORDER BY created_at), (array_agg(id ORDER BY created_at))[1]) AS remove_ids
  FROM categories
  WHERE name IS NOT NULL AND name != ''
  GROUP BY tenant_id, name
  HAVING COUNT(*) > 1
)
DELETE FROM categories WHERE id IN (SELECT unnest(remove_ids) FROM dup_categories);

-- Step 2: Add unique constraints

-- Categories: unique name per tenant
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_name_unique
  ON categories (tenant_id, name)
  WHERE name IS NOT NULL AND name != '';

-- Customers: unique email and phone per tenant
CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_email_unique
  ON customers (tenant_id, email)
  WHERE email IS NOT NULL AND email != '';

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_phone_unique
  ON customers (tenant_id, phone)
  WHERE phone IS NOT NULL AND phone != '';

-- Suppliers: unique name per tenant
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_name_unique
  ON suppliers (tenant_id, name)
  WHERE name IS NOT NULL AND name != '';

-- Vehicles: unique VIN and license plate per tenant
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_tenant_vin_unique
  ON vehicles (tenant_id, vin)
  WHERE vin IS NOT NULL AND vin != '';

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_tenant_license_plate_unique
  ON vehicles (tenant_id, license_plate)
  WHERE license_plate IS NOT NULL AND license_plate != '';

-- Service types: unique name per tenant
CREATE UNIQUE INDEX IF NOT EXISTS service_types_tenant_name_unique
  ON service_types (tenant_id, name)
  WHERE name IS NOT NULL AND name != '';
