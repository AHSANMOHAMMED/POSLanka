-- PostgreSQL triggers for real-time notifications via LISTEN/NOTIFY
-- Run this migration to enable WebSocket-based real-time updates

-- Create the notification function
CREATE OR REPLACE FUNCTION notify_table_change()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'table_changes',
    json_build_object(
      'table', TG_TABLE_NAME,
      'action', TG_OP,
      'tenant_id', COALESCE(NEW.tenant_id, OLD.tenant_id),
      'id', COALESCE(NEW.id, OLD.id)
    )::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Items table trigger
DROP TRIGGER IF EXISTS items_notify ON items;
CREATE TRIGGER items_notify
  AFTER INSERT OR UPDATE OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Service types table trigger
DROP TRIGGER IF EXISTS service_types_notify ON service_types;
CREATE TRIGGER service_types_notify
  AFTER INSERT OR UPDATE OR DELETE ON service_types
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Categories table trigger
DROP TRIGGER IF EXISTS categories_notify ON categories;
CREATE TRIGGER categories_notify
  AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Work orders table trigger
DROP TRIGGER IF EXISTS work_orders_notify ON work_orders;
CREATE TRIGGER work_orders_notify
  AFTER INSERT OR UPDATE OR DELETE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Sales table trigger
DROP TRIGGER IF EXISTS sales_notify ON sales;
CREATE TRIGGER sales_notify
  AFTER INSERT OR UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Appointments table trigger
DROP TRIGGER IF EXISTS appointments_notify ON appointments;
CREATE TRIGGER appointments_notify
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Customers table trigger
DROP TRIGGER IF EXISTS customers_notify ON customers;
CREATE TRIGGER customers_notify
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Vehicles table trigger
DROP TRIGGER IF EXISTS vehicles_notify ON vehicles;
CREATE TRIGGER vehicles_notify
  AFTER INSERT OR UPDATE OR DELETE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Insurance estimates table trigger
DROP TRIGGER IF EXISTS insurance_estimates_notify ON insurance_estimates;
CREATE TRIGGER insurance_estimates_notify
  AFTER INSERT OR UPDATE OR DELETE ON insurance_estimates
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Suppliers table trigger
DROP TRIGGER IF EXISTS suppliers_notify ON suppliers;
CREATE TRIGGER suppliers_notify
  AFTER INSERT OR UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Purchases table trigger
DROP TRIGGER IF EXISTS purchases_notify ON purchases;
CREATE TRIGGER purchases_notify
  AFTER INSERT OR UPDATE OR DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Restaurant tables trigger
DROP TRIGGER IF EXISTS restaurant_tables_notify ON restaurant_tables;
CREATE TRIGGER restaurant_tables_notify
  AFTER INSERT OR UPDATE OR DELETE ON restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Reservations table trigger
DROP TRIGGER IF EXISTS reservations_notify ON reservations;
CREATE TRIGGER reservations_notify
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Work order parts trigger (for collaborative editing)
DROP TRIGGER IF EXISTS work_order_parts_notify ON work_order_parts;
CREATE TRIGGER work_order_parts_notify
  AFTER INSERT OR UPDATE OR DELETE ON work_order_parts
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Work order services trigger (for collaborative editing)
DROP TRIGGER IF EXISTS work_order_services_notify ON work_order_services;
CREATE TRIGGER work_order_services_notify
  AFTER INSERT OR UPDATE OR DELETE ON work_order_services
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Insurance estimate items trigger (for collaborative editing)
DROP TRIGGER IF EXISTS insurance_estimate_items_notify ON insurance_estimate_items;
CREATE TRIGGER insurance_estimate_items_notify
  AFTER INSERT OR UPDATE OR DELETE ON insurance_estimate_items
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- GRANT usage on the notification channel to the application user
-- (Uncomment and modify if using a specific database user)
-- GRANT USAGE ON SCHEMA public TO your_app_user;
