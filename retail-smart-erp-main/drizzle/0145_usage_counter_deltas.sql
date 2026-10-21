-- Scalability: per-vendor usage counters were updated synchronously by triggers on every
-- insert/delete into ~180 tables. Every sale held a lock on the vendor's single tenant_usage
-- row until commit, so all cashiers and branches of one vendor were serialized.
-- Triggers now append to tenant_usage_deltas (no shared-row lock); fold_tenant_usage() moves
-- the deltas into tenant_usage (called on read and by the import-maintenance cron).

CREATE TABLE IF NOT EXISTS tenant_usage_deltas (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  column_name text,
  count_delta integer NOT NULL DEFAULT 0,
  bytes_delta bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tenant_usage_deltas_tenant ON tenant_usage_deltas (tenant_id);
--> statement-breakpoint
ALTER TABLE tenant_usage_deltas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_usage_deltas FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_usage_deltas;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON tenant_usage_deltas FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON tenant_usage_deltas;
--> statement-breakpoint
CREATE POLICY platform_login_access ON tenant_usage_deltas FOR ALL TO public
  USING (current_user <> 'app_user' AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (current_user <> 'app_user' AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, DELETE ON tenant_usage_deltas TO app_user;
    GRANT USAGE, SELECT ON SEQUENCE tenant_usage_deltas_id_seq TO app_user;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.update_tenant_usage_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  column_name TEXT;
  delta INTEGER;
  target_tenant_id UUID;
  bytes_per_row INTEGER;
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

  -- Estimated bytes per row (base * 1.2 index overhead, pre-calculated)
  bytes_per_row := CASE TG_TABLE_NAME
    WHEN 'users' THEN 600
    WHEN 'customers' THEN 480
    WHEN 'vehicles' THEN 420
    WHEN 'items' THEN 720
    WHEN 'categories' THEN 240
    WHEN 'service_types' THEN 480
    WHEN 'suppliers' THEN 420
    WHEN 'sales' THEN 540
    WHEN 'sale_items' THEN 300
    WHEN 'work_orders' THEN 960
    WHEN 'work_order_services' THEN 360
    WHEN 'work_order_parts' THEN 360
    WHEN 'appointments' THEN 420
    WHEN 'insurance_estimates' THEN 720
    WHEN 'purchases' THEN 480
    WHEN 'purchase_orders' THEN 480
    WHEN 'stock_transfers' THEN 360
    ELSE 400
  END;

  -- Append-only delta (no row lock on the shared tenant_usage row; folded by fold_tenant_usage())
  INSERT INTO tenant_usage_deltas (tenant_id, column_name, count_delta, bytes_delta)
  VALUES (target_tenant_id, column_name, delta, delta * bytes_per_row);

  RETURN NULL;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.track_storage_bytes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- Append-only delta (no row lock on the shared tenant_usage row; folded by fold_tenant_usage())
  INSERT INTO tenant_usage_deltas (tenant_id, column_name, count_delta, bytes_delta)
  VALUES (target_tenant_id, NULL, 0, delta * bytes_per_row);

  RETURN NULL;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fold_tenant_usage(p_tenant uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
  folded integer := 0;
BEGIN
  FOR r IN
    WITH moved AS (
      DELETE FROM tenant_usage_deltas
      WHERE p_tenant IS NULL OR tenant_id = p_tenant
      RETURNING tenant_id, column_name, count_delta, bytes_delta
    )
    SELECT tenant_id, column_name, sum(count_delta)::integer AS c, sum(bytes_delta)::bigint AS b, count(*)::integer AS n
    FROM moved GROUP BY tenant_id, column_name
  LOOP
    INSERT INTO tenant_usage (tenant_id) VALUES (r.tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
    IF r.column_name IS NULL THEN
      UPDATE tenant_usage
      SET storage_bytes = GREATEST(0, storage_bytes + r.b), updated_at = NOW()
      WHERE tenant_id = r.tenant_id;
    ELSE
      EXECUTE format(
        'UPDATE tenant_usage SET %I = GREATEST(0, %I + $1), storage_bytes = GREATEST(0, storage_bytes + $3), updated_at = NOW() WHERE tenant_id = $2',
        r.column_name, r.column_name
      ) USING r.c, r.tenant_id, r.b;
    END IF;
    folded := folded + r.n;
  END LOOP;
  RETURN folded;
END;
$function$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT EXECUTE ON FUNCTION public.fold_tenant_usage(uuid) TO app_user;
  END IF;
END $$;
