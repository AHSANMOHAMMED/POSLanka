-- Audit D (payroll): employee-advance recoveries taken by a salary slip.
-- The slip's advance_deduction was subtracted from net pay every month, but the advance's
-- balance/recovered amounts were never updated, so the same installment was deducted forever.
-- Submitting a slip now applies the deduction to the open advances and records each piece here,
-- so cancelling the slip (or its payroll run) can put exactly that amount back.
-- Idempotent; safe to re-run.
CREATE TABLE IF NOT EXISTS salary_slip_advance_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  salary_slip_id uuid NOT NULL REFERENCES salary_slips(id) ON DELETE CASCADE,
  employee_advance_id uuid NOT NULL REFERENCES employee_advances(id),
  amount numeric(12,2) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS salary_slip_advance_recoveries_slip_idx ON salary_slip_advance_recoveries (salary_slip_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS salary_slip_advance_recoveries_advance_idx ON salary_slip_advance_recoveries (employee_advance_id);
--> statement-breakpoint
ALTER TABLE salary_slip_advance_recoveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE salary_slip_advance_recoveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON salary_slip_advance_recoveries;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON salary_slip_advance_recoveries FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON salary_slip_advance_recoveries;
--> statement-breakpoint
CREATE POLICY platform_login_access ON salary_slip_advance_recoveries FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON salary_slip_advance_recoveries TO app_user;
  END IF;
END $$;
