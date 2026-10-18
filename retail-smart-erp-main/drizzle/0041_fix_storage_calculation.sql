-- Migration 0040: Fix storage calculation and RLS on billing tables
--
-- Problem: subscriptions and tenant_usage have FORCE RLS, but they are
-- billing/admin tables queried cross-tenant by account management, sys-control,
-- cron jobs, and payment webhooks. app_user cannot read them without tenant context.
--
-- Fix: Disable RLS on subscriptions and tenant_usage (they are already protected
-- by application-level auth checks). Also make storage functions SECURITY DEFINER
-- and add file_storage_bytes calculation.

-- ==================== STEP 1: Remove RLS from billing tables ====================
-- These tables need cross-tenant access for admin, account, cron, and payment operations
ALTER TABLE subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON subscriptions;
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_usage;

-- ==================== STEP 2: Fix storage calculation functions ====================

-- Recreate calculate_tenant_storage_bytes with SECURITY DEFINER
CREATE OR REPLACE FUNCTION calculate_tenant_storage_bytes(p_tenant_id UUID)
RETURNS BIGINT
SECURITY DEFINER
AS $$
DECLARE
  total_bytes BIGINT := 0;
  usage_record RECORD;
BEGIN
  SELECT * INTO usage_record FROM tenant_usage WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  total_bytes := (
    (COALESCE(usage_record.users_count, 0) * 500) +
    (COALESCE(usage_record.customers_count, 0) * 400) +
    (COALESCE(usage_record.vehicles_count, 0) * 350) +
    (COALESCE(usage_record.items_count, 0) * 600) +
    (COALESCE(usage_record.categories_count, 0) * 200) +
    (COALESCE(usage_record.service_types_count, 0) * 400) +
    (COALESCE(usage_record.suppliers_count, 0) * 350) +
    (COALESCE(usage_record.sales_count, 0) * 450) +
    (COALESCE(usage_record.sale_items_count, 0) * 250) +
    (COALESCE(usage_record.work_orders_count, 0) * 800) +
    (COALESCE(usage_record.work_order_services_count, 0) * 300) +
    (COALESCE(usage_record.work_order_parts_count, 0) * 300) +
    (COALESCE(usage_record.appointments_count, 0) * 350) +
    (COALESCE(usage_record.insurance_estimates_count, 0) * 600) +
    (COALESCE(usage_record.purchases_count, 0) * 400) +
    (COALESCE(usage_record.purchase_orders_count, 0) * 400) +
    (COALESCE(usage_record.stock_transfers_count, 0) * 300)
  );

  -- Add 20% overhead for indexes and PostgreSQL internal structures
  total_bytes := (total_bytes * 1.2)::BIGINT;

  RETURN total_bytes;
END;
$$ LANGUAGE plpgsql;

-- Recreate update_tenant_storage with SECURITY DEFINER
CREATE OR REPLACE FUNCTION update_tenant_storage(p_tenant_id UUID)
RETURNS void
SECURITY DEFINER
AS $$
DECLARE
  file_bytes BIGINT := 0;
BEGIN
  -- Calculate file storage from files table
  SELECT COALESCE(SUM(file_size), 0) INTO file_bytes
  FROM files WHERE tenant_id = p_tenant_id;

  UPDATE tenant_usage
  SET
    storage_bytes = calculate_tenant_storage_bytes(p_tenant_id),
    file_storage_bytes = file_bytes,
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql;

-- Recreate update_all_tenant_storage with SECURITY DEFINER and file storage
CREATE OR REPLACE FUNCTION update_all_tenant_storage()
RETURNS TABLE (tenant_id UUID, storage_bytes BIGINT)
SECURITY DEFINER
AS $$
BEGIN
  -- First update file_storage_bytes for all tenants
  UPDATE tenant_usage tu
  SET file_storage_bytes = COALESCE(
    (SELECT SUM(f.file_size) FROM files f WHERE f.tenant_id = tu.tenant_id),
    0
  );

  -- Then update storage_bytes and return results
  RETURN QUERY
  UPDATE tenant_usage tu
  SET
    storage_bytes = calculate_tenant_storage_bytes(tu.tenant_id),
    updated_at = NOW()
  RETURNING tu.tenant_id, tu.storage_bytes;
END;
$$ LANGUAGE plpgsql;

-- Recalculate all counts from actual tables to fix any stale data
-- This runs once to correct counts that may have been missed before triggers had SECURITY DEFINER
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    -- Ensure tenant_usage row exists
    INSERT INTO tenant_usage (tenant_id)
    VALUES (t.id)
    ON CONFLICT (tenant_id) DO NOTHING;

    -- Recount from actual tables
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
      file_storage_bytes = COALESCE((SELECT SUM(file_size) FROM files WHERE tenant_id = t.id), 0),
      updated_at = NOW()
    WHERE tenant_id = t.id;
  END LOOP;
END $$;

-- Now recalculate storage_bytes for all tenants
SELECT update_all_tenant_storage();
