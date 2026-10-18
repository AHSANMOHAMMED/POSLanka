-- Migration 0097: Align SQL storage byte estimates with TypeScript TABLE_MODULES
--
-- Root cause: calculate_tenant_storage_bytes() and track_storage_bytes() use
-- default 250 base / 300 pre-multiplied for unlisted tables, but TABLE_MODULES
-- in src/lib/storage/table-modules.ts specifies exact values (often 150-200).
-- This creates discrepancies between stored tenant_usage.storage_bytes and the
-- breakdown API's on-the-fly calculation, causing the /account page to show
-- different numbers than the /account/usage/[tenantId] breakdown.
--
-- Fix: Replace both functions with CASE statements listing EVERY table from
-- TABLE_MODULES, ensuring perfect alignment.

-- ==================== STEP 1: Replace calculate_tenant_storage_bytes() ====================
-- Uses BASE byte values (same as TABLE_MODULES). Multiplied by 1.2 at the end.

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

      -- Default for any future tables not yet in TABLE_MODULES
      ELSE 250
    END;

    total_bytes := total_bytes + (row_count * bytes_per_row);
  END LOOP;

  -- Add 20% overhead for indexes and PostgreSQL internal structures
  total_bytes := (total_bytes * 1.2)::BIGINT;

  RETURN total_bytes;
END;
$$ LANGUAGE plpgsql;


-- ==================== STEP 2: Replace track_storage_bytes() ====================
-- Uses PRE-MULTIPLIED byte values (base × 1.2 index overhead).
-- Must match TABLE_MODULES base values × 1.2 exactly.

CREATE OR REPLACE FUNCTION track_storage_bytes()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  target_tenant_id UUID;
  delta INTEGER;
  bytes_per_row INTEGER;
