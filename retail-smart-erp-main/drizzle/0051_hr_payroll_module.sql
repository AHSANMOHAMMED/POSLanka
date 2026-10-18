-- HR & Payroll Module: Employee Profiles, Salary Components, Structures, Slips, Payroll Runs, Advances, Module Access
-- Covers Phase 1, 2, and 3 of the HR implementation plan

-- ==================== ENUMS ====================

DO $$ BEGIN
  CREATE TYPE employment_type AS ENUM ('full_time', 'part_time', 'contract', 'intern', 'probation');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE employment_status AS ENUM ('active', 'on_leave', 'suspended', 'terminated', 'resigned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE salary_component_type AS ENUM ('earning', 'deduction');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE salary_slip_status AS ENUM ('draft', 'submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payroll_run_status AS ENUM ('draft', 'processing', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE employee_advance_status AS ENUM ('draft', 'pending_approval', 'approved', 'disbursed', 'partially_recovered', 'fully_recovered', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================== TABLES ====================

-- Employee Profiles (1:1 extension of users)
CREATE TABLE IF NOT EXISTS employee_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  -- Employment
  employee_code VARCHAR(50),
  employment_type employment_type NOT NULL DEFAULT 'full_time',
  employment_status employment_status NOT NULL DEFAULT 'active',
  department VARCHAR(100),
  designation VARCHAR(100),
  hire_date DATE,
  confirmation_date DATE,
  termination_date DATE,
  -- Compensation
  base_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  salary_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
  -- Bank
  bank_name VARCHAR(100),
  bank_branch VARCHAR(100),
  bank_account_number VARCHAR(50),
  bank_account_name VARCHAR(100),
  bank_routing_number VARCHAR(50),
  -- Statutory IDs
  tax_id VARCHAR(50),
  tax_id_type VARCHAR(30),
  social_security_id VARCHAR(50),
  social_security_id_type VARCHAR(30),
  employer_contribution_id VARCHAR(50),
  employer_contribution_id_type VARCHAR(30),
  -- Personal
  date_of_birth DATE,
  gender VARCHAR(20),
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(50),
  address TEXT,
  -- Salary structure (Phase 2)
  salary_structure_id UUID,
  -- Metadata
  notes TEXT,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- Salary Components
CREATE TABLE IF NOT EXISTS salary_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(100) NOT NULL,
  abbreviation VARCHAR(20) NOT NULL,
  component_type salary_component_type NOT NULL,
  formula_expression TEXT,
  default_amount DECIMAL(12,2),
  is_statutory BOOLEAN NOT NULL DEFAULT false,
  is_flexible_benefit BOOLEAN NOT NULL DEFAULT false,
  depends_on_payment_days BOOLEAN NOT NULL DEFAULT true,
  do_not_include_in_total BOOLEAN NOT NULL DEFAULT false,
  is_payable_by_employer BOOLEAN NOT NULL DEFAULT false,
  expense_account_id UUID REFERENCES chart_of_accounts(id),
  payable_account_id UUID REFERENCES chart_of_accounts(id),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- Salary Structures
CREATE TABLE IF NOT EXISTS salary_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- Add FK for employee_profiles.salary_structure_id now that salary_structures exists
ALTER TABLE employee_profiles
  ADD CONSTRAINT fk_employee_profiles_salary_structure
  FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id);

-- Salary Structure Components
CREATE TABLE IF NOT EXISTS salary_structure_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  structure_id UUID NOT NULL REFERENCES salary_structures(id),
  component_id UUID NOT NULL REFERENCES salary_components(id),
  override_formula TEXT,
  override_amount DECIMAL(12,2),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Salary Slips
CREATE TABLE IF NOT EXISTS salary_slips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  slip_no VARCHAR(50) NOT NULL,
  employee_profile_id UUID NOT NULL REFERENCES employee_profiles(id),
  user_id UUID NOT NULL REFERENCES users(id),
  employee_name VARCHAR(255) NOT NULL,
  payroll_month INTEGER NOT NULL,
  payroll_year INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_working_days DECIMAL(5,1) NOT NULL DEFAULT 30,
  payment_days DECIMAL(5,1) NOT NULL DEFAULT 30,
  base_salary DECIMAL(12,2) NOT NULL,
  gross_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_employer_contributions DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
  commission_payout_id UUID,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  advance_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
  salary_structure_id UUID,
  salary_structure_name VARCHAR(100),
  status salary_slip_status NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMP,
  submitted_by UUID,
  cancelled_at TIMESTAMP,
  cancelled_by UUID,
  cancellation_reason TEXT,
  payment_method VARCHAR(50),
  payment_reference VARCHAR(255),
  paid_at TIMESTAMP,
  journal_entry_id UUID,
  payroll_run_id UUID,
  created_by UUID,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- Salary Slip Components
CREATE TABLE IF NOT EXISTS salary_slip_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  salary_slip_id UUID NOT NULL REFERENCES salary_slips(id) ON DELETE CASCADE,
  component_id UUID REFERENCES salary_components(id),
  component_name VARCHAR(100) NOT NULL,
  component_type salary_component_type NOT NULL,
  abbreviation VARCHAR(20) NOT NULL,
  formula_used TEXT,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_statutory BOOLEAN NOT NULL DEFAULT false,
  do_not_include_in_total BOOLEAN NOT NULL DEFAULT false,
  is_payable_by_employer BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Payroll Runs
CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  run_no VARCHAR(50) NOT NULL,
  payroll_month INTEGER NOT NULL,
  payroll_year INTEGER NOT NULL,
  employment_types JSONB,
  departments JSONB,
  total_employees INTEGER NOT NULL DEFAULT 0,
  total_gross_pay DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_employer_contributions DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_net_pay DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_commissions DECIMAL(15,2) NOT NULL DEFAULT 0,
  status payroll_run_status NOT NULL DEFAULT 'draft',
  processed_at TIMESTAMP,
  processed_by UUID,
  cancelled_at TIMESTAMP,
  cancelled_by UUID,
  cancellation_reason TEXT,
  journal_entry_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- Employee Advances
CREATE TABLE IF NOT EXISTS employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  advance_no VARCHAR(50) NOT NULL,
  employee_profile_id UUID NOT NULL REFERENCES employee_profiles(id),
  user_id UUID NOT NULL REFERENCES users(id),
  employee_name VARCHAR(255) NOT NULL,
  requested_amount DECIMAL(12,2) NOT NULL,
  approved_amount DECIMAL(12,2),
  disbursed_amount DECIMAL(12,2),
  recovered_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  recovery_method VARCHAR(30) NOT NULL DEFAULT 'salary_deduction',
  recovery_installments INTEGER,
  recovery_amount_per_installment DECIMAL(12,2),
  purpose VARCHAR(255),
  reason TEXT,
  status employee_advance_status NOT NULL DEFAULT 'draft',
  requested_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by UUID,
  approval_notes TEXT,
  disbursed_at TIMESTAMP,
  disbursed_by UUID,
  disbursement_method VARCHAR(50),
  disbursement_reference VARCHAR(255),
  cancelled_at TIMESTAMP,
  cancelled_by UUID,
  cancellation_reason TEXT,
  journal_entry_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP DEFAULT now() NOT NULL,
  updated_at TIMESTAMP DEFAULT now() NOT NULL
);

-- Advance Recovery Records
CREATE TABLE IF NOT EXISTS advance_recovery_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  advance_id UUID NOT NULL REFERENCES employee_advances(id),
  salary_slip_id UUID NOT NULL REFERENCES salary_slips(id),
  amount DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT now() NOT NULL
);

