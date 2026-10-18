-- Phase 4-6: Bank Accounts, Reconciliation, Budgets, Tax Templates, Period Closing
-- This migration adds tables for:
--   Phase 4: bank_accounts, bank_transactions
--   Phase 5: budgets, budget_items, tax_templates, tax_template_items
--   Phase 6: period_closing_vouchers

-- ==================== ENUM TYPES ====================
-- These enums were already created in migration 0044, so we use IF NOT EXISTS

DO $$ BEGIN
  CREATE TYPE "bank_transaction_status" AS ENUM ('unmatched', 'matched', 'reconciled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "budget_status" AS ENUM ('draft', 'active', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "budget_control_action" AS ENUM ('warn', 'stop', 'ignore');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "period_closing_status" AS ENUM ('draft', 'submitted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================== PHASE 4: Bank Accounts ====================

CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "account_name" varchar(255) NOT NULL,
  "bank_name" varchar(255),
  "account_number" varchar(100),
  "branch_code" varchar(50),
  "iban" varchar(50),
  "swift_code" varchar(20),
  "account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "is_default" boolean NOT NULL DEFAULT false,
  "current_balance" numeric(15,2) NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "bank_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id"),
  "transaction_date" date NOT NULL,
  "description" text,
  "reference_number" varchar(255),
  "debit" numeric(15,2) NOT NULL DEFAULT 0,
  "credit" numeric(15,2) NOT NULL DEFAULT 0,
  "status" "bank_transaction_status" NOT NULL DEFAULT 'unmatched',
  "matched_voucher_type" varchar(50),
  "matched_voucher_id" uuid,
  "import_batch" varchar(100),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for bank tables
CREATE INDEX IF NOT EXISTS "idx_bank_accounts_tenant" ON "bank_accounts" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_tenant" ON "bank_transactions" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_bank_account" ON "bank_transactions" ("bank_account_id");
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_date" ON "bank_transactions" ("tenant_id", "transaction_date");
CREATE INDEX IF NOT EXISTS "idx_bank_transactions_status" ON "bank_transactions" ("tenant_id", "status");

-- ==================== PHASE 5: Budgets + Tax Templates ====================

CREATE TABLE IF NOT EXISTS "budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(255) NOT NULL,
  "fiscal_year_id" uuid REFERENCES "fiscal_years"("id"),
  "cost_center_id" uuid REFERENCES "cost_centers"("id"),
  "status" "budget_status" NOT NULL DEFAULT 'draft',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "budget_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "budget_id" uuid NOT NULL REFERENCES "budgets"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
  "monthly_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "annual_amount" numeric(15,2) NOT NULL DEFAULT 0,
  "control_action" "budget_control_action" NOT NULL DEFAULT 'warn'
);

CREATE TABLE IF NOT EXISTS "tax_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(255) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tax_template_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tax_template_id" uuid NOT NULL REFERENCES "tax_templates"("id") ON DELETE CASCADE,
  "tax_name" varchar(100) NOT NULL,
  "rate" numeric(5,2) NOT NULL,
  "account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "included_in_price" boolean NOT NULL DEFAULT false
);

-- Indexes for budget/tax tables
CREATE INDEX IF NOT EXISTS "idx_budgets_tenant" ON "budgets" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_budgets_fiscal_year" ON "budgets" ("fiscal_year_id");
CREATE INDEX IF NOT EXISTS "idx_budget_items_budget" ON "budget_items" ("budget_id");
CREATE INDEX IF NOT EXISTS "idx_tax_templates_tenant" ON "tax_templates" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tax_template_items_template" ON "tax_template_items" ("tax_template_id");

-- ==================== PHASE 6: Period Closing ====================

CREATE TABLE IF NOT EXISTS "period_closing_vouchers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "fiscal_year_id" uuid NOT NULL REFERENCES "fiscal_years"("id"),
  "closing_date" date NOT NULL,
  "closing_account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
  "net_profit_loss" numeric(15,2) NOT NULL DEFAULT 0,
  "status" "period_closing_status" NOT NULL DEFAULT 'draft',
  "submitted_at" timestamp,
  "submitted_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_period_closing_tenant" ON "period_closing_vouchers" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_period_closing_fiscal_year" ON "period_closing_vouchers" ("fiscal_year_id");

-- ==================== ROW LEVEL SECURITY ====================

-- Enable RLS on all new tables
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_template_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "period_closing_vouchers" ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bank_accounts
DO $$ BEGIN
  DROP POLICY IF EXISTS "bank_accounts_tenant_isolation" ON "bank_accounts";
  CREATE POLICY "bank_accounts_tenant_isolation" ON "bank_accounts"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS Policies for bank_transactions
DO $$ BEGIN
  DROP POLICY IF EXISTS "bank_transactions_tenant_isolation" ON "bank_transactions";
  CREATE POLICY "bank_transactions_tenant_isolation" ON "bank_transactions"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS Policies for budgets
DO $$ BEGIN
  DROP POLICY IF EXISTS "budgets_tenant_isolation" ON "budgets";
  CREATE POLICY "budgets_tenant_isolation" ON "budgets"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS Policies for budget_items (via budget join)
DO $$ BEGIN
  DROP POLICY IF EXISTS "budget_items_tenant_isolation" ON "budget_items";
  CREATE POLICY "budget_items_tenant_isolation" ON "budget_items"
    USING (budget_id IN (SELECT id FROM budgets WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS Policies for tax_templates
DO $$ BEGIN
  DROP POLICY IF EXISTS "tax_templates_tenant_isolation" ON "tax_templates";
  CREATE POLICY "tax_templates_tenant_isolation" ON "tax_templates"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS Policies for tax_template_items (via template join)
DO $$ BEGIN
  DROP POLICY IF EXISTS "tax_template_items_tenant_isolation" ON "tax_template_items";
  CREATE POLICY "tax_template_items_tenant_isolation" ON "tax_template_items"
    USING (tax_template_id IN (SELECT id FROM tax_templates WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS Policies for period_closing_vouchers
DO $$ BEGIN
  DROP POLICY IF EXISTS "period_closing_vouchers_tenant_isolation" ON "period_closing_vouchers";
  CREATE POLICY "period_closing_vouchers_tenant_isolation" ON "period_closing_vouchers"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Grant permissions to app_user
GRANT ALL ON "bank_accounts" TO app_user;
GRANT ALL ON "bank_transactions" TO app_user;
GRANT ALL ON "budgets" TO app_user;
GRANT ALL ON "budget_items" TO app_user;
GRANT ALL ON "tax_templates" TO app_user;
GRANT ALL ON "tax_template_items" TO app_user;
GRANT ALL ON "period_closing_vouchers" TO app_user;
