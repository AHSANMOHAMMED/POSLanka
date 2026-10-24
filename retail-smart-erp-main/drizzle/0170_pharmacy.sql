-- Pharmacy business type (2026-10): medicine fields on items, prescriptions captured at the POS.
--  * items.generic_name / strength / dosage_form: search by generic name, show substitutes
--  * items.drug_schedule: otc | pharmacy_only | prescription | controlled (NULL = not a medicine)
--    prescription + controlled items need a prescription on the sale; controlled needs the
--    doctor's registration number and the patient's name (NMRA register)
--  * prescriptions: one row per sale that needed one (the prescription register)
-- Idempotent.
ALTER TYPE business_type ADD VALUE IF NOT EXISTS 'pharmacy';
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS generic_name varchar(255);
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS strength varchar(50);
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS dosage_form varchar(50);
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS drug_schedule varchar(20);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE items ADD CONSTRAINT items_drug_schedule_check
    CHECK (drug_schedule IS NULL OR drug_schedule IN ('otc', 'pharmacy_only', 'prescription', 'controlled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_items_tenant_generic_name ON items (tenant_id, lower(generic_name)) WHERE generic_name IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  prescription_no varchar(100),
  prescription_date date,
  patient_name varchar(255),
  patient_age varchar(20),
  patient_phone varchar(50),
  doctor_name varchar(255) NOT NULL,
  doctor_reg_no varchar(100),
  hospital varchar(255),
  has_controlled boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_created ON prescriptions (tenant_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prescriptions_sale ON prescriptions (sale_id);
--> statement-breakpoint
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON prescriptions;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON prescriptions FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON prescriptions;
--> statement-breakpoint
CREATE POLICY platform_login_access ON prescriptions FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON prescriptions TO app_user;
  END IF;
END $$;
