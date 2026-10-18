-- Migration 0096: Comprehensive storage tracking
--
-- Fixes:
-- 1. Only 18 of 182 tenant-scoped tables had storage tracking triggers
-- 2. Logo uploads/deletes not tracked in file_storage_bytes (adds logo_size column)
-- 3. Reconciliation function only covered 17 tables (now covers ALL tables dynamically)
-- 4. Item images and logos not included in file_storage_bytes reconciliation

-- ==================== STEP 1: Add logo_size column to tenants ====================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_size INTEGER;


-- ==================== STEP 2: Create storage-bytes-only trigger function ====================
-- Lightweight trigger that only adjusts storage_bytes in tenant_usage.
-- Used for tables that DON'T have dedicated _count columns in tenant_usage.
-- The existing update_tenant_usage_count() still handles the 17 tables with count columns.

CREATE OR REPLACE FUNCTION track_storage_bytes()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  target_tenant_id UUID;
  delta INTEGER;
  bytes_per_row INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_tenant_id := NEW.tenant_id;
    delta := 1;
  ELSIF TG_OP = 'DELETE' THEN
    target_tenant_id := OLD.tenant_id;
    delta := -1;
  ELSE
    RETURN NULL;
  END IF;

  IF target_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Pre-multiplied byte estimates (base × 1.2 index overhead)
  -- Grouped by size for readability
  bytes_per_row := CASE TG_TABLE_NAME

    -- Very large rows (jsonb snapshots, multiple text columns) ~600 bytes
    WHEN 'held_sales' THEN 600
    WHEN 'vehicle_inventory' THEN 600
    WHEN 'insurance_estimate_revisions' THEN 600
    WHEN 'ai_error_logs' THEN 600

    -- Large rows (jsonb or heavy text) ~480-540 bytes
    WHEN 'vehicle_imports' THEN 540
    WHEN 'recurring_journal_templates' THEN 540
    WHEN 'estimate_templates' THEN 480
    WHEN 'dealership_inspections' THEN 480
    WHEN 'journal_entries' THEN 480
    WHEN 'payment_entries' THEN 480
    WHEN 'restaurant_orders' THEN 480
    WHEN 'layaways' THEN 480
    WHEN 'employee_profiles' THEN 480
    WHEN 'salary_slips' THEN 480
    WHEN 'sales_orders' THEN 480
    WHEN 'purchase_requisitions' THEN 480
    WHEN 'supplier_quotations' THEN 480
    WHEN 'letter_heads' THEN 480
    WHEN 'print_templates' THEN 480

    -- Medium-large rows (text columns) ~360-420 bytes
    WHEN 'chart_of_accounts' THEN 360
    WHEN 'bank_accounts' THEN 360
    WHEN 'bank_transactions' THEN 360
    WHEN 'payments' THEN 360
    WHEN 'refunds' THEN 360
    WHEN 'pos_closing_entries' THEN 420
    WHEN 'purchase_receipts' THEN 420
    WHEN 'ai_chat_messages' THEN 420
    WHEN 'workspace_configs' THEN 420
    WHEN 'dunning_types' THEN 420
    WHEN 'notification_templates' THEN 360
    WHEN 'notification_logs' THEN 360
    WHEN 'activity_logs' THEN 360
    WHEN 'stock_takes' THEN 360
    WHEN 'reservations' THEN 360
    WHEN 'vehicle_sale_details' THEN 420
    WHEN 'core_returns' THEN 360
    WHEN 'recipes' THEN 360
    WHEN 'pos_shifts' THEN 360
    WHEN 'payroll_runs' THEN 360
    WHEN 'saved_reports' THEN 420
    WHEN 'gift_cards' THEN 360
    WHEN 'test_drives' THEN 360
    WHEN 'trade_in_vehicles' THEN 360
    WHEN 'financing_options' THEN 360
    WHEN 'vehicle_warranties' THEN 360
    WHEN 'dealers' THEN 360
    WHEN 'vehicle_inspections' THEN 360

    -- Small rows (junction/reference tables) ~120-180 bytes
    WHEN 'user_warehouses' THEN 120
    WHEN 'pos_profile_payment_methods' THEN 120
    WHEN 'pos_profile_users' THEN 120
    WHEN 'pos_profile_item_groups' THEN 120
    WHEN 'table_group_members' THEN 120
    WHEN 'modifier_group_items' THEN 120
    WHEN 'collection_files' THEN 120
    WHEN 'staff_chat_participants' THEN 120
    WHEN 'part_compatibility' THEN 180
    WHEN 'advance_recovery_records' THEN 180
    WHEN 'module_access' THEN 180
    WHEN 'notification_usage' THEN 180
    WHEN 'pos_opening_balances' THEN 180

    -- Default for medium rows (~300 bytes, covers most tables)
    ELSE 300
  END;

  IF bytes_per_row = 0 THEN
    RETURN NULL;
  END IF;

  -- Ensure tenant_usage row exists
  INSERT INTO tenant_usage (tenant_id)
  VALUES (target_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Atomically adjust storage_bytes
  UPDATE tenant_usage
  SET storage_bytes = GREATEST(0, storage_bytes + delta * bytes_per_row),
      updated_at = NOW()
  WHERE tenant_id = target_tenant_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- ==================== STEP 3: Add triggers to all untracked tenant-scoped tables ====================
-- Dynamically finds all tables with tenant_id that don't already have a storage trigger

DO $$
DECLARE
  tbl_name TEXT;
  -- Tables already tracked by update_tenant_usage_count() (have _count columns + storage_bytes)
  already_tracked TEXT[] := ARRAY[
    'users', 'customers', 'vehicles', 'items', 'categories',
    'service_types', 'suppliers', 'sales', 'sale_items',
    'work_orders', 'work_order_services', 'work_order_parts',
    'appointments', 'insurance_estimates', 'purchases',
    'purchase_orders', 'stock_transfers',
    'files'  -- Has its own file_storage_bytes trigger
  ];
BEGIN
  FOR tbl_name IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name != ALL(already_tracked)
    ORDER BY c.table_name
  LOOP
    -- Drop existing trigger if any, then create new one
    EXECUTE format('DROP TRIGGER IF EXISTS track_storage ON %I', tbl_name);
    EXECUTE format(
      'CREATE TRIGGER track_storage AFTER INSERT OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION track_storage_bytes()',
      tbl_name
    );
    RAISE NOTICE 'Added storage trigger to: %', tbl_name;
  END LOOP;
END $$;


-- ==================== STEP 4: Update reconciliation functions ====================
-- Make calculate_tenant_storage_bytes() comprehensive by dynamically counting ALL tables

CREATE OR REPLACE FUNCTION calculate_tenant_storage_bytes(p_tenant_id UUID)
RETURNS BIGINT
SECURITY DEFINER
AS $$
DECLARE
  total_bytes BIGINT := 0;
  tbl RECORD;
  row_count BIGINT;
  bytes_per_row INTEGER;
BEGIN
  -- Loop through ALL tables with tenant_id column
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    -- Count rows for this tenant in this table
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id = $1', tbl.table_name)
    INTO row_count USING p_tenant_id;

    -- Base byte estimates per row (before index overhead)
    bytes_per_row := CASE tbl.table_name

      -- Very large rows (jsonb snapshots, multiple text)
      WHEN 'held_sales' THEN 500
      WHEN 'vehicle_inventory' THEN 500
      WHEN 'insurance_estimate_revisions' THEN 500
      WHEN 'ai_error_logs' THEN 500
      WHEN 'vehicle_imports' THEN 450
      WHEN 'recurring_journal_templates' THEN 450

      -- Large rows (text/jsonb columns)
      WHEN 'work_orders' THEN 800
      WHEN 'insurance_estimates' THEN 600
      WHEN 'items' THEN 600
      WHEN 'estimate_templates' THEN 400
      WHEN 'dealership_inspections' THEN 400
      WHEN 'journal_entries' THEN 400
      WHEN 'payment_entries' THEN 400
      WHEN 'restaurant_orders' THEN 400
      WHEN 'layaways' THEN 400
      WHEN 'employee_profiles' THEN 400
      WHEN 'salary_slips' THEN 400
      WHEN 'sales_orders' THEN 400
      WHEN 'purchase_requisitions' THEN 400
      WHEN 'supplier_quotations' THEN 400
      WHEN 'letter_heads' THEN 400
      WHEN 'print_templates' THEN 400

      -- Medium-large rows
      WHEN 'users' THEN 500
      WHEN 'customers' THEN 400
      WHEN 'vehicles' THEN 350
      WHEN 'sales' THEN 450
      WHEN 'service_types' THEN 400
      WHEN 'suppliers' THEN 350
      WHEN 'purchases' THEN 400
      WHEN 'purchase_orders' THEN 400
      WHEN 'appointments' THEN 350

      -- Medium rows (most standard tables)
      WHEN 'chart_of_accounts' THEN 300
      WHEN 'bank_accounts' THEN 300
      WHEN 'bank_transactions' THEN 300
      WHEN 'payments' THEN 300
      WHEN 'refunds' THEN 300
      WHEN 'stock_transfers' THEN 300
      WHEN 'pos_closing_entries' THEN 350
      WHEN 'purchase_receipts' THEN 350
      WHEN 'ai_chat_messages' THEN 350
      WHEN 'workspace_configs' THEN 350
      WHEN 'notification_templates' THEN 300
      WHEN 'notification_logs' THEN 300
      WHEN 'activity_logs' THEN 300
      WHEN 'stock_takes' THEN 300
      WHEN 'reservations' THEN 300
      WHEN 'recipes' THEN 300
      WHEN 'pos_shifts' THEN 300
      WHEN 'payroll_runs' THEN 300
      WHEN 'gift_cards' THEN 300
      WHEN 'test_drives' THEN 300

      -- Standard rows
      WHEN 'sale_items' THEN 250
      WHEN 'work_order_services' THEN 300
      WHEN 'work_order_parts' THEN 300
      WHEN 'gl_entries' THEN 250
      WHEN 'journal_entry_items' THEN 250
      WHEN 'warehouse_stock' THEN 200
      WHEN 'serial_number_movements' THEN 200
      WHEN 'item_serial_numbers' THEN 250
      WHEN 'restaurant_order_items' THEN 250
      WHEN 'kitchen_orders' THEN 250
      WHEN 'kitchen_order_items' THEN 200
      WHEN 'salary_slip_components' THEN 200
      WHEN 'purchase_items' THEN 250
      WHEN 'purchase_order_items' THEN 250
      WHEN 'stock_transfer_items' THEN 200
      WHEN 'stock_take_items' THEN 200
      WHEN 'layaway_items' THEN 250
      WHEN 'layaway_payments' THEN 200
      WHEN 'gift_card_transactions' THEN 200
      WHEN 'loyalty_transactions' THEN 200
      WHEN 'commissions' THEN 250
      WHEN 'categories' THEN 200
      WHEN 'files' THEN 300
      WHEN 'stock_movements' THEN 250

      -- Small rows (junction/reference tables)
      WHEN 'user_warehouses' THEN 100
      WHEN 'pos_profile_payment_methods' THEN 100
      WHEN 'pos_profile_users' THEN 100
      WHEN 'pos_profile_item_groups' THEN 100
      WHEN 'table_group_members' THEN 100
      WHEN 'modifier_group_items' THEN 100
      WHEN 'collection_files' THEN 100
      WHEN 'staff_chat_participants' THEN 100
      WHEN 'part_compatibility' THEN 150
      WHEN 'advance_recovery_records' THEN 150
      WHEN 'module_access' THEN 150
      WHEN 'notification_usage' THEN 150
      WHEN 'pos_opening_balances' THEN 150
      WHEN 'payment_allocations' THEN 200

      -- Default for unmatched tables
      ELSE 250
    END;

    total_bytes := total_bytes + (row_count * bytes_per_row);
  END LOOP;

  -- Add 20% overhead for indexes and PostgreSQL internal structures
  total_bytes := (total_bytes * 1.2)::BIGINT;

  RETURN total_bytes;
END;
$$ LANGUAGE plpgsql;


-- ==================== STEP 5: Update file storage reconciliation ====================
-- Include item images and logos in file_storage_bytes (they bypass the files table)

CREATE OR REPLACE FUNCTION update_tenant_storage(p_tenant_id UUID)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
  file_bytes BIGINT := 0;
BEGIN
  -- Calculate file storage from:
  -- 1. files table (main file storage)
  -- 2. items.image_size (item images stored directly in R2)
  -- 3. tenants.logo_size (logos stored directly in R2)
  SELECT
    COALESCE((SELECT SUM(file_size) FROM files WHERE tenant_id = p_tenant_id), 0) +
    COALESCE((SELECT SUM(image_size) FROM items WHERE tenant_id = p_tenant_id), 0) +
    COALESCE((SELECT logo_size FROM tenants WHERE id = p_tenant_id), 0)
  INTO file_bytes;

  UPDATE tenant_usage
  SET
    storage_bytes = calculate_tenant_storage_bytes(p_tenant_id),
    file_storage_bytes = file_bytes,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION update_all_tenant_storage()
RETURNS TABLE (tenant_id UUID, storage_bytes BIGINT)
SECURITY DEFINER
AS $$
BEGIN
  -- Update file_storage_bytes for all tenants (files + item images + logos)
  UPDATE tenant_usage tu
  SET file_storage_bytes = (
    COALESCE((SELECT SUM(f.file_size) FROM files f WHERE f.tenant_id = tu.tenant_id), 0) +
    COALESCE((SELECT SUM(i.image_size) FROM items i WHERE i.tenant_id = tu.tenant_id), 0) +
    COALESCE((SELECT t.logo_size FROM tenants t WHERE t.id = tu.tenant_id), 0)
  );

  -- Recalculate storage_bytes from ALL tables and return results
  RETURN QUERY
  UPDATE tenant_usage tu
  SET
    storage_bytes = calculate_tenant_storage_bytes(tu.tenant_id),
    updated_at = NOW()
  RETURNING tu.tenant_id, tu.storage_bytes;
END;
$$ LANGUAGE plpgsql;


-- ==================== STEP 6: Also update the count-recount block ====================
-- Recount tracked table counts + recalculate everything

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    -- Ensure tenant_usage row exists
    INSERT INTO tenant_usage (tenant_id)
    VALUES (t.id)
    ON CONFLICT (tenant_id) DO NOTHING;

    -- Recount from actual tables (for the 17 tables with count columns)
    UPDATE tenant_usage SET
      users_count = (SELECT COUNT(*) FROM users WHERE tenant_id = t.id),
      customers_count = (SELECT COUNT(*) FROM customers WHERE tenant_id = t.id),
      vehicles_count = (SELECT COUNT(*) FROM vehicles WHERE tenant_id = t.id),
      items_count = (SELECT COUNT(*) FROM items WHERE tenant_id = t.id),
      categories_count = (SELECT COUNT(*) FROM categories WHERE tenant_id = t.id),
      service_types_count = (SELECT COUNT(*) FROM service_types WHERE tenant_id = t.id),
      suppliers_count = (SELECT COUNT(*) FROM suppliers WHERE tenant_id = t.id),
      sales_count = (SELECT COUNT(*) FROM sales WHERE tenant_id = t.id),
      sale_items_count = (SELECT COUNT(*) FROM sale_items WHERE tenant_id = t.id),
      work_orders_count = (SELECT COUNT(*) FROM work_orders WHERE tenant_id = t.id),
      work_order_services_count = (SELECT COUNT(*) FROM work_order_services WHERE tenant_id = t.id),
      work_order_parts_count = (SELECT COUNT(*) FROM work_order_parts WHERE tenant_id = t.id),
      appointments_count = (SELECT COUNT(*) FROM appointments WHERE tenant_id = t.id),
      insurance_estimates_count = (SELECT COUNT(*) FROM insurance_estimates WHERE tenant_id = t.id),
      purchases_count = (SELECT COUNT(*) FROM purchases WHERE tenant_id = t.id),
      purchase_orders_count = (SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = t.id),
      stock_transfers_count = (SELECT COUNT(*) FROM stock_transfers WHERE tenant_id = t.id),
      updated_at = NOW()
    WHERE tenant_id = t.id;
  END LOOP;
END $$;

-- Recalculate all storage values (DB + file) for all tenants
SELECT update_all_tenant_storage();
