-- Performance Indexes for Retail Smart POS
-- Run this file to dramatically improve query performance
-- Execute with: psql -d your_database -f add-indexes.sql
-- Or run each command in Drizzle Studio SQL tab

-- =====================================================
-- ITEMS TABLE INDEXES
-- =====================================================

-- Primary lookup index - most queries filter by tenant
CREATE INDEX IF NOT EXISTS idx_items_tenant_id ON items(tenant_id);

-- Composite index for tenant + active items (common query)
CREATE INDEX IF NOT EXISTS idx_items_tenant_active ON items(tenant_id, is_active);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id);

-- Index for SKU/barcode lookups
CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode) WHERE barcode IS NOT NULL;

-- Index for name search (using gin for text search)
CREATE INDEX IF NOT EXISTS idx_items_name ON items(tenant_id, name);

-- =====================================================
-- CUSTOMERS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(tenant_id, name);

-- =====================================================
-- WORK ORDERS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_id ON work_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_created ON work_orders(tenant_id, created_at DESC);

-- =====================================================
-- WORK ORDER PARTS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_work_order_parts_tenant ON work_order_parts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_order_parts_work_order ON work_order_parts(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_parts_item ON work_order_parts(item_id);

-- =====================================================
-- WORK ORDER SERVICES TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_work_order_services_work_order ON work_order_services(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_services_service_type ON work_order_services(service_type_id);

-- =====================================================
-- APPOINTMENTS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_id ON appointments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id);

-- =====================================================
-- VEHICLES TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_license ON vehicles(tenant_id, license_plate) WHERE license_plate IS NOT NULL;

-- =====================================================
-- SALES TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_sales_tenant_id ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(tenant_id, status);

-- =====================================================
-- SALE ITEMS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_item ON sale_items(item_id);

-- =====================================================
-- CATEGORIES TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON categories(tenant_id);

-- =====================================================
-- SERVICE TYPES TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_service_types_tenant_id ON service_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_types_active ON service_types(tenant_id, is_active);

-- =====================================================
-- HELD SALES TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_held_sales_tenant_id ON held_sales(tenant_id);

-- =====================================================
-- INSURANCE ESTIMATES TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_insurance_estimates_tenant ON insurance_estimates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_insurance_estimates_status ON insurance_estimates(tenant_id, status);

-- =====================================================
-- INSURANCE ESTIMATE ITEMS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_insurance_estimate_items_estimate ON insurance_estimate_items(estimate_id);
CREATE INDEX IF NOT EXISTS idx_insurance_estimate_items_item ON insurance_estimate_items(item_id) WHERE item_id IS NOT NULL;

-- =====================================================
-- ITEM BUNDLE COMPONENTS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_item_bundle_components_bundle ON item_bundle_components(bundle_item_id);
CREATE INDEX IF NOT EXISTS idx_item_bundle_components_component ON item_bundle_components(component_item_id);

-- =====================================================
-- USERS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(tenant_id, email);

-- =====================================================
-- ACTIVITY LOGS TABLE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant ON activity_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(tenant_id, created_at DESC);

-- =====================================================
-- VERIFY INDEXES CREATED
-- =====================================================

-- Run this to see all indexes:
-- SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;

SELECT 'Indexes created successfully!' as result;
