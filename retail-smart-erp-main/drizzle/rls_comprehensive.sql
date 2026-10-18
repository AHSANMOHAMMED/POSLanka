-- Comprehensive RLS re-application script (idempotent)
-- Combines 0017 + 0038 + 0039 + additional tables
-- Safe to run multiple times on any environment

-- ==================== STEP 1: Enable RLS on ALL tenant-scoped tables ====================

-- Core tables with required tenant_id
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_ownership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_compatibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_type_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_assessors ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimate_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimate_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE held_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaways ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaway_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaway_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_end_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_payments ENABLE ROW LEVEL SECURITY;
-- Additional tables (from later migrations)
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE lockout_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_item_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_balance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
-- Accounting tables
ALTER TABLE accounting_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_closing_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_templates ENABLE ROW LEVEL SECURITY;
-- Recipe/manufacturing tables
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_log ENABLE ROW LEVEL SECURITY;
-- HR & Payroll tables
ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structure_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_slip_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE advance_recovery_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_access ENABLE ROW LEVEL SECURITY;
-- AI Intelligence tables
ALTER TABLE ai_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_alerts ENABLE ROW LEVEL SECURITY;
-- Nullable tenant_id tables
ALTER TABLE vehicle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
-- Tables without tenant_id (subquery-based)
-- budget_items, journal_entry_items, tax_template_items already handled via parent FK cascade

-- ==================== STEP 2: Drop ALL existing policies (cleanup) ====================

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ==================== STEP 3: Create RLS Policies ====================
-- Standard: tenant_id = current_setting('app.tenant_id', true)::uuid

