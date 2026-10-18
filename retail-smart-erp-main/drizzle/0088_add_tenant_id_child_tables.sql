-- Migration 0088: Add tenant_id to 14 child tables
-- These tables previously lacked tenant_id and relied on parent FK joins for isolation.
-- Adding direct tenant_id enables proper RLS policies and simpler queries.

-- ==================== STEP 1: Add nullable tenant_id columns ====================

ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE inspection_categories ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE inspection_checklist_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE inspection_damage_marks ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE inspection_responses ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE journal_entry_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE payment_entry_deductions ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE payment_entry_references ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE payment_terms_template_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE pos_profile_item_groups ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE pos_profile_payment_methods ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE tax_template_items ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE vehicle_type_diagram_views ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- ==================== STEP 2: Backfill tenant_id from parent tables ====================

UPDATE budget_items bi SET tenant_id = b.tenant_id
  FROM budgets b WHERE bi.budget_id = b.id AND bi.tenant_id IS NULL;

UPDATE inspection_categories ic SET tenant_id = it.tenant_id
  FROM inspection_templates it WHERE ic.template_id = it.id AND ic.tenant_id IS NULL;

-- inspection_checklist_items: grandchild, backfill via inspection_categories
UPDATE inspection_checklist_items ici SET tenant_id = ic.tenant_id
  FROM inspection_categories ic WHERE ici.category_id = ic.id AND ici.tenant_id IS NULL;

UPDATE inspection_damage_marks idm SET tenant_id = vi.tenant_id
  FROM vehicle_inspections vi WHERE idm.inspection_id = vi.id AND idm.tenant_id IS NULL;

UPDATE inspection_photos ip SET tenant_id = vi.tenant_id
  FROM vehicle_inspections vi WHERE ip.inspection_id = vi.id AND ip.tenant_id IS NULL;

UPDATE inspection_responses ir SET tenant_id = vi.tenant_id
  FROM vehicle_inspections vi WHERE ir.inspection_id = vi.id AND ir.tenant_id IS NULL;

UPDATE journal_entry_items jei SET tenant_id = je.tenant_id
  FROM journal_entries je WHERE jei.journal_entry_id = je.id AND jei.tenant_id IS NULL;

UPDATE payment_entry_deductions ped SET tenant_id = pe.tenant_id
  FROM payment_entries pe WHERE ped.payment_entry_id = pe.id AND ped.tenant_id IS NULL;

UPDATE payment_entry_references per SET tenant_id = pe.tenant_id
  FROM payment_entries pe WHERE per.payment_entry_id = pe.id AND per.tenant_id IS NULL;

UPDATE payment_terms_template_items ptti SET tenant_id = ptt.tenant_id
  FROM payment_terms_templates ptt WHERE ptti.template_id = ptt.id AND ptti.tenant_id IS NULL;

UPDATE pos_profile_item_groups ppig SET tenant_id = pp.tenant_id
  FROM pos_profiles pp WHERE ppig.pos_profile_id = pp.id AND ppig.tenant_id IS NULL;

UPDATE pos_profile_payment_methods pppm SET tenant_id = pp.tenant_id
  FROM pos_profiles pp WHERE pppm.pos_profile_id = pp.id AND pppm.tenant_id IS NULL;

UPDATE tax_template_items tti SET tenant_id = tt.tenant_id
  FROM tax_templates tt WHERE tti.tax_template_id = tt.id AND tti.tenant_id IS NULL;

UPDATE vehicle_type_diagram_views vtdv SET tenant_id = vt.tenant_id
  FROM vehicle_types vt WHERE vtdv.vehicle_type_id = vt.id AND vtdv.tenant_id IS NULL;

