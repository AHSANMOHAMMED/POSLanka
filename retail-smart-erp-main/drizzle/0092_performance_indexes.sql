-- Performance indexes for frequently queried columns
-- These indexes cover the most common query patterns across all list pages
-- Uses safe conditional creation to handle tables that may not exist in all environments

DO $$
DECLARE
  tbl TEXT;
BEGIN
  -- Helper: only create index if the table exists
  -- Sales: customer lookup, status filtering, date sorting
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_tenant_status_created ON sales(tenant_id, status, created_at)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_tenant_customer ON sales(tenant_id, customer_id, created_at)';
  END IF;

  -- Work Orders: customer lookup, status filtering
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'work_orders' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_work_orders_customer_id ON work_orders(customer_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_status ON work_orders(tenant_id, status, created_at)';
  END IF;

  -- Restaurant Orders: kitchen display, status filtering
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'restaurant_orders' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_restaurant_orders_status ON restaurant_orders(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_restaurant_orders_tenant_status ON restaurant_orders(tenant_id, status, created_at)';
  END IF;

  -- Purchase Orders: purchasing workflow
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_orders' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_status ON purchase_orders(tenant_id, status, created_at)';
  END IF;

  -- Sales Orders: sales fulfillment
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_orders' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sales_orders_tenant_status ON sales_orders(tenant_id, status, created_at)';
  END IF;

  -- Items: active filtering (uses is_active, not status)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_items_is_active ON items(is_active)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_items_tenant_active ON items(tenant_id, is_active)';
  END IF;

  -- Customers: tenant lookup
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id)';
  END IF;

  -- Suppliers: active/inactive filtering (uses is_active, not status)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suppliers' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active)';
  END IF;

  -- Activity Logs: audit trails
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant_created ON activity_logs(tenant_id, created_at)';
  END IF;

  -- Journal Entries: accounting workflows
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_status ON journal_entries(tenant_id, status)';
  END IF;

  -- Serial Numbers: fulfillment tracking
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'item_serial_numbers' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_serial_numbers_status ON item_serial_numbers(status)';
  END IF;

  -- Item Batches: inventory allocation
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'item_batches' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_item_batches_status ON item_batches(status)';
  END IF;

  -- Stock Takes: inventory reconciliation
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_takes' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stock_takes_status ON stock_takes(status)';
  END IF;

  -- Appointments: scheduling
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'appointments' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date ON appointments(tenant_id, scheduled_date)';
  END IF;

  -- Vehicles: customer vehicle lookup
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicles' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON vehicles(customer_id)';
  END IF;

  -- Purchases: status and supplier filtering
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchases' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchases_tenant_status ON purchases(tenant_id, status, created_at)';
  END IF;

  -- Layaways: payment tracking
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'layaways' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_layaways_status ON layaways(status)';
  END IF;

  -- Gift Cards: redemption filtering
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gift_cards' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status)';
  END IF;

  -- Payment Entries: accounting
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_entries' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payment_entries_status ON payment_entries(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payment_entries_tenant_status ON payment_entries(tenant_id, status)';
  END IF;

  -- Insurance Estimates: workflow
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'insurance_estimates' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_insurance_estimates_status ON insurance_estimates(status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_insurance_estimates_tenant_status ON insurance_estimates(tenant_id, status, created_at)';
  END IF;

  -- Stock Transfers: inventory workflow
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_transfers' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status)';
  END IF;

END $$;
