-- Accounting Module Migration
-- Phase 1: Chart of Accounts + General Ledger + Accounting Settings
-- Phase 2: Journal Entries + Journal Entry Items
-- Phase 3: Payment Allocations + Cost Centers

-- ==================== ENUMS ====================

DO $$ BEGIN
  CREATE TYPE "account_root_type" AS ENUM ('asset', 'liability', 'income', 'expense', 'equity');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "account_type" AS ENUM (
    'bank', 'cash', 'receivable', 'payable', 'stock', 'cost_of_goods_sold',
    'income_account', 'expense_account', 'tax', 'fixed_asset', 'depreciation',
    'accumulated_depreciation', 'equity', 'round_off', 'temporary',
    'current_asset', 'current_liability', 'capital_work_in_progress'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "party_type" AS ENUM ('customer', 'supplier', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "journal_entry_type" AS ENUM ('journal', 'opening', 'adjustment', 'depreciation', 'closing');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "journal_entry_status" AS ENUM ('draft', 'submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "bank_transaction_status" AS ENUM ('unmatched', 'matched', 'reconciled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "budget_control_action" AS ENUM ('warn', 'stop', 'ignore');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "budget_status" AS ENUM ('draft', 'active', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "period_closing_status" AS ENUM ('draft', 'submitted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================== TABLES ====================

-- Fiscal Years
CREATE TABLE IF NOT EXISTS "fiscal_years" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(50) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "is_closed" boolean NOT NULL DEFAULT false,
  "closed_at" timestamp,
  "closed_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(255) NOT NULL,
  "account_number" varchar(20) NOT NULL,
  "parent_id" uuid,
  "root_type" "account_root_type" NOT NULL,
  "account_type" "account_type" NOT NULL,
  "is_group" boolean NOT NULL DEFAULT false,
  "currency" varchar(3) NOT NULL DEFAULT 'LKR',
  "balance" numeric(15, 2) NOT NULL DEFAULT 0,
  "is_system_account" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- General Ledger Entries
CREATE TABLE IF NOT EXISTS "gl_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "posting_date" date NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
  "debit" numeric(15, 2) NOT NULL DEFAULT 0,
  "credit" numeric(15, 2) NOT NULL DEFAULT 0,
  "party_type" "party_type",
  "party_id" uuid,
  "cost_center_id" uuid,
  "voucher_type" varchar(50) NOT NULL,
  "voucher_id" uuid NOT NULL,
  "voucher_number" varchar(100),
  "remarks" text,
  "is_opening" boolean NOT NULL DEFAULT false,
  "fiscal_year_id" uuid REFERENCES "fiscal_years"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for GL entries (critical for report performance)
CREATE INDEX IF NOT EXISTS "idx_gl_entries_tenant_date" ON "gl_entries" ("tenant_id", "posting_date");
CREATE INDEX IF NOT EXISTS "idx_gl_entries_tenant_account" ON "gl_entries" ("tenant_id", "account_id");
CREATE INDEX IF NOT EXISTS "idx_gl_entries_tenant_voucher" ON "gl_entries" ("tenant_id", "voucher_type", "voucher_id");
CREATE INDEX IF NOT EXISTS "idx_gl_entries_party" ON "gl_entries" ("tenant_id", "party_type", "party_id");

-- Index for chart of accounts
CREATE INDEX IF NOT EXISTS "idx_chart_of_accounts_tenant" ON "chart_of_accounts" ("tenant_id", "account_number");

-- Accounting Settings (per tenant, unique)
CREATE TABLE IF NOT EXISTS "accounting_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") UNIQUE,
  "default_receivable_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_payable_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_income_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_expense_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_cash_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_bank_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_tax_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_cogs_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_round_off_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "default_stock_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "current_fiscal_year_id" uuid REFERENCES "fiscal_years"("id"),
  "auto_post_sales" boolean NOT NULL DEFAULT true,
  "auto_post_purchases" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Journal Entries
CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "entry_number" varchar(50) NOT NULL,
  "entry_type" "journal_entry_type" NOT NULL DEFAULT 'journal',
  "posting_date" date NOT NULL,
  "total_debit" numeric(15, 2) NOT NULL DEFAULT 0,
  "total_credit" numeric(15, 2) NOT NULL DEFAULT 0,
  "status" "journal_entry_status" NOT NULL DEFAULT 'draft',
  "remarks" text,
  "fiscal_year_id" uuid REFERENCES "fiscal_years"("id"),
  "cancelled_at" timestamp,
  "cancelled_by" uuid,
  "cancellation_reason" text,
  "submitted_at" timestamp,
  "submitted_by" uuid,
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_journal_entries_tenant" ON "journal_entries" ("tenant_id", "created_at" DESC);

-- Journal Entry Items
CREATE TABLE IF NOT EXISTS "journal_entry_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "journal_entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
  "debit" numeric(15, 2) NOT NULL DEFAULT 0,
  "credit" numeric(15, 2) NOT NULL DEFAULT 0,
  "party_type" "party_type",
  "party_id" uuid,
  "cost_center_id" uuid,
  "remarks" text
);

-- Payment Allocations
CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "payment_id" uuid NOT NULL,
  "payment_type" varchar(50) NOT NULL,
  "invoice_id" uuid NOT NULL,
  "invoice_type" varchar(50) NOT NULL,
  "allocated_amount" numeric(15, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Cost Centers
CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(255) NOT NULL,
  "parent_id" uuid,
  "is_group" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- ==================== ROW LEVEL SECURITY ====================

-- Enable RLS on all new accounting tables
ALTER TABLE "fiscal_years" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chart_of_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gl_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entry_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;

-- RLS policies for fiscal_years
DROP POLICY IF EXISTS "fiscal_years_tenant_isolation" ON "fiscal_years";
CREATE POLICY "fiscal_years_tenant_isolation" ON "fiscal_years"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- RLS policies for chart_of_accounts
DROP POLICY IF EXISTS "chart_of_accounts_tenant_isolation" ON "chart_of_accounts";
CREATE POLICY "chart_of_accounts_tenant_isolation" ON "chart_of_accounts"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- RLS policies for gl_entries
DROP POLICY IF EXISTS "gl_entries_tenant_isolation" ON "gl_entries";
CREATE POLICY "gl_entries_tenant_isolation" ON "gl_entries"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- RLS policies for accounting_settings
DROP POLICY IF EXISTS "accounting_settings_tenant_isolation" ON "accounting_settings";
CREATE POLICY "accounting_settings_tenant_isolation" ON "accounting_settings"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- RLS policies for journal_entries
DROP POLICY IF EXISTS "journal_entries_tenant_isolation" ON "journal_entries";
CREATE POLICY "journal_entries_tenant_isolation" ON "journal_entries"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- RLS policies for journal_entry_items (through journal_entries)
DROP POLICY IF EXISTS "journal_entry_items_tenant_isolation" ON "journal_entry_items";
CREATE POLICY "journal_entry_items_tenant_isolation" ON "journal_entry_items"
  USING (
    EXISTS (
      SELECT 1 FROM "journal_entries" je
      WHERE je.id = journal_entry_id
      AND je.tenant_id::text = current_setting('app.tenant_id', true)
    )
  );

-- RLS policies for payment_allocations
DROP POLICY IF EXISTS "payment_allocations_tenant_isolation" ON "payment_allocations";
CREATE POLICY "payment_allocations_tenant_isolation" ON "payment_allocations"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- RLS policies for cost_centers
DROP POLICY IF EXISTS "cost_centers_tenant_isolation" ON "cost_centers";
CREATE POLICY "cost_centers_tenant_isolation" ON "cost_centers"
  USING (tenant_id::text = current_setting('app.tenant_id', true));

-- ==================== TENANT USAGE TRIGGERS ====================
-- Update tenant_usage counts for new accounting tables

CREATE OR REPLACE FUNCTION update_tenant_usage_accounting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This is a no-op placeholder for future usage tracking of accounting tables.
  -- Accounting tables don't need usage tracking as they are metadata/ledger tables.
  RETURN COALESCE(NEW, OLD);
END;
$$;