-- ==================== STEP 3: Delete orphan rows (NOT NULL tables only) ====================
-- These are rows whose parent was deleted without cascade (shouldn't happen, safety net)

DELETE FROM budget_items WHERE tenant_id IS NULL;
DELETE FROM inspection_damage_marks WHERE tenant_id IS NULL;
DELETE FROM inspection_photos WHERE tenant_id IS NULL;
DELETE FROM inspection_responses WHERE tenant_id IS NULL;
DELETE FROM journal_entry_items WHERE tenant_id IS NULL;
DELETE FROM payment_entry_deductions WHERE tenant_id IS NULL;
DELETE FROM payment_entry_references WHERE tenant_id IS NULL;
DELETE FROM payment_terms_template_items WHERE tenant_id IS NULL;
DELETE FROM pos_profile_item_groups WHERE tenant_id IS NULL;
DELETE FROM pos_profile_payment_methods WHERE tenant_id IS NULL;
DELETE FROM tax_template_items WHERE tenant_id IS NULL;

-- NOTE: inspection_categories, inspection_checklist_items, vehicle_type_diagram_views
-- are nullable (parent may have tenant_id = NULL for system defaults) — do NOT delete NULLs

-- ==================== STEP 4: Set NOT NULL on 11 tables ====================

ALTER TABLE budget_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE inspection_damage_marks ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE inspection_photos ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE inspection_responses ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE journal_entry_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_entry_deductions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_entry_references ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_terms_template_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pos_profile_item_groups ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pos_profile_payment_methods ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tax_template_items ALTER COLUMN tenant_id SET NOT NULL;

-- ==================== STEP 5: Add FK constraints and indexes ====================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_items_tenant_id_fk') THEN
    ALTER TABLE budget_items ADD CONSTRAINT budget_items_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inspection_categories_tenant_id_fk') THEN
    ALTER TABLE inspection_categories ADD CONSTRAINT inspection_categories_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inspection_checklist_items_tenant_id_fk') THEN
    ALTER TABLE inspection_checklist_items ADD CONSTRAINT inspection_checklist_items_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inspection_damage_marks_tenant_id_fk') THEN
    ALTER TABLE inspection_damage_marks ADD CONSTRAINT inspection_damage_marks_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inspection_photos_tenant_id_fk') THEN
    ALTER TABLE inspection_photos ADD CONSTRAINT inspection_photos_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inspection_responses_tenant_id_fk') THEN
    ALTER TABLE inspection_responses ADD CONSTRAINT inspection_responses_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_items_tenant_id_fk') THEN
    ALTER TABLE journal_entry_items ADD CONSTRAINT journal_entry_items_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_entry_deductions_tenant_id_fk') THEN
    ALTER TABLE payment_entry_deductions ADD CONSTRAINT payment_entry_deductions_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_entry_references_tenant_id_fk') THEN
    ALTER TABLE payment_entry_references ADD CONSTRAINT payment_entry_references_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_terms_template_items_tenant_id_fk') THEN
    ALTER TABLE payment_terms_template_items ADD CONSTRAINT payment_terms_template_items_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_profile_item_groups_tenant_id_fk') THEN
    ALTER TABLE pos_profile_item_groups ADD CONSTRAINT pos_profile_item_groups_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_profile_payment_methods_tenant_id_fk') THEN
    ALTER TABLE pos_profile_payment_methods ADD CONSTRAINT pos_profile_payment_methods_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_template_items_tenant_id_fk') THEN
    ALTER TABLE tax_template_items ADD CONSTRAINT tax_template_items_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_type_diagram_views_tenant_id_fk') THEN
    ALTER TABLE vehicle_type_diagram_views ADD CONSTRAINT vehicle_type_diagram_views_tenant_id_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_items_tenant_id ON budget_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspection_categories_tenant_id ON inspection_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspection_checklist_items_tenant_id ON inspection_checklist_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspection_damage_marks_tenant_id ON inspection_damage_marks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspection_photos_tenant_id ON inspection_photos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspection_responses_tenant_id ON inspection_responses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_items_tenant_id ON journal_entry_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_entry_deductions_tenant_id ON payment_entry_deductions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_entry_references_tenant_id ON payment_entry_references(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_terms_template_items_tenant_id ON payment_terms_template_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_profile_item_groups_tenant_id ON pos_profile_item_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_profile_payment_methods_tenant_id ON pos_profile_payment_methods(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tax_template_items_tenant_id ON tax_template_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_type_diagram_views_tenant_id ON vehicle_type_diagram_views(tenant_id);

-- ==================== STEP 6: Drop old subquery-based RLS policies ====================

-- Tables with old subquery policies from migrations 0024, 0039, 0045, 0046, 0049
DROP POLICY IF EXISTS "journal_entry_items_tenant_isolation" ON journal_entry_items;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON journal_entry_items;

DROP POLICY IF EXISTS "budget_items_tenant_isolation" ON budget_items;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON budget_items;

DROP POLICY IF EXISTS "tax_template_items_tenant_isolation" ON tax_template_items;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON tax_template_items;

DROP POLICY IF EXISTS "payment_terms_template_items_tenant_isolation" ON payment_terms_template_items;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON payment_terms_template_items;

DROP POLICY IF EXISTS "payment_entry_references_tenant_isolation" ON payment_entry_references;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON payment_entry_references;

DROP POLICY IF EXISTS "payment_entry_deductions_tenant_isolation" ON payment_entry_deductions;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON payment_entry_deductions;

DROP POLICY IF EXISTS "pos_profile_payment_methods_tenant_isolation" ON pos_profile_payment_methods;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON pos_profile_payment_methods;

DROP POLICY IF EXISTS "pos_profile_item_groups_tenant_isolation" ON pos_profile_item_groups;
DROP POLICY IF EXISTS "tenant_isolation_policy" ON pos_profile_item_groups;

-- ==================== STEP 7: Create new direct tenant_id RLS policies ====================

-- 11 NOT NULL tables: standard policy
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budget_items' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON budget_items
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inspection_damage_marks' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON inspection_damage_marks
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inspection_photos' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON inspection_photos
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inspection_responses' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON inspection_responses
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'journal_entry_items' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON journal_entry_items
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_entry_deductions' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON payment_entry_deductions
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_entry_references' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON payment_entry_references
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payment_terms_template_items' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON payment_terms_template_items
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_profile_item_groups' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON pos_profile_item_groups
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_profile_payment_methods' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON pos_profile_payment_methods
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tax_template_items' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON tax_template_items
      FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- 3 nullable tables: nullable-aware policy (system defaults have tenant_id = NULL)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inspection_categories' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON inspection_categories
      FOR ALL USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inspection_checklist_items' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON inspection_checklist_items
      FOR ALL USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vehicle_type_diagram_views' AND policyname = 'tenant_isolation_policy') THEN
    CREATE POLICY tenant_isolation_policy ON vehicle_type_diagram_views
      FOR ALL USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ==================== STEP 8: Enable + Force RLS ====================

-- 6 tables that had no RLS at all
ALTER TABLE inspection_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_damage_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_type_diagram_views ENABLE ROW LEVEL SECURITY;

-- Force RLS on ALL 14 tables (idempotent)
ALTER TABLE budget_items FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_checklist_items FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_damage_marks FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_photos FORCE ROW LEVEL SECURITY;
ALTER TABLE inspection_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_items FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_entry_deductions FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_entry_references FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_terms_template_items FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_item_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE pos_profile_payment_methods FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_template_items FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicle_type_diagram_views FORCE ROW LEVEL SECURITY;

-- ==================== STEP 9: Grant permissions to app_user ====================

GRANT SELECT, INSERT, UPDATE, DELETE ON budget_items TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_categories TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_checklist_items TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_damage_marks TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_photos TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_responses TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entry_items TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_entry_deductions TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_entry_references TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_terms_template_items TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_profile_item_groups TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON pos_profile_payment_methods TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_template_items TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_type_diagram_views TO app_user;
