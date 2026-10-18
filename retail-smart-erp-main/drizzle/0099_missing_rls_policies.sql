-- Migration 0099: Enable RLS on 44 tenant-scoped tables that were missing policies
--
-- These tables have tenant_id but were created after the original RLS migration (0017),
-- so they never got RLS policies. This causes:
-- 1. Data leak: queries via app_user show ALL tenants' data for these tables
-- 2. Storage breakdown bug: COUNT(*) returns all-tenant totals instead of per-tenant
--
-- Tables intentionally WITHOUT RLS (system/billing):
--   account_sessions, account_tenants, tenant_usage, subscription_payments, subscriptions
--
-- Pattern: ENABLE RLS → CREATE POLICY for tenant isolation → GRANT to app_user

-- Helper: enable RLS + create policy + grant for a table
DO $$
DECLARE
  tbl TEXT;
  tables_to_fix TEXT[] := ARRAY[
    'advance_recovery_records',
    'bank_transactions',
    'budget_items',
    'budgets',
    'cancellation_reasons',
    'dealership_services',
    'document_tags',
    'dunning_types',
    'employee_advances',
    'employee_profiles',
    'files',
    'letter_heads',
    'modifier_options',
    'module_access',
    'payment_allocations',
    'payment_entry_deductions',
    'payment_ledger',
    'payment_requests',
    'payment_terms',
    'payment_terms_template_items',
    'payment_terms_templates',
    'payroll_runs',
    'period_closing_vouchers',
    'pos_closing_reconciliation',
    'pos_opening_balances',
    'pos_profile_item_groups',
    'pos_profile_payment_methods',
    'pos_profile_users',
    'print_templates',
    'recipe_ingredients',
    'recipes',
    'refunds',
    'salary_components',
    'salary_slip_components',
    'salary_slips',
    'salary_structure_components',
    'salary_structures',
    'saved_reports',
    'serial_numbers',
    'setup_progress',
    'storage_alerts',
    'supplier_balance_audit',
    'waste_log',
    'workspace_configs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_fix
  LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Drop existing policy if any (idempotent)
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', tbl);

    -- Create tenant isolation policy
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I FOR ALL TO app_user USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      tbl
    );

    -- Grant CRUD to app_user (may already exist from 0073, but idempotent)
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', tbl);

    RAISE NOTICE 'RLS enabled on: %', tbl;
  END LOOP;
END $$;

-- Verify: count tables with RLS enabled
DO $$
DECLARE
  rls_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO rls_count
  FROM pg_class pc
  JOIN information_schema.columns c ON c.table_name = pc.relname
  WHERE c.column_name = 'tenant_id'
    AND c.table_schema = 'public'
    AND pc.relrowsecurity = true;

  SELECT COUNT(DISTINCT c.table_name) INTO total_count
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
  WHERE c.column_name = 'tenant_id'
    AND c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE';

  RAISE NOTICE 'RLS status: % of % tenant tables have RLS enabled', rls_count, total_count;
END $$;
