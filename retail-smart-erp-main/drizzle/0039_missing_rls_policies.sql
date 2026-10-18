-- Migration: Complete RLS setup - add missing policies, WITH CHECK, and FORCE
-- Based on audit of actual database state. All statements are idempotent.

-- ==================== STEP 1: Enable RLS on tables that don't have it yet ====================

ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lockout_events ENABLE ROW LEVEL SECURITY;
-- These are already enabled but repeating is idempotent:
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_usage ENABLE ROW LEVEL SECURITY;

-- ==================== STEP 2: Create/replace policies on tables ====================
-- Drop any existing policies (may have different names across environments) then create with WITH CHECK.

DROP POLICY IF EXISTS tenant_isolation_email_settings ON email_settings;
DROP POLICY IF EXISTS tenant_isolation_policy ON email_settings;
CREATE POLICY tenant_isolation_policy ON email_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_sms_settings ON sms_settings;
DROP POLICY IF EXISTS tenant_isolation_policy ON sms_settings;
CREATE POLICY tenant_isolation_policy ON sms_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_notification_templates ON notification_templates;
DROP POLICY IF EXISTS tenant_isolation_policy ON notification_templates;
CREATE POLICY tenant_isolation_policy ON notification_templates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_notification_logs ON notification_logs;
DROP POLICY IF EXISTS tenant_isolation_policy ON notification_logs;
CREATE POLICY tenant_isolation_policy ON notification_logs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_notification_usage ON notification_usage;
DROP POLICY IF EXISTS tenant_isolation_policy ON notification_usage;
CREATE POLICY tenant_isolation_policy ON notification_usage
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON lockout_events;
CREATE POLICY tenant_isolation_policy ON lockout_events
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ==================== STEP 3: Upgrade existing policies to include WITH CHECK ====================
-- These tables had USING-only policies from _fix_pending.sql. Drop and recreate with WITH CHECK.

DROP POLICY IF EXISTS workspace_configs_tenant_isolation ON workspace_configs;
DROP POLICY IF EXISTS tenant_isolation_policy ON workspace_configs;
CREATE POLICY tenant_isolation_policy ON workspace_configs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS pos_opening_entries_tenant_isolation ON pos_opening_entries;
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_opening_entries;
CREATE POLICY tenant_isolation_policy ON pos_opening_entries
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS pos_closing_entries_tenant_isolation ON pos_closing_entries;
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_closing_entries;
CREATE POLICY tenant_isolation_policy ON pos_closing_entries
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS pos_opening_balances_tenant_isolation ON pos_opening_balances;
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_opening_balances;
CREATE POLICY tenant_isolation_policy ON pos_opening_balances
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS pos_closing_reconciliation_tenant_isolation ON pos_closing_reconciliation;
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_closing_reconciliation;
CREATE POLICY tenant_isolation_policy ON pos_closing_reconciliation
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS pos_profile_users_tenant_isolation ON pos_profile_users;
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_profile_users;
CREATE POLICY tenant_isolation_policy ON pos_profile_users
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS loyalty_programs_tenant_isolation ON loyalty_programs;
DROP POLICY IF EXISTS tenant_isolation_policy ON loyalty_programs;
CREATE POLICY tenant_isolation_policy ON loyalty_programs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- pos_profile_payment_methods: NO tenant_id column, uses subquery via pos_profiles
DROP POLICY IF EXISTS pos_profile_payment_methods_tenant_isolation ON pos_profile_payment_methods;
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_profile_payment_methods;
CREATE POLICY tenant_isolation_policy ON pos_profile_payment_methods
  FOR ALL USING (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
  WITH CHECK (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

-- pos_profile_item_groups: NO tenant_id column, uses subquery via pos_profiles
DROP POLICY IF EXISTS pos_profile_item_groups_tenant_isolation ON pos_profile_item_groups;
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_profile_item_groups;
CREATE POLICY tenant_isolation_policy ON pos_profile_item_groups
  FOR ALL USING (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
  WITH CHECK (pos_profile_id IN (SELECT id FROM pos_profiles WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

-- ==================== STEP 4: Fix sales_orders and sales_order_items ====================
-- These tables had USING-only policies without WITH CHECK and without FORCE.

DROP POLICY IF EXISTS sales_orders_tenant_isolation ON sales_orders;
DROP POLICY IF EXISTS tenant_isolation_policy ON sales_orders;
CREATE POLICY tenant_isolation_policy ON sales_orders
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS sales_order_items_tenant_isolation ON sales_order_items;
DROP POLICY IF EXISTS tenant_isolation_policy ON sales_order_items;
CREATE POLICY tenant_isolation_policy ON sales_order_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ==================== STEP 5: FORCE RLS on ALL tables (idempotent) ====================

ALTER TABLE email_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE sms_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_opening_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_closing_reconciliation FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_payment_methods FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_users FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_item_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE loyalty_programs FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE lockout_events FORCE ROW LEVEL SECURITY;
ALTER TABLE supplier_balance_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items FORCE ROW LEVEL SECURITY;

-- ==================== STEP 6: Performance Indexes ====================
-- Only for tables with tenant_id column (skip pos_profile_payment_methods, pos_profile_item_groups)

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
