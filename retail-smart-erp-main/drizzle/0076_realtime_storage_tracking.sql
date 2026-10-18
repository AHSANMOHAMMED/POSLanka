-- Migration 0076: Real-time storage tracking
--
-- Fixes:
-- 1. file_storage_bytes not updated on upload/delete (only via daily cron)
-- 2. storage_bytes (DB estimate) only updated via daily cron
--
-- Solution: PostgreSQL triggers that update tenant_usage in real-time
-- whenever files are inserted/deleted or tracked table rows change.

-- ==================== STEP 1: File storage trigger ====================
-- Auto-updates file_storage_bytes on INSERT/DELETE to files table

CREATE OR REPLACE FUNCTION update_file_storage_bytes()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  target_tenant_id UUID;
  delta_bytes BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_tenant_id := NEW.tenant_id;
    delta_bytes := COALESCE(NEW.file_size, 0);
  ELSIF TG_OP = 'DELETE' THEN
    target_tenant_id := OLD.tenant_id;
    delta_bytes := -COALESCE(OLD.file_size, 0);
  ELSE
    RETURN NULL;
  END IF;

  IF target_tenant_id IS NULL OR delta_bytes = 0 THEN
    RETURN NULL;
  END IF;

  -- Ensure tenant_usage row exists
  INSERT INTO tenant_usage (tenant_id)
  VALUES (target_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Atomically adjust file_storage_bytes
  UPDATE tenant_usage
  SET file_storage_bytes = GREATEST(0, file_storage_bytes + delta_bytes),
      updated_at = NOW()
  WHERE tenant_id = target_tenant_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS track_file_storage ON files;

CREATE TRIGGER track_file_storage
AFTER INSERT OR DELETE ON files
FOR EACH ROW EXECUTE FUNCTION update_file_storage_bytes();


-- ==================== STEP 2: Update count trigger to also adjust storage_bytes ====================
-- Previously, update_tenant_usage_count() only updated *_count columns.
-- Now it also adjusts storage_bytes using per-table byte estimates (with 1.2x index overhead).

CREATE OR REPLACE FUNCTION update_tenant_usage_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  column_name TEXT;
  delta INTEGER;
  target_tenant_id UUID;
  bytes_per_row INTEGER;
BEGIN
  -- Build column name from table name (e.g., 'sales' -> 'sales_count')
  column_name := TG_TABLE_NAME || '_count';

  -- Determine operation and get tenant_id
  IF TG_OP = 'INSERT' THEN
    target_tenant_id := NEW.tenant_id;
    delta := 1;
  ELSIF TG_OP = 'DELETE' THEN
    target_tenant_id := OLD.tenant_id;
    delta := -1;
  ELSE
    -- UPDATE - no count change needed
    RETURN NULL;
  END IF;

  -- Skip if tenant_id is NULL (system records)
  IF target_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Estimated bytes per row (base * 1.2 index overhead, pre-calculated)
  bytes_per_row := CASE TG_TABLE_NAME
    WHEN 'users' THEN 600
    WHEN 'customers' THEN 480
    WHEN 'vehicles' THEN 420
    WHEN 'items' THEN 720
    WHEN 'categories' THEN 240
    WHEN 'service_types' THEN 480
    WHEN 'suppliers' THEN 420
    WHEN 'sales' THEN 540
    WHEN 'sale_items' THEN 300
    WHEN 'work_orders' THEN 960
    WHEN 'work_order_services' THEN 360
    WHEN 'work_order_parts' THEN 360
    WHEN 'appointments' THEN 420
    WHEN 'insurance_estimates' THEN 720
    WHEN 'purchases' THEN 480
    WHEN 'purchase_orders' THEN 480
    WHEN 'stock_transfers' THEN 360
    ELSE 400
  END;

  -- Ensure tenant_usage row exists (upsert pattern)
  INSERT INTO tenant_usage (tenant_id)
  VALUES (target_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Update count AND storage_bytes atomically in a single UPDATE
  EXECUTE format(
    'UPDATE tenant_usage SET %I = GREATEST(0, %I + $1), storage_bytes = GREATEST(0, storage_bytes + $3), updated_at = NOW() WHERE tenant_id = $2',
    column_name, column_name
  ) USING delta, target_tenant_id, delta * bytes_per_row;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- No need to recreate triggers - they already reference the function by name,
-- so the updated function definition takes effect immediately.


-- ==================== STEP 3: Recalculate current values ====================
-- Sync storage_bytes and file_storage_bytes from actual data

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    -- Ensure tenant_usage row exists
    INSERT INTO tenant_usage (tenant_id)
    VALUES (t.id)
    ON CONFLICT (tenant_id) DO NOTHING;

    -- Recalculate file_storage_bytes from actual files
    UPDATE tenant_usage SET
      file_storage_bytes = COALESCE(
        (SELECT SUM(file_size) FROM files WHERE tenant_id = t.id),
        0
      )
    WHERE tenant_id = t.id;
  END LOOP;
END $$;

-- Recalculate storage_bytes for all tenants using the existing function
SELECT update_all_tenant_storage();