-- Core tables
CREATE POLICY tenant_isolation_policy ON users
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON warehouses
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON user_warehouses
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON warehouse_stock
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON stock_transfers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON stock_transfer_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON pos_profiles
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON customers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON customer_credit_transactions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON vehicles
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON vehicle_ownership_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON categories
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON stock_movements
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON part_compatibility
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON service_type_groups
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON service_types
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON labor_guides
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON work_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON work_order_services
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON work_order_parts
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON work_order_assignment_history
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON core_returns
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON vehicle_inspections
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON appointments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON insurance_companies
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON insurance_assessors
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON insurance_estimates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON insurance_estimate_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON insurance_estimate_revisions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON activity_logs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON estimate_templates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON insurance_estimate_attachments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON sales
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON sale_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON payments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON held_sales
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON restaurant_tables
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON modifier_groups
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON modifiers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON restaurant_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON restaurant_order_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON kitchen_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON kitchen_order_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON reservations
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON layaways
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON layaway_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON layaway_payments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON gift_cards
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON gift_card_transactions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON loyalty_tiers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON loyalty_transactions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON commission_rates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON commissions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON commission_payouts
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON day_end_sessions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON suppliers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON purchases
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON purchase_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON purchase_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON purchase_order_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON purchase_payments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Additional tables (from migrations after 0017)
CREATE POLICY tenant_isolation_policy ON email_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON sms_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON notification_templates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON notification_logs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON notification_usage
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON lockout_events
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON files
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON refunds
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON pos_opening_entries
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON pos_closing_entries
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON pos_opening_balances
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON pos_closing_reconciliation
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON pos_profile_users
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON loyalty_programs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON workspace_configs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON supplier_balance_audit
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON sales_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON sales_order_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON cancellation_reasons
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON payment_allocations
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON storage_alerts
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON subscription_payments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Accounting tables
CREATE POLICY tenant_isolation_policy ON accounting_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON chart_of_accounts
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON gl_entries
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON journal_entries
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON fiscal_years
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON cost_centers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON bank_accounts
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON bank_transactions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON budgets
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON period_closing_vouchers
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON tax_templates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Recipe/manufacturing tables
CREATE POLICY tenant_isolation_policy ON recipes
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON recipe_ingredients
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON waste_log
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- AI Intelligence tables
CREATE POLICY tenant_isolation_policy ON ai_error_logs
  FOR ALL 
  USING (
    tenant_id IS NULL 
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id IS NULL 
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_policy ON ai_alerts
  FOR ALL 
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ==================== Nullable tenant_id tables ====================
CREATE POLICY tenant_isolation_policy ON vehicle_types
  FOR ALL USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON inspection_templates
  FOR ALL USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON settings
  FOR ALL USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ==================== Subquery-based tables (no tenant_id column) ====================
CREATE POLICY tenant_isolation_policy ON pos_profile_payment_methods
  FOR ALL USING (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
  WITH CHECK (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

CREATE POLICY tenant_isolation_policy ON pos_profile_item_groups
  FOR ALL USING (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
  WITH CHECK (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

-- ==================== HR & Payroll tables ====================
CREATE POLICY tenant_isolation_policy ON employee_profiles
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON salary_components
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON salary_structures
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON salary_structure_components
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON salary_slips
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON salary_slip_components
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON payroll_runs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON employee_advances
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON advance_recovery_records
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON module_access
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ==================== STEP 4: FORCE RLS on ALL tables ====================

ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE user_warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_ownership_history FORCE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE part_compatibility FORCE ROW LEVEL SECURITY;
ALTER TABLE service_type_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE service_types FORCE ROW LEVEL SECURITY;
ALTER TABLE labor_guides FORCE ROW LEVEL SECURITY;
ALTER TABLE work_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE work_order_services FORCE ROW LEVEL SECURITY;
ALTER TABLE work_order_parts FORCE ROW LEVEL SECURITY;
ALTER TABLE work_order_assignment_history FORCE ROW LEVEL SECURITY;
ALTER TABLE core_returns FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_inspections FORCE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_companies FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_assessors FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimates FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimate_items FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimate_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE estimate_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE insurance_estimate_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_items FORCE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE held_sales FORCE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables FORCE ROW LEVEL SECURITY;
ALTER TABLE modifier_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE modifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE restaurant_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE restaurant_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE kitchen_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE kitchen_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE layaways FORCE ROW LEVEL SECURITY;
ALTER TABLE layaway_items FORCE ROW LEVEL SECURITY;
ALTER TABLE layaway_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE gift_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE gift_card_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers FORCE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE commission_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE commissions FORCE ROW LEVEL SECURITY;
ALTER TABLE commission_payouts FORCE ROW LEVEL SECURITY;
ALTER TABLE day_end_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_items FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_types FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
ALTER TABLE email_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE sms_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE lockout_events FORCE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_reconciliation FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_users FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_payment_methods FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_item_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE loyalty_programs FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_balance_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE cancellation_reasons FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE storage_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE gl_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years FORCE ROW LEVEL SECURITY;
ALTER TABLE cost_centers FORCE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE period_closing_vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients FORCE ROW LEVEL SECURITY;
ALTER TABLE waste_log FORCE ROW LEVEL SECURITY;
-- HR & Payroll
ALTER TABLE employee_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE salary_components FORCE ROW LEVEL SECURITY;
ALTER TABLE salary_structures FORCE ROW LEVEL SECURITY;
ALTER TABLE salary_structure_components FORCE ROW LEVEL SECURITY;
ALTER TABLE salary_slips FORCE ROW LEVEL SECURITY;
ALTER TABLE salary_slip_components FORCE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_advances FORCE ROW LEVEL SECURITY;
ALTER TABLE advance_recovery_records FORCE ROW LEVEL SECURITY;
ALTER TABLE module_access FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_error_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_alerts FORCE ROW LEVEL SECURITY;

-- ==================== STEP 5: Performance Indexes ====================

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_id ON warehouses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_items_tenant_id ON items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_tenant_id ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_id ON work_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_id ON appointments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_insurance_estimates_tenant_id ON insurance_estimates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_types_tenant_id ON service_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_id ON suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_id ON purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_id ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_settings_tenant_id ON email_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_settings_tenant_id ON sms_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_files_tenant_id ON files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_refunds_tenant_id ON refunds(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_opening_entries_tenant_id ON pos_opening_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_closing_entries_tenant_id ON pos_closing_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_opening_balances_tenant_id ON pos_opening_balances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_closing_reconciliation_tenant_id ON pos_closing_reconciliation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_profile_users_tenant_id ON pos_profile_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_programs_tenant_id ON loyalty_programs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_templates_tenant_id ON notification_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_id ON notification_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_usage_tenant_id ON notification_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_configs_tenant_id ON workspace_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lockout_events_tenant_id ON lockout_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_balance_audit_tenant_id ON supplier_balance_audit(tenant_id);
-- HR & Payroll indexes
CREATE INDEX IF NOT EXISTS idx_employee_profiles_tenant_id ON employee_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_components_tenant_id ON salary_components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_structures_tenant_id ON salary_structures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_structure_components_tenant_id ON salary_structure_components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_slips_tenant_id ON salary_slips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_slip_components_tenant_id ON salary_slip_components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_id ON payroll_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_advances_tenant_id ON employee_advances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_advance_recovery_records_tenant_id ON advance_recovery_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_module_access_tenant_id ON module_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_error_logs_tenant_id ON ai_error_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_tenant_id ON ai_alerts(tenant_id);

-- ==================== STEP 6: Trigger functions (SECURITY DEFINER) ====================

CREATE OR REPLACE FUNCTION update_tenant_usage_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  column_name TEXT;
  delta INTEGER;
  target_tenant_id UUID;
BEGIN
  column_name := TG_TABLE_NAME || '_count';

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

  INSERT INTO tenant_usage (tenant_id)
  VALUES (target_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  EXECUTE format(
    'UPDATE tenant_usage SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE tenant_id = $2',
    column_name, column_name
  ) USING delta, target_tenant_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_tenant_usage_on_insert()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO tenant_usage (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==================== STEP 7: Notify triggers ====================

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

DROP TRIGGER IF EXISTS items_notify ON items;
CREATE TRIGGER items_notify
  AFTER INSERT OR UPDATE OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS service_types_notify ON service_types;
CREATE TRIGGER service_types_notify
  AFTER INSERT OR UPDATE OR DELETE ON service_types
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS categories_notify ON categories;
CREATE TRIGGER categories_notify
  AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS work_orders_notify ON work_orders;
CREATE TRIGGER work_orders_notify
  AFTER INSERT OR UPDATE OR DELETE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS sales_notify ON sales;
CREATE TRIGGER sales_notify
  AFTER INSERT OR UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS appointments_notify ON appointments;
CREATE TRIGGER appointments_notify
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS customers_notify ON customers;
CREATE TRIGGER customers_notify
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS vehicles_notify ON vehicles;
CREATE TRIGGER vehicles_notify
  AFTER INSERT OR UPDATE OR DELETE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS insurance_estimates_notify ON insurance_estimates;
CREATE TRIGGER insurance_estimates_notify
  AFTER INSERT OR UPDATE OR DELETE ON insurance_estimates
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS suppliers_notify ON suppliers;
CREATE TRIGGER suppliers_notify
  AFTER INSERT OR UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS purchases_notify ON purchases;
CREATE TRIGGER purchases_notify
  AFTER INSERT OR UPDATE OR DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS restaurant_tables_notify ON restaurant_tables;
CREATE TRIGGER restaurant_tables_notify
  AFTER INSERT OR UPDATE OR DELETE ON restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS reservations_notify ON reservations;
CREATE TRIGGER reservations_notify
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS work_order_parts_notify ON work_order_parts;
CREATE TRIGGER work_order_parts_notify
  AFTER INSERT OR UPDATE OR DELETE ON work_order_parts
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS work_order_services_notify ON work_order_services;
CREATE TRIGGER work_order_services_notify
  AFTER INSERT OR UPDATE OR DELETE ON work_order_services
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS insurance_estimate_items_notify ON insurance_estimate_items;
CREATE TRIGGER insurance_estimate_items_notify
  AFTER INSERT OR UPDATE OR DELETE ON insurance_estimate_items
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- HR & Payroll triggers
DROP TRIGGER IF EXISTS employee_profiles_notify ON employee_profiles;
CREATE TRIGGER employee_profiles_notify
  AFTER INSERT OR UPDATE OR DELETE ON employee_profiles
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS salary_components_notify ON salary_components;
CREATE TRIGGER salary_components_notify
  AFTER INSERT OR UPDATE OR DELETE ON salary_components
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS salary_structures_notify ON salary_structures;
CREATE TRIGGER salary_structures_notify
  AFTER INSERT OR UPDATE OR DELETE ON salary_structures
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS salary_slips_notify ON salary_slips;
CREATE TRIGGER salary_slips_notify
  AFTER INSERT OR UPDATE OR DELETE ON salary_slips
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS payroll_runs_notify ON payroll_runs;
CREATE TRIGGER payroll_runs_notify
  AFTER INSERT OR UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS employee_advances_notify ON employee_advances;
CREATE TRIGGER employee_advances_notify
  AFTER INSERT OR UPDATE OR DELETE ON employee_advances
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

DROP TRIGGER IF EXISTS module_access_notify ON module_access;
CREATE TRIGGER module_access_notify
  AFTER INSERT OR UPDATE OR DELETE ON module_access
  FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- ==================== DONE ====================
