-- Migration 0098: Align SQL storage function table scope with TABLE_MODULES
--
-- The calculate_tenant_storage_bytes() function counts ALL tables with tenant_id,
-- including system/meta tables (account_sessions, account_tenants, tenant_usage,
-- subscription_payments) that are NOT in TABLE_MODULES. This causes a ~3% mismatch
-- between stored values and the breakdown API.
--
-- Fix: Exclude non-content tables from the SQL function. Add serial_numbers to CASE.

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
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      -- Exclude system/meta tables not in TABLE_MODULES
      AND c.table_name NOT IN (
        'account_sessions',
        'account_tenants',
        'tenant_usage',
        'subscription_payments'
      )
    ORDER BY c.table_name
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id = $1', tbl.table_name)
    INTO row_count USING p_tenant_id;

    -- BASE byte estimates per row — must match TABLE_MODULES exactly
    bytes_per_row := CASE tbl.table_name

      -- === Core & Users ===
      WHEN 'users' THEN 500
      WHEN 'customers' THEN 400
      WHEN 'customer_credit_transactions' THEN 200

      -- === Inventory ===
      WHEN 'items' THEN 600
      WHEN 'categories' THEN 200
      WHEN 'warehouses' THEN 250
      WHEN 'user_warehouses' THEN 100
      WHEN 'warehouse_stock' THEN 200
      WHEN 'stock_movements' THEN 250
      WHEN 'stock_transfers' THEN 300
      WHEN 'stock_transfer_items' THEN 200
      WHEN 'stock_takes' THEN 300
      WHEN 'stock_take_items' THEN 200
      WHEN 'item_serial_numbers' THEN 250
      WHEN 'serial_numbers' THEN 250
      WHEN 'serial_number_movements' THEN 200
      WHEN 'item_batches' THEN 250
      WHEN 'part_compatibility' THEN 150

      -- === Sales & POS ===
      WHEN 'sales' THEN 450
      WHEN 'sale_items' THEN 250
      WHEN 'payments' THEN 300
      WHEN 'refunds' THEN 300
      WHEN 'held_sales' THEN 500
      WHEN 'sales_orders' THEN 400
      WHEN 'sales_order_items' THEN 250
      WHEN 'layaways' THEN 400
      WHEN 'layaway_items' THEN 250
      WHEN 'layaway_payments' THEN 200
      WHEN 'gift_cards' THEN 300
      WHEN 'gift_card_transactions' THEN 200
      WHEN 'loyalty_programs' THEN 250
      WHEN 'loyalty_tiers' THEN 200
      WHEN 'loyalty_transactions' THEN 200
      WHEN 'commission_rates' THEN 200
      WHEN 'commissions' THEN 250
      WHEN 'commission_payouts' THEN 250

      -- === POS Configuration ===
      WHEN 'pos_profiles' THEN 200
      WHEN 'pos_profile_payment_methods' THEN 100
      WHEN 'pos_profile_users' THEN 100
      WHEN 'pos_profile_item_groups' THEN 100
      WHEN 'pos_opening_entries' THEN 250
      WHEN 'pos_opening_balances' THEN 150
      WHEN 'pos_closing_entries' THEN 350
      WHEN 'pos_closing_reconciliation' THEN 200
      WHEN 'pos_shifts' THEN 300
      WHEN 'day_end_sessions' THEN 200

      -- === Purchases ===
      WHEN 'suppliers' THEN 350
      WHEN 'purchases' THEN 400
      WHEN 'purchase_items' THEN 250
      WHEN 'purchase_orders' THEN 400
      WHEN 'purchase_order_items' THEN 250
      WHEN 'purchase_payments' THEN 200
      WHEN 'supplier_balance_audit' THEN 200
      WHEN 'purchase_receipts' THEN 350
      WHEN 'purchase_receipt_items' THEN 250
      WHEN 'purchase_requisitions' THEN 400
      WHEN 'purchase_requisition_items' THEN 250
      WHEN 'supplier_quotations' THEN 400
      WHEN 'supplier_quotation_items' THEN 250

      -- === Accounting ===
      WHEN 'chart_of_accounts' THEN 300
      WHEN 'gl_entries' THEN 250
      WHEN 'journal_entries' THEN 400
      WHEN 'journal_entry_items' THEN 250
      WHEN 'recurring_journal_templates' THEN 450
      WHEN 'fiscal_years' THEN 200
      WHEN 'accounting_settings' THEN 200
      WHEN 'cost_centers' THEN 200
      WHEN 'bank_accounts' THEN 300
      WHEN 'bank_transactions' THEN 300
      WHEN 'budgets' THEN 300
      WHEN 'budget_items' THEN 200
      WHEN 'tax_templates' THEN 250
      WHEN 'tax_template_items' THEN 200
      WHEN 'period_closing_vouchers' THEN 200
      WHEN 'modes_of_payment' THEN 200
      WHEN 'payment_terms' THEN 250
      WHEN 'payment_terms_templates' THEN 200
      WHEN 'payment_terms_template_items' THEN 200
      WHEN 'payment_schedules' THEN 200
      WHEN 'payment_entries' THEN 400
      WHEN 'payment_entry_references' THEN 200
      WHEN 'payment_entry_deductions' THEN 250
      WHEN 'payment_allocations' THEN 200
      WHEN 'payment_ledger' THEN 250
      WHEN 'payment_requests' THEN 350
      WHEN 'dunning_types' THEN 350
      WHEN 'dunnings' THEN 250
      WHEN 'cancellation_reasons' THEN 200

      -- === Work Orders ===
      WHEN 'service_type_groups' THEN 200
      WHEN 'service_types' THEN 400
      WHEN 'labor_guides' THEN 200
      WHEN 'work_orders' THEN 800
      WHEN 'work_order_services' THEN 300
      WHEN 'work_order_parts' THEN 300
      WHEN 'work_order_assignment_history' THEN 200
      WHEN 'core_returns' THEN 300
      WHEN 'appointments' THEN 350
      WHEN 'insurance_companies' THEN 250
      WHEN 'insurance_assessors' THEN 250
      WHEN 'insurance_estimates' THEN 600
      WHEN 'insurance_estimate_items' THEN 300
      WHEN 'insurance_estimate_revisions' THEN 500
      WHEN 'insurance_estimate_attachments' THEN 250
      WHEN 'estimate_templates' THEN 400
      WHEN 'activity_logs' THEN 300

      -- === Inspections ===
      WHEN 'inspection_templates' THEN 250
      WHEN 'inspection_categories' THEN 150
      WHEN 'inspection_checklist_items' THEN 200
      WHEN 'vehicle_inspections' THEN 300
      WHEN 'inspection_responses' THEN 200
      WHEN 'inspection_damage_marks' THEN 200
      WHEN 'inspection_photos' THEN 200

      -- === Restaurant ===
      WHEN 'table_groups' THEN 200
      WHEN 'table_group_members' THEN 100
      WHEN 'restaurant_tables' THEN 200
      WHEN 'modifier_groups' THEN 250
      WHEN 'modifiers' THEN 200
      WHEN 'modifier_options' THEN 150
      WHEN 'modifier_group_items' THEN 100
      WHEN 'restaurant_orders' THEN 400
      WHEN 'restaurant_order_items' THEN 250
      WHEN 'kitchen_orders' THEN 250
      WHEN 'kitchen_order_items' THEN 200
      WHEN 'recipes' THEN 300
      WHEN 'recipe_ingredients' THEN 150
      WHEN 'waste_log' THEN 200
      WHEN 'reservations' THEN 300

      -- === Vehicles & Dealership ===
      WHEN 'vehicles' THEN 350
      WHEN 'vehicle_types' THEN 250
      WHEN 'vehicle_type_diagram_views' THEN 200
      WHEN 'vehicle_ownership_history' THEN 250
      WHEN 'vehicle_inventory' THEN 500
      WHEN 'test_drives' THEN 300
      WHEN 'trade_in_vehicles' THEN 300
      WHEN 'financing_options' THEN 300
      WHEN 'vehicle_sale_details' THEN 350
      WHEN 'vehicle_warranties' THEN 300
      WHEN 'dealers' THEN 300
      WHEN 'vehicle_imports' THEN 450
      WHEN 'dealer_allocations' THEN 250
      WHEN 'vehicle_expenses' THEN 250
      WHEN 'dealership_inspections' THEN 400
      WHEN 'dealer_payments' THEN 250
      WHEN 'vehicle_documents' THEN 250
      WHEN 'dealership_services' THEN 300

      -- === HR & Payroll ===
      WHEN 'employee_profiles' THEN 400
      WHEN 'salary_components' THEN 300
      WHEN 'salary_structures' THEN 300
      WHEN 'salary_structure_components' THEN 200
      WHEN 'salary_slips' THEN 400
      WHEN 'salary_slip_components' THEN 200
      WHEN 'payroll_runs' THEN 300
      WHEN 'employee_advances' THEN 250
      WHEN 'advance_recovery_records' THEN 150

      -- === Settings & System ===
      WHEN 'module_access' THEN 150
      WHEN 'settings' THEN 200
      WHEN 'workspace_configs' THEN 350
      WHEN 'setup_progress' THEN 250
      WHEN 'subscriptions' THEN 250
      WHEN 'lockout_events' THEN 250
      WHEN 'storage_alerts' THEN 200
      WHEN 'sms_settings' THEN 300
      WHEN 'email_settings' THEN 200
      WHEN 'notification_templates' THEN 300
      WHEN 'notification_logs' THEN 300
      WHEN 'notification_usage' THEN 150
      WHEN 'letter_heads' THEN 400
      WHEN 'print_templates' THEN 400
      WHEN 'saved_reports' THEN 350
      WHEN 'ai_error_logs' THEN 500
      WHEN 'ai_alerts' THEN 300
      WHEN 'ai_chat_messages' THEN 350
      WHEN 'document_tags' THEN 150
      WHEN 'staff_chat_conversations' THEN 250
      WHEN 'staff_chat_participants' THEN 100
      WHEN 'staff_chat_messages' THEN 300

      -- === Files & Documents ===
      WHEN 'files' THEN 300
      WHEN 'file_versions' THEN 250
      WHEN 'collections' THEN 200
      WHEN 'collection_files' THEN 100
      WHEN 'file_audit_logs' THEN 250

      -- Default for future tables
      ELSE 250
    END;

    total_bytes := total_bytes + (row_count * bytes_per_row);
  END LOOP;

  -- Add 20% overhead for indexes and PostgreSQL internal structures
  total_bytes := (total_bytes * 1.2)::BIGINT;

  RETURN total_bytes;
END;
$$ LANGUAGE plpgsql;


-- Recalculate all stored values
SELECT update_all_tenant_storage();
