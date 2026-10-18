-- Migration: Add RLS to 6 accounting tables that were missing tenant isolation policies
-- These tables have tenant_id but were not included in the original 0017 RLS migration

-- Step 1: Enable RLS
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunnings ENABLE ROW LEVEL SECURITY;

-- Step 2: Force RLS for table owners (prevents superuser bypass)
ALTER TABLE budget_items FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_items FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_template_items FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE dunnings FORCE ROW LEVEL SECURITY;

-- Step 3: Create tenant isolation policies (same pattern as 0017)
CREATE POLICY tenant_isolation_policy ON budget_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON journal_entry_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON tax_template_items
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON payment_entries
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON payment_schedules
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON dunnings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