-- Module Access (admin-configurable module visibility per role)
CREATE TABLE IF NOT EXISTS module_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  module_key VARCHAR(50) NOT NULL,
  role user_role NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  updated_at TIMESTAMP DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, module_key, role)
);

-- Add payroll columns to accounting_settings
ALTER TABLE accounting_settings
  ADD COLUMN IF NOT EXISTS default_salary_payable_account_id UUID REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS default_statutory_payable_account_id UUID REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS default_salary_expense_account_id UUID REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS default_employer_contribution_account_id UUID REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS default_employee_advance_account_id UUID REFERENCES chart_of_accounts(id);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_employee_profiles_tenant ON employee_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_user ON employee_profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_profiles_tenant_user ON employee_profiles(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_status ON employee_profiles(tenant_id, employment_status);

CREATE INDEX IF NOT EXISTS idx_salary_components_tenant ON salary_components(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_components_type ON salary_components(tenant_id, component_type);

CREATE INDEX IF NOT EXISTS idx_salary_structures_tenant ON salary_structures(tenant_id);

CREATE INDEX IF NOT EXISTS idx_salary_structure_components_structure ON salary_structure_components(structure_id);

CREATE INDEX IF NOT EXISTS idx_salary_slips_tenant ON salary_slips(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salary_slips_employee ON salary_slips(employee_profile_id);
CREATE INDEX IF NOT EXISTS idx_salary_slips_period ON salary_slips(tenant_id, payroll_year, payroll_month);
CREATE INDEX IF NOT EXISTS idx_salary_slips_payroll_run ON salary_slips(payroll_run_id);

CREATE INDEX IF NOT EXISTS idx_salary_slip_components_slip ON salary_slip_components(salary_slip_id);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant ON payroll_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(tenant_id, payroll_year, payroll_month);

CREATE INDEX IF NOT EXISTS idx_employee_advances_tenant ON employee_advances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_advances_employee ON employee_advances(employee_profile_id);
CREATE INDEX IF NOT EXISTS idx_employee_advances_status ON employee_advances(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_advance_recovery_records_advance ON advance_recovery_records(advance_id);
CREATE INDEX IF NOT EXISTS idx_advance_recovery_records_slip ON advance_recovery_records(salary_slip_id);

CREATE INDEX IF NOT EXISTS idx_module_access_tenant ON module_access(tenant_id);

-- ==================== ROW LEVEL SECURITY ====================

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

-- RLS Policies
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

-- ==================== GRANTS ====================

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_profiles TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON salary_components TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON salary_structures TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON salary_structure_components TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON salary_slips TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON salary_slip_components TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_advances TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON advance_recovery_records TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON module_access TO app_user;
