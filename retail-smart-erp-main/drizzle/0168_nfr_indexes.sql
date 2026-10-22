-- Non-functional hardening (2026-10): indexes for hot list/report paths and retention.
-- Most come from the old add-indexes.sql, which scripts/migrate.mjs never applied.
-- CREATE INDEX CONCURRENTLY so a deploy never blocks writes on large tables: scripts/migrate.mjs
-- runs every statement on its own in autocommit mode (no surrounding transaction), which
-- CONCURRENTLY requires. (drizzle-kit migrate wraps files in a transaction — use npm run db:migrate.)
-- An interrupted CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS would skip, so
-- each index is preceded by a statement that drops an invalid leftover of the same name.
-- Idempotent.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_payments_sale_id' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_payments_sale_id';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_sale_id ON payments (sale_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_payments_tenant_created' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_payments_tenant_created';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tenant_created ON payments (tenant_id, created_at DESC);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_sales_tenant_created' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_sales_tenant_created';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_tenant_created ON sales (tenant_id, created_at DESC);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_sale_items_item' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_sale_items_item';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_items_item ON sale_items (item_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_sale_items_tenant_item' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_sale_items_tenant_item';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_items_tenant_item ON sale_items (tenant_id, item_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_items_category_id' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_items_category_id';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_category_id ON items (category_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_items_tenant_name' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_items_tenant_name';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_tenant_name ON items (tenant_id, name);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_customers_tenant_name' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_customers_tenant_name';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_tenant_name ON customers (tenant_id, name);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_work_orders_vehicle' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_work_orders_vehicle';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_orders_vehicle ON work_orders (vehicle_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_work_orders_tenant_created' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_work_orders_tenant_created';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_orders_tenant_created ON work_orders (tenant_id, created_at DESC);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_work_order_parts_work_order' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_work_order_parts_work_order';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_order_parts_work_order ON work_order_parts (work_order_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_work_order_parts_item' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_work_order_parts_item';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_order_parts_item ON work_order_parts (item_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_work_order_services_work_order' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_work_order_services_work_order';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_order_services_work_order ON work_order_services (work_order_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_work_order_services_service_type' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_work_order_services_service_type';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_order_services_service_type ON work_order_services (service_type_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_appointments_tenant_status' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_appointments_tenant_status';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_tenant_status ON appointments (tenant_id, status);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_appointments_customer' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_appointments_customer';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_customer ON appointments (customer_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_insurance_estimate_items_estimate' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_insurance_estimate_items_estimate';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_estimate_items_estimate ON insurance_estimate_items (estimate_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_insurance_estimate_items_item' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_insurance_estimate_items_item';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_estimate_items_item ON insurance_estimate_items (item_id) WHERE item_id IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_recipe_ingredients_item' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_recipe_ingredients_item';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recipe_ingredients_item ON recipe_ingredients (ingredient_item_id);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_notification_logs_created_at' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_notification_logs_created_at';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_logs_created_at ON notification_logs (created_at);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_admin_rate_limits_window_start' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_admin_rate_limits_window_start';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_rate_limits_window_start ON admin_rate_limits (window_start);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = 'idx_admin_rate_limits_ip_endpoint' AND NOT i.indisvalid) THEN
    EXECUTE 'DROP INDEX idx_admin_rate_limits_ip_endpoint';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_admin_rate_limits_ip_endpoint ON admin_rate_limits (ip_address, endpoint, window_start);