BEGIN
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

  -- Pre-multiplied byte estimates (base × 1.2 index overhead)
  -- Must match TABLE_MODULES values × 1.2
  bytes_per_row := CASE TG_TABLE_NAME

    -- === Core & Users ===
    WHEN 'customer_credit_transactions' THEN 240  -- 200 × 1.2

    -- === Inventory ===
    WHEN 'warehouse_stock' THEN 240          -- 200 × 1.2
    WHEN 'stock_movements' THEN 300          -- 250 × 1.2
    WHEN 'stock_transfer_items' THEN 240     -- 200 × 1.2
    WHEN 'stock_take_items' THEN 240         -- 200 × 1.2
    WHEN 'item_serial_numbers' THEN 300      -- 250 × 1.2
    WHEN 'serial_number_movements' THEN 240  -- 200 × 1.2
    WHEN 'item_batches' THEN 300             -- 250 × 1.2
    WHEN 'part_compatibility' THEN 180       -- 150 × 1.2

    -- === Sales & POS ===
    WHEN 'payments' THEN 360                 -- 300 × 1.2
    WHEN 'refunds' THEN 360                  -- 300 × 1.2
    WHEN 'held_sales' THEN 600               -- 500 × 1.2
    WHEN 'sales_orders' THEN 480             -- 400 × 1.2
    WHEN 'sales_order_items' THEN 300        -- 250 × 1.2
    WHEN 'layaways' THEN 480                 -- 400 × 1.2
    WHEN 'layaway_items' THEN 300            -- 250 × 1.2
    WHEN 'layaway_payments' THEN 240         -- 200 × 1.2
    WHEN 'gift_cards' THEN 360               -- 300 × 1.2
    WHEN 'gift_card_transactions' THEN 240   -- 200 × 1.2
    WHEN 'loyalty_programs' THEN 300         -- 250 × 1.2
    WHEN 'loyalty_tiers' THEN 240            -- 200 × 1.2
    WHEN 'loyalty_transactions' THEN 240     -- 200 × 1.2
    WHEN 'commission_rates' THEN 240         -- 200 × 1.2
    WHEN 'commissions' THEN 300              -- 250 × 1.2
    WHEN 'commission_payouts' THEN 300       -- 250 × 1.2

    -- === POS Configuration ===
    WHEN 'pos_profiles' THEN 240             -- 200 × 1.2
    WHEN 'pos_profile_payment_methods' THEN 120  -- 100 × 1.2
    WHEN 'pos_profile_users' THEN 120        -- 100 × 1.2
    WHEN 'pos_profile_item_groups' THEN 120  -- 100 × 1.2
    WHEN 'pos_opening_entries' THEN 300      -- 250 × 1.2
    WHEN 'pos_opening_balances' THEN 180     -- 150 × 1.2
    WHEN 'pos_closing_entries' THEN 420      -- 350 × 1.2
    WHEN 'pos_closing_reconciliation' THEN 240  -- 200 × 1.2
    WHEN 'pos_shifts' THEN 360               -- 300 × 1.2
    WHEN 'day_end_sessions' THEN 240         -- 200 × 1.2

    -- === Purchases ===
    WHEN 'purchase_items' THEN 300           -- 250 × 1.2
    WHEN 'purchase_order_items' THEN 300     -- 250 × 1.2
    WHEN 'purchase_payments' THEN 240        -- 200 × 1.2
    WHEN 'supplier_balance_audit' THEN 240   -- 200 × 1.2
    WHEN 'purchase_receipts' THEN 420        -- 350 × 1.2
    WHEN 'purchase_receipt_items' THEN 300   -- 250 × 1.2
    WHEN 'purchase_requisitions' THEN 480    -- 400 × 1.2
    WHEN 'purchase_requisition_items' THEN 300  -- 250 × 1.2
    WHEN 'supplier_quotations' THEN 480      -- 400 × 1.2
    WHEN 'supplier_quotation_items' THEN 300 -- 250 × 1.2

    -- === Accounting ===
    WHEN 'chart_of_accounts' THEN 360        -- 300 × 1.2
    WHEN 'gl_entries' THEN 300               -- 250 × 1.2
    WHEN 'journal_entries' THEN 480          -- 400 × 1.2
    WHEN 'journal_entry_items' THEN 300      -- 250 × 1.2
    WHEN 'recurring_journal_templates' THEN 540  -- 450 × 1.2
    WHEN 'fiscal_years' THEN 240             -- 200 × 1.2
    WHEN 'accounting_settings' THEN 240      -- 200 × 1.2
    WHEN 'cost_centers' THEN 240             -- 200 × 1.2
    WHEN 'bank_accounts' THEN 360            -- 300 × 1.2
    WHEN 'bank_transactions' THEN 360        -- 300 × 1.2
    WHEN 'budgets' THEN 360                  -- 300 × 1.2
    WHEN 'budget_items' THEN 240             -- 200 × 1.2
    WHEN 'tax_templates' THEN 300            -- 250 × 1.2
    WHEN 'tax_template_items' THEN 240       -- 200 × 1.2
    WHEN 'period_closing_vouchers' THEN 240  -- 200 × 1.2
    WHEN 'modes_of_payment' THEN 240         -- 200 × 1.2
    WHEN 'payment_terms' THEN 300            -- 250 × 1.2
    WHEN 'payment_terms_templates' THEN 240  -- 200 × 1.2
    WHEN 'payment_terms_template_items' THEN 240  -- 200 × 1.2
    WHEN 'payment_schedules' THEN 240        -- 200 × 1.2
    WHEN 'payment_entries' THEN 480          -- 400 × 1.2
    WHEN 'payment_entry_references' THEN 240 -- 200 × 1.2
    WHEN 'payment_entry_deductions' THEN 300 -- 250 × 1.2
    WHEN 'payment_allocations' THEN 240      -- 200 × 1.2
    WHEN 'payment_ledger' THEN 300           -- 250 × 1.2
    WHEN 'payment_requests' THEN 420         -- 350 × 1.2
    WHEN 'dunning_types' THEN 420            -- 350 × 1.2
    WHEN 'dunnings' THEN 300                 -- 250 × 1.2
    WHEN 'cancellation_reasons' THEN 240     -- 200 × 1.2

    -- === Work Orders ===
    WHEN 'service_type_groups' THEN 240      -- 200 × 1.2
    WHEN 'labor_guides' THEN 240             -- 200 × 1.2
    WHEN 'work_order_assignment_history' THEN 240  -- 200 × 1.2
    WHEN 'core_returns' THEN 360             -- 300 × 1.2
    WHEN 'insurance_companies' THEN 300      -- 250 × 1.2
    WHEN 'insurance_assessors' THEN 300      -- 250 × 1.2
    WHEN 'insurance_estimate_items' THEN 360 -- 300 × 1.2
    WHEN 'insurance_estimate_revisions' THEN 600  -- 500 × 1.2
    WHEN 'insurance_estimate_attachments' THEN 300  -- 250 × 1.2
    WHEN 'estimate_templates' THEN 480       -- 400 × 1.2
    WHEN 'activity_logs' THEN 360            -- 300 × 1.2

    -- === Inspections ===
    WHEN 'inspection_templates' THEN 300     -- 250 × 1.2
    WHEN 'inspection_categories' THEN 180    -- 150 × 1.2
    WHEN 'inspection_checklist_items' THEN 240  -- 200 × 1.2
    WHEN 'vehicle_inspections' THEN 360      -- 300 × 1.2
    WHEN 'inspection_responses' THEN 240     -- 200 × 1.2
    WHEN 'inspection_damage_marks' THEN 240  -- 200 × 1.2
    WHEN 'inspection_photos' THEN 240        -- 200 × 1.2

    -- === Restaurant ===
    WHEN 'table_groups' THEN 240             -- 200 × 1.2
    WHEN 'table_group_members' THEN 120      -- 100 × 1.2
    WHEN 'restaurant_tables' THEN 240        -- 200 × 1.2
    WHEN 'modifier_groups' THEN 300          -- 250 × 1.2
    WHEN 'modifiers' THEN 240               -- 200 × 1.2
    WHEN 'modifier_options' THEN 180         -- 150 × 1.2
    WHEN 'modifier_group_items' THEN 120     -- 100 × 1.2
    WHEN 'restaurant_orders' THEN 480        -- 400 × 1.2
    WHEN 'restaurant_order_items' THEN 300   -- 250 × 1.2
    WHEN 'kitchen_orders' THEN 300           -- 250 × 1.2
    WHEN 'kitchen_order_items' THEN 240      -- 200 × 1.2
    WHEN 'recipes' THEN 360                  -- 300 × 1.2
    WHEN 'recipe_ingredients' THEN 180       -- 150 × 1.2
    WHEN 'waste_log' THEN 240               -- 200 × 1.2
    WHEN 'reservations' THEN 360             -- 300 × 1.2

    -- === Vehicles & Dealership ===
    WHEN 'vehicle_types' THEN 300            -- 250 × 1.2
    WHEN 'vehicle_type_diagram_views' THEN 240  -- 200 × 1.2
    WHEN 'vehicle_ownership_history' THEN 300  -- 250 × 1.2
    WHEN 'vehicle_inventory' THEN 600        -- 500 × 1.2
    WHEN 'test_drives' THEN 360              -- 300 × 1.2
    WHEN 'trade_in_vehicles' THEN 360        -- 300 × 1.2
    WHEN 'financing_options' THEN 360        -- 300 × 1.2
    WHEN 'vehicle_sale_details' THEN 420     -- 350 × 1.2
    WHEN 'vehicle_warranties' THEN 360       -- 300 × 1.2
    WHEN 'dealers' THEN 360                  -- 300 × 1.2
    WHEN 'vehicle_imports' THEN 540          -- 450 × 1.2
    WHEN 'dealer_allocations' THEN 300       -- 250 × 1.2
    WHEN 'vehicle_expenses' THEN 300         -- 250 × 1.2
    WHEN 'dealership_inspections' THEN 480   -- 400 × 1.2
    WHEN 'dealer_payments' THEN 300          -- 250 × 1.2
    WHEN 'vehicle_documents' THEN 300        -- 250 × 1.2
    WHEN 'dealership_services' THEN 360      -- 300 × 1.2

    -- === HR & Payroll ===
    WHEN 'employee_profiles' THEN 480        -- 400 × 1.2
    WHEN 'salary_components' THEN 360        -- 300 × 1.2
    WHEN 'salary_structures' THEN 360        -- 300 × 1.2
    WHEN 'salary_structure_components' THEN 240  -- 200 × 1.2
    WHEN 'salary_slips' THEN 480             -- 400 × 1.2
    WHEN 'salary_slip_components' THEN 240   -- 200 × 1.2
    WHEN 'payroll_runs' THEN 360             -- 300 × 1.2
    WHEN 'employee_advances' THEN 300        -- 250 × 1.2
    WHEN 'advance_recovery_records' THEN 180 -- 150 × 1.2

    -- === Settings & System ===
    WHEN 'module_access' THEN 180            -- 150 × 1.2
    WHEN 'settings' THEN 240                 -- 200 × 1.2
    WHEN 'workspace_configs' THEN 420        -- 350 × 1.2
    WHEN 'setup_progress' THEN 300           -- 250 × 1.2
    WHEN 'subscriptions' THEN 300            -- 250 × 1.2
    WHEN 'lockout_events' THEN 300           -- 250 × 1.2
    WHEN 'storage_alerts' THEN 240           -- 200 × 1.2
    WHEN 'sms_settings' THEN 360             -- 300 × 1.2
    WHEN 'email_settings' THEN 240           -- 200 × 1.2
    WHEN 'notification_templates' THEN 360   -- 300 × 1.2
    WHEN 'notification_logs' THEN 360        -- 300 × 1.2
    WHEN 'notification_usage' THEN 180       -- 150 × 1.2
    WHEN 'letter_heads' THEN 480             -- 400 × 1.2
    WHEN 'print_templates' THEN 480          -- 400 × 1.2
    WHEN 'saved_reports' THEN 420            -- 350 × 1.2
    WHEN 'ai_error_logs' THEN 600            -- 500 × 1.2
    WHEN 'ai_alerts' THEN 360               -- 300 × 1.2
    WHEN 'ai_chat_messages' THEN 420         -- 350 × 1.2
    WHEN 'document_tags' THEN 180            -- 150 × 1.2
    WHEN 'staff_chat_conversations' THEN 300 -- 250 × 1.2
    WHEN 'staff_chat_participants' THEN 120  -- 100 × 1.2
    WHEN 'staff_chat_messages' THEN 360      -- 300 × 1.2

    -- === Files & Documents ===
    WHEN 'files' THEN 360                    -- 300 × 1.2
    WHEN 'file_versions' THEN 300            -- 250 × 1.2
    WHEN 'collections' THEN 240              -- 200 × 1.2
    WHEN 'collection_files' THEN 120         -- 100 × 1.2
    WHEN 'file_audit_logs' THEN 300          -- 250 × 1.2

    -- Default for future tables (250 × 1.2 = 300)
    ELSE 300
  END;

  IF bytes_per_row = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO tenant_usage (tenant_id)
  VALUES (target_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE tenant_usage
  SET storage_bytes = GREATEST(0, storage_bytes + delta * bytes_per_row),
      updated_at = NOW()
  WHERE tenant_id = target_tenant_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- ==================== STEP 3: Recalculate all stored values ====================
-- This makes tenant_usage.storage_bytes match the breakdown API perfectly.

SELECT update_all_tenant_storage();
