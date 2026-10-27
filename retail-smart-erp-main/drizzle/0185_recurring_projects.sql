-- 0185 (2026-10): recurring invoices, payments received (customer receipts) and projects with time tracking.
--  * recurring_invoices / recurring_invoice_items: an invoice profile (customer, branch, lines, schedule:
--    weekly / monthly / every N months / yearly from start_date, end never / after N / on date) that
--    generates sales through POST /api/sales (src/lib/recurring-invoices). next_run_date is a local
--    (Asia/Colombo) date; occurrences_generated is the index of the next occurrence.
--  * recurring_invoice_runs: one row per profile per scheduled date (UNIQUE profile + run_date) so a
--    double cron call / double "Run now" never invoices twice; draft runs wait for "Post invoice".
--  * payment_receipts / payment_receipt_allocations: "Record payment" of a customer over one or many
--    unpaid invoices (each allocation goes through POST /api/sales/[id]/payments; any excess becomes
--    customer credit through POST /api/customers/[id]/credit).
--  * projects, project_tasks, project_members, project_time_entries (running timer: one per user),
--    project_invoices (invoices raised from unbilled time / fixed price).
-- Idempotent.
CREATE TABLE IF NOT EXISTS recurring_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_name varchar(150) NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  frequency varchar(10) NOT NULL DEFAULT 'monthly',
  interval_count integer NOT NULL DEFAULT 1,
  start_date date NOT NULL,
  end_type varchar(10) NOT NULL DEFAULT 'never',
  end_after_count integer,
  end_date date,
  next_run_date date,
  occurrences_generated integer NOT NULL DEFAULT 0,
  invoice_action varchar(10) NOT NULL DEFAULT 'final',
  payment_terms_days integer NOT NULL DEFAULT 0,
  notes text,
  terms text,
  notify_channel varchar(10) NOT NULL DEFAULT 'none',
  status varchar(12) NOT NULL DEFAULT 'active',
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamp,
  last_error text,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_recurring_invoices_frequency CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  CONSTRAINT chk_recurring_invoices_interval CHECK (interval_count BETWEEN 1 AND 60),
  CONSTRAINT chk_recurring_invoices_end_type CHECK (end_type IN ('never', 'after', 'on_date')),
  CONSTRAINT chk_recurring_invoices_action CHECK (invoice_action IN ('draft', 'final')),
  CONSTRAINT chk_recurring_invoices_notify CHECK (notify_channel IN ('none', 'sms', 'whatsapp')),
  CONSTRAINT chk_recurring_invoices_status CHECK (status IN ('active', 'paused', 'stopped', 'completed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_due ON recurring_invoices (tenant_id, status, next_run_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recurring_invoices_customer ON recurring_invoices (tenant_id, customer_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS recurring_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recurring_invoice_id uuid NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  item_name varchar(255) NOT NULL,
  quantity numeric(12,3) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  uom varchar(20),
  uom_factor numeric(12,4) NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recurring_invoice_items_profile ON recurring_invoice_items (recurring_invoice_id, sort_order);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS recurring_invoice_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recurring_invoice_id uuid NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  occurrence integer NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'processing',
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  invoice_no varchar(50),
  total numeric(12,2),
  due_date date,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  triggered_by varchar(10) NOT NULL DEFAULT 'cron',
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_recurring_invoice_runs_status CHECK (status IN ('processing', 'generated', 'draft', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_invoice_runs_period ON recurring_invoice_runs (recurring_invoice_id, run_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recurring_invoice_runs_tenant ON recurring_invoice_runs (tenant_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_no varchar(30) NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  receipt_date date NOT NULL,
  method varchar(20) NOT NULL,
  reference varchar(255),
  amount_received numeric(12,2) NOT NULL DEFAULT 0,
  amount_allocated numeric(12,2) NOT NULL DEFAULT 0,
  credit_applied numeric(12,2) NOT NULL DEFAULT 0,
  excess_to_credit numeric(12,2) NOT NULL DEFAULT 0,
  status varchar(12) NOT NULL DEFAULT 'completed',
  notes text,
  error text,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_payment_receipts_status CHECK (status IN ('completed', 'partial'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_receipts_no ON payment_receipts (tenant_id, receipt_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payment_receipts_customer ON payment_receipts (tenant_id, customer_id, receipt_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES payment_receipts(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id),
  invoice_no varchar(50),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  credit_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  credit_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payment_receipt_allocations_receipt ON payment_receipt_allocations (receipt_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payment_receipt_allocations_payment ON payment_receipt_allocations (payment_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payment_receipt_allocations_credit_payment ON payment_receipt_allocations (credit_payment_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_no varchar(30) NOT NULL,
  name varchar(200) NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  description text,
  billing_method varchar(20) NOT NULL DEFAULT 'project_hourly',
  fixed_amount numeric(12,2) NOT NULL DEFAULT 0,
  project_rate numeric(12,2) NOT NULL DEFAULT 0,
  budget_type varchar(10) NOT NULL DEFAULT 'none',
  budget_hours numeric(10,2),
  budget_amount numeric(12,2),
  service_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  start_date date,
  end_date date,
  status varchar(12) NOT NULL DEFAULT 'active',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_projects_billing CHECK (billing_method IN ('fixed', 'project_hourly', 'staff_hourly', 'task_hourly')),
  CONSTRAINT chk_projects_budget CHECK (budget_type IN ('none', 'hours', 'amount')),
  CONSTRAINT chk_projects_status CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_no ON projects (tenant_id, project_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects (tenant_id, customer_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  description text,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  billable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks (project_id, sort_order);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_members_user ON project_members (project_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_members_tenant_user ON project_members (tenant_id, user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  invoice_no varchar(50),
  kind varchar(10) NOT NULL DEFAULT 'time',
  hours numeric(10,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_project_invoices_kind CHECK (kind IN ('time', 'fixed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_invoices_project ON project_invoices (project_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES project_tasks(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  entry_date date NOT NULL,
  start_time timestamptz,
  end_time timestamptz,
  duration_minutes integer NOT NULL DEFAULT 0,
  notes text,
  billable boolean NOT NULL DEFAULT true,
  is_running boolean NOT NULL DEFAULT false,
  invoiced boolean NOT NULL DEFAULT false,
  project_invoice_id uuid REFERENCES project_invoices(id) ON DELETE SET NULL,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  invoiced_rate numeric(12,2),
  invoiced_amount numeric(12,2),
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_project_time_entries_duration CHECK (duration_minutes >= 0 AND duration_minutes <= 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_time_entries_running ON project_time_entries (tenant_id, user_id) WHERE is_running;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_time_entries_project ON project_time_entries (project_id, entry_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_time_entries_user ON project_time_entries (tenant_id, user_id, entry_date);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recurring_invoices', 'recurring_invoice_items', 'recurring_invoice_runs', 'payment_receipts',
                           'payment_receipt_allocations', 'projects', 'project_tasks', 'project_members',
                           'project_invoices', 'project_time_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON %I FOR ALL TO public
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON %I', t);
    EXECUTE format($p$CREATE POLICY platform_login_access ON %I FOR ALL TO public
      USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
      WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;
END $$;
