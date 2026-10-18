-- Migration: Tenant Usage Tracking with Triggers
-- Automatically tracks row counts per tenant for billing/limits
-- Zero application code changes required

-- ==================== STEP 1: Create Usage Table ====================

CREATE TABLE IF NOT EXISTS tenant_usage (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- Core counts
  users_count INTEGER NOT NULL DEFAULT 0,
  customers_count INTEGER NOT NULL DEFAULT 0,
  vehicles_count INTEGER NOT NULL DEFAULT 0,

  -- Inventory counts
  items_count INTEGER NOT NULL DEFAULT 0,
  categories_count INTEGER NOT NULL DEFAULT 0,
  service_types_count INTEGER NOT NULL DEFAULT 0,
  suppliers_count INTEGER NOT NULL DEFAULT 0,

  -- Transaction counts
  sales_count INTEGER NOT NULL DEFAULT 0,
  sale_items_count INTEGER NOT NULL DEFAULT 0,
  work_orders_count INTEGER NOT NULL DEFAULT 0,
  work_order_services_count INTEGER NOT NULL DEFAULT 0,
  work_order_parts_count INTEGER NOT NULL DEFAULT 0,
  appointments_count INTEGER NOT NULL DEFAULT 0,

  -- Document counts
  insurance_estimates_count INTEGER NOT NULL DEFAULT 0,
  purchases_count INTEGER NOT NULL DEFAULT 0,
  purchase_orders_count INTEGER NOT NULL DEFAULT 0,
  stock_transfers_count INTEGER NOT NULL DEFAULT 0,

  -- Storage tracking (updated separately, in bytes)
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  file_storage_bytes BIGINT NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_tenant_usage_updated_at ON tenant_usage(updated_at);

-- ==================== STEP 2: Create Trigger Function ====================

-- Generic trigger function that handles any tracked table
CREATE OR REPLACE FUNCTION update_tenant_usage_count()
RETURNS TRIGGER AS $$
DECLARE
  column_name TEXT;
  delta INTEGER;
  target_tenant_id UUID;
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

  -- Ensure tenant_usage row exists (upsert pattern)
  INSERT INTO tenant_usage (tenant_id)
  VALUES (target_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  -- Update the count
  EXECUTE format(
    'UPDATE tenant_usage SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE tenant_id = $2',
    column_name, column_name
  ) USING delta, target_tenant_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ==================== STEP 3: Create Triggers for Each Table ====================

-- Core tables
CREATE TRIGGER track_users_usage
AFTER INSERT OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_customers_usage
AFTER INSERT OR DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_vehicles_usage
AFTER INSERT OR DELETE ON vehicles
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

-- Inventory tables
CREATE TRIGGER track_items_usage
AFTER INSERT OR DELETE ON items
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_categories_usage
AFTER INSERT OR DELETE ON categories
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_service_types_usage
AFTER INSERT OR DELETE ON service_types
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_suppliers_usage
AFTER INSERT OR DELETE ON suppliers
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

-- Transaction tables
CREATE TRIGGER track_sales_usage
AFTER INSERT OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_sale_items_usage
AFTER INSERT OR DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_work_orders_usage
AFTER INSERT OR DELETE ON work_orders
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_work_order_services_usage
AFTER INSERT OR DELETE ON work_order_services
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_work_order_parts_usage
AFTER INSERT OR DELETE ON work_order_parts
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_appointments_usage
AFTER INSERT OR DELETE ON appointments
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

-- Document tables
CREATE TRIGGER track_insurance_estimates_usage
AFTER INSERT OR DELETE ON insurance_estimates
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_purchases_usage
AFTER INSERT OR DELETE ON purchases
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_purchase_orders_usage
AFTER INSERT OR DELETE ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

CREATE TRIGGER track_stock_transfers_usage
AFTER INSERT OR DELETE ON stock_transfers
FOR EACH ROW EXECUTE FUNCTION update_tenant_usage_count();

-- ==================== STEP 4: Initialize Existing Tenant Counts ====================

-- Create usage rows for all existing tenants
INSERT INTO tenant_usage (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- Update counts for existing data
UPDATE tenant_usage tu SET
  users_count = COALESCE((SELECT COUNT(*) FROM users WHERE tenant_id = tu.tenant_id), 0),
  customers_count = COALESCE((SELECT COUNT(*) FROM customers WHERE tenant_id = tu.tenant_id), 0),
  vehicles_count = COALESCE((SELECT COUNT(*) FROM vehicles WHERE tenant_id = tu.tenant_id), 0),
  items_count = COALESCE((SELECT COUNT(*) FROM items WHERE tenant_id = tu.tenant_id), 0),
  categories_count = COALESCE((SELECT COUNT(*) FROM categories WHERE tenant_id = tu.tenant_id), 0),
  service_types_count = COALESCE((SELECT COUNT(*) FROM service_types WHERE tenant_id = tu.tenant_id), 0),
  suppliers_count = COALESCE((SELECT COUNT(*) FROM suppliers WHERE tenant_id = tu.tenant_id), 0),
  sales_count = COALESCE((SELECT COUNT(*) FROM sales WHERE tenant_id = tu.tenant_id), 0),
  sale_items_count = COALESCE((SELECT COUNT(*) FROM sale_items WHERE tenant_id = tu.tenant_id), 0),
  work_orders_count = COALESCE((SELECT COUNT(*) FROM work_orders WHERE tenant_id = tu.tenant_id), 0),
  work_order_services_count = COALESCE((SELECT COUNT(*) FROM work_order_services WHERE tenant_id = tu.tenant_id), 0),
  work_order_parts_count = COALESCE((SELECT COUNT(*) FROM work_order_parts WHERE tenant_id = tu.tenant_id), 0),
  appointments_count = COALESCE((SELECT COUNT(*) FROM appointments WHERE tenant_id = tu.tenant_id), 0),
  insurance_estimates_count = COALESCE((SELECT COUNT(*) FROM insurance_estimates WHERE tenant_id = tu.tenant_id), 0),
  purchases_count = COALESCE((SELECT COUNT(*) FROM purchases WHERE tenant_id = tu.tenant_id), 0),
  purchase_orders_count = COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = tu.tenant_id), 0),
  stock_transfers_count = COALESCE((SELECT COUNT(*) FROM stock_transfers WHERE tenant_id = tu.tenant_id), 0),
  updated_at = NOW();

-- ==================== STEP 5: Helper Functions ====================

-- Function to manually recalculate a tenant's usage (for admin use)
CREATE OR REPLACE FUNCTION recalculate_tenant_usage(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE tenant_usage SET
    users_count = COALESCE((SELECT COUNT(*) FROM users WHERE tenant_id = p_tenant_id), 0),
    customers_count = COALESCE((SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id), 0),
    vehicles_count = COALESCE((SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id), 0),
    items_count = COALESCE((SELECT COUNT(*) FROM items WHERE tenant_id = p_tenant_id), 0),
    categories_count = COALESCE((SELECT COUNT(*) FROM categories WHERE tenant_id = p_tenant_id), 0),
    service_types_count = COALESCE((SELECT COUNT(*) FROM service_types WHERE tenant_id = p_tenant_id), 0),
    suppliers_count = COALESCE((SELECT COUNT(*) FROM suppliers WHERE tenant_id = p_tenant_id), 0),
    sales_count = COALESCE((SELECT COUNT(*) FROM sales WHERE tenant_id = p_tenant_id), 0),
    sale_items_count = COALESCE((SELECT COUNT(*) FROM sale_items WHERE tenant_id = p_tenant_id), 0),
    work_orders_count = COALESCE((SELECT COUNT(*) FROM work_orders WHERE tenant_id = p_tenant_id), 0),
    work_order_services_count = COALESCE((SELECT COUNT(*) FROM work_order_services WHERE tenant_id = p_tenant_id), 0),
    work_order_parts_count = COALESCE((SELECT COUNT(*) FROM work_order_parts WHERE tenant_id = p_tenant_id), 0),
    appointments_count = COALESCE((SELECT COUNT(*) FROM appointments WHERE tenant_id = p_tenant_id), 0),
    insurance_estimates_count = COALESCE((SELECT COUNT(*) FROM insurance_estimates WHERE tenant_id = p_tenant_id), 0),
    purchases_count = COALESCE((SELECT COUNT(*) FROM purchases WHERE tenant_id = p_tenant_id), 0),
    purchase_orders_count = COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE tenant_id = p_tenant_id), 0),
    stock_transfers_count = COALESCE((SELECT COUNT(*) FROM stock_transfers WHERE tenant_id = p_tenant_id), 0),
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get usage summary for a tenant
CREATE OR REPLACE FUNCTION get_tenant_usage_summary(p_tenant_id UUID)
RETURNS TABLE (
  entity_type TEXT,
  count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 'users'::TEXT, users_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'customers', customers_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'vehicles', vehicles_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'items', items_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'categories', categories_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'service_types', service_types_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'suppliers', suppliers_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'sales', sales_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'sale_items', sale_items_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'work_orders', work_orders_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'work_order_services', work_order_services_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'work_order_parts', work_order_parts_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'appointments', appointments_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'insurance_estimates', insurance_estimates_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'purchases', purchases_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'purchase_orders', purchase_orders_count FROM tenant_usage WHERE tenant_id = p_tenant_id
  UNION ALL
  SELECT 'stock_transfers', stock_transfers_count FROM tenant_usage WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql;

-- ==================== STEP 6: Auto-create usage row for new tenants ====================

CREATE OR REPLACE FUNCTION create_tenant_usage_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO tenant_usage (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_create_tenant_usage
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION create_tenant_usage_on_insert();

-- ==================== STEP 7: Database Size Calculation ====================
-- Calculates estimated database size per tenant based on row counts
-- Uses average row sizes per table (estimated from typical data)

CREATE OR REPLACE FUNCTION calculate_tenant_storage_bytes(p_tenant_id UUID)
RETURNS BIGINT AS $$
DECLARE
  total_bytes BIGINT := 0;
  usage_record RECORD;
BEGIN
  -- Get the usage counts for this tenant
  SELECT * INTO usage_record FROM tenant_usage WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Calculate estimated bytes using average row sizes per table
  -- These estimates are based on typical PostgreSQL row overhead + column data
  total_bytes := (
    -- Core tables (larger rows with more columns)
    (COALESCE(usage_record.users_count, 0) * 500) +           -- ~500 bytes per user
    (COALESCE(usage_record.customers_count, 0) * 400) +       -- ~400 bytes per customer
    (COALESCE(usage_record.vehicles_count, 0) * 350) +        -- ~350 bytes per vehicle

    -- Inventory tables
    (COALESCE(usage_record.items_count, 0) * 600) +           -- ~600 bytes per item (lots of fields)
    (COALESCE(usage_record.categories_count, 0) * 200) +      -- ~200 bytes per category
    (COALESCE(usage_record.service_types_count, 0) * 400) +   -- ~400 bytes per service type
    (COALESCE(usage_record.suppliers_count, 0) * 350) +       -- ~350 bytes per supplier

    -- Transaction tables (high volume)
    (COALESCE(usage_record.sales_count, 0) * 450) +           -- ~450 bytes per sale
    (COALESCE(usage_record.sale_items_count, 0) * 250) +      -- ~250 bytes per sale item
    (COALESCE(usage_record.work_orders_count, 0) * 800) +     -- ~800 bytes per work order (many fields)
    (COALESCE(usage_record.work_order_services_count, 0) * 300) + -- ~300 bytes per service
    (COALESCE(usage_record.work_order_parts_count, 0) * 300) +    -- ~300 bytes per part
    (COALESCE(usage_record.appointments_count, 0) * 350) +    -- ~350 bytes per appointment

    -- Document tables
    (COALESCE(usage_record.insurance_estimates_count, 0) * 600) + -- ~600 bytes per estimate
    (COALESCE(usage_record.purchases_count, 0) * 400) +       -- ~400 bytes per purchase
    (COALESCE(usage_record.purchase_orders_count, 0) * 400) + -- ~400 bytes per PO
    (COALESCE(usage_record.stock_transfers_count, 0) * 300)   -- ~300 bytes per transfer
  );

  -- Add 20% overhead for indexes and PostgreSQL internal structures
  total_bytes := (total_bytes * 1.2)::BIGINT;

  RETURN total_bytes;
END;
$$ LANGUAGE plpgsql;

-- Function to update storage_bytes for a single tenant
CREATE OR REPLACE FUNCTION update_tenant_storage(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE tenant_usage
  SET
    storage_bytes = calculate_tenant_storage_bytes(p_tenant_id),
    updated_at = NOW()
  WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update storage_bytes for ALL tenants (daily job)
CREATE OR REPLACE FUNCTION update_all_tenant_storage()
RETURNS TABLE (tenant_id UUID, storage_bytes BIGINT) AS $$
BEGIN
  RETURN QUERY
  UPDATE tenant_usage tu
  SET
    storage_bytes = calculate_tenant_storage_bytes(tu.tenant_id),
    updated_at = NOW()
  RETURNING tu.tenant_id, tu.storage_bytes;
END;
$$ LANGUAGE plpgsql;

-- Initialize storage_bytes for existing tenants
SELECT update_all_tenant_storage();
