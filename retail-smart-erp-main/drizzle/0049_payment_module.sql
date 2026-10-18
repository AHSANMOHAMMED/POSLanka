-- Payment Module: ERPNext-style payment features
-- Adds: Modes of Payment, Payment Terms, Payment Entries, Payment Ledger, Payment Requests, Dunning

-- ==================== ENUMS ====================

DO $$ BEGIN
  CREATE TYPE "mode_of_payment_type" AS ENUM ('cash', 'bank', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "due_date_based_on" AS ENUM ('days_after_invoice', 'days_after_month_end', 'months_after_month_end');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_schedule_status" AS ENUM ('unpaid', 'partly_paid', 'paid', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_entry_type" AS ENUM ('receive', 'pay', 'internal_transfer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_entry_status" AS ENUM ('draft', 'submitted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_entry_party_type" AS ENUM ('customer', 'supplier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_ledger_account_type" AS ENUM ('receivable', 'payable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_request_type" AS ENUM ('inward', 'outward');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_request_status" AS ENUM ('draft', 'requested', 'paid', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "dunning_status" AS ENUM ('draft', 'unresolved', 'resolved', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================== PHASE 1: Modes of Payment ====================

CREATE TABLE IF NOT EXISTS "modes_of_payment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(100) NOT NULL,
  "type" "mode_of_payment_type" NOT NULL DEFAULT 'general',
  "default_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "is_enabled" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- ==================== PHASE 2: Payment Terms ====================

CREATE TABLE IF NOT EXISTS "payment_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(100) NOT NULL,
  "invoice_portion" numeric(5, 2) NOT NULL,
  "due_date_based_on" "due_date_based_on" NOT NULL DEFAULT 'days_after_invoice',
  "credit_days" integer NOT NULL DEFAULT 0,
  "discount_type" varchar(20),
  "discount" numeric(5, 2),
  "discount_validity_days" integer,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_terms_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(100) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_terms_template_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "payment_terms_templates"("id") ON DELETE CASCADE,
  "payment_term_id" uuid NOT NULL REFERENCES "payment_terms"("id"),
  "sort_order" integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "payment_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "invoice_type" varchar(20) NOT NULL,
  "invoice_id" uuid NOT NULL,
  "payment_term_id" uuid REFERENCES "payment_terms"("id"),
  "due_date" date NOT NULL,
  "invoice_portion" numeric(5, 2) NOT NULL,
  "payment_amount" numeric(15, 2) NOT NULL,
  "paid_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "outstanding" numeric(15, 2) NOT NULL,
  "discount_type" varchar(20),
  "discount" numeric(5, 2),
  "discount_date" date,
  "status" "payment_schedule_status" NOT NULL DEFAULT 'unpaid',
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ==================== PHASE 3: Payment Entries ====================

CREATE TABLE IF NOT EXISTS "payment_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "entry_number" varchar(50) NOT NULL,
  "payment_type" "payment_entry_type" NOT NULL,
  "posting_date" date NOT NULL,
  "party_type" "payment_entry_party_type",
  "party_id" uuid,
  "party_name" varchar(255),

  -- Account fields
  "paid_from_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "paid_to_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "mode_of_payment_id" uuid REFERENCES "modes_of_payment"("id"),

  -- Amount fields
  "paid_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "received_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "total_allocated_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "unallocated_amount" numeric(15, 2) NOT NULL DEFAULT 0,
  "write_off_amount" numeric(15, 2) NOT NULL DEFAULT 0,

  -- Reference fields
  "reference_no" varchar(255),
  "reference_date" date,
  "bank_account_id" uuid REFERENCES "bank_accounts"("id"),
  "clearance_date" date,

  -- Status
  "status" "payment_entry_status" NOT NULL DEFAULT 'draft',
  "remarks" text,

  -- Audit
  "submitted_at" timestamp,
  "submitted_by" uuid,
  "cancelled_at" timestamp,
  "cancelled_by" uuid,
  "cancellation_reason" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_entry_references" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_entry_id" uuid NOT NULL REFERENCES "payment_entries"("id") ON DELETE CASCADE,
  "reference_type" varchar(50) NOT NULL,
  "reference_id" uuid NOT NULL,
  "reference_number" varchar(100),
  "total_amount" numeric(15, 2) NOT NULL,
  "outstanding_amount" numeric(15, 2) NOT NULL,
  "allocated_amount" numeric(15, 2) NOT NULL,
  "payment_schedule_id" uuid REFERENCES "payment_schedules"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_entry_deductions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_entry_id" uuid NOT NULL REFERENCES "payment_entries"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
  "cost_center_id" uuid REFERENCES "cost_centers"("id"),
  "amount" numeric(15, 2) NOT NULL,
  "description" text
);

-- ==================== PHASE 7: Payment Ledger ====================

CREATE TABLE IF NOT EXISTS "payment_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "posting_date" date NOT NULL,
  "account_type" "payment_ledger_account_type" NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "chart_of_accounts"("id"),
  "party_type" "payment_entry_party_type" NOT NULL,
  "party_id" uuid NOT NULL,
  "voucher_type" varchar(50) NOT NULL,
  "voucher_id" uuid NOT NULL,
  "against_voucher_type" varchar(50),
  "against_voucher_id" uuid,
  "amount" numeric(15, 2) NOT NULL,
  "due_date" date,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ==================== PHASE 8: Payment Requests ====================

CREATE TABLE IF NOT EXISTS "payment_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "request_number" varchar(50) NOT NULL,
  "request_type" "payment_request_type" NOT NULL,
  "reference_type" varchar(50) NOT NULL,
  "reference_id" uuid NOT NULL,
  "party_type" "payment_entry_party_type" NOT NULL,
  "party_id" uuid NOT NULL,
  "amount" numeric(15, 2) NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'LKR',
  "email_to" varchar(255),
  "subject" varchar(255),
  "message" text,
  "payment_url" text,
  "status" "payment_request_status" NOT NULL DEFAULT 'draft',
  "mode_of_payment_id" uuid REFERENCES "modes_of_payment"("id"),
  "paid_at" timestamp,
  "payment_entry_id" uuid REFERENCES "payment_entries"("id"),
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- ==================== PHASE 9: Dunning ====================

CREATE TABLE IF NOT EXISTS "dunning_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(100) NOT NULL,
  "start_day" integer NOT NULL,
  "end_day" integer NOT NULL,
  "dunning_fee" numeric(12, 2) NOT NULL DEFAULT 0,
  "interest_rate" numeric(5, 2) NOT NULL DEFAULT 0,
  "body_text" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dunnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "dunning_number" varchar(50) NOT NULL,
  "dunning_type_id" uuid NOT NULL REFERENCES "dunning_types"("id"),
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "sale_id" uuid NOT NULL REFERENCES "sales"("id"),
  "outstanding_amount" numeric(15, 2) NOT NULL,
  "dunning_fee" numeric(12, 2) NOT NULL DEFAULT 0,
  "dunning_interest" numeric(12, 2) NOT NULL DEFAULT 0,
  "grand_total" numeric(15, 2) NOT NULL,
  "status" "dunning_status" NOT NULL DEFAULT 'draft',
  "sent_at" timestamp,
  "resolved_at" timestamp,
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ==================== GL Entry Enhancement ====================

ALTER TABLE "gl_entries" ADD COLUMN IF NOT EXISTS "against_voucher_type" varchar(50);
ALTER TABLE "gl_entries" ADD COLUMN IF NOT EXISTS "against_voucher_id" uuid;

-- ==================== Existing Table Enhancements ====================

-- Add payment_terms_template_id to customers, suppliers, sales, purchases
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "payment_terms_template_id" uuid;
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payment_terms_template_id" uuid;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "payment_terms_template_id" uuid;
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "payment_terms_template_id" uuid;

-- Add new default accounts to accounting_settings
ALTER TABLE "accounting_settings" ADD COLUMN IF NOT EXISTS "default_write_off_account_id" uuid REFERENCES "chart_of_accounts"("id");
ALTER TABLE "accounting_settings" ADD COLUMN IF NOT EXISTS "default_advance_received_account_id" uuid REFERENCES "chart_of_accounts"("id");
ALTER TABLE "accounting_settings" ADD COLUMN IF NOT EXISTS "default_advance_paid_account_id" uuid REFERENCES "chart_of_accounts"("id");

-- ==================== ROW LEVEL SECURITY ====================

-- Enable RLS on all new payment module tables
ALTER TABLE "modes_of_payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_terms_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_terms_template_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_entry_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_entry_deductions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dunning_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dunnings" ENABLE ROW LEVEL SECURITY;

-- RLS policies for tenant-scoped tables
CREATE POLICY "modes_of_payment_tenant_isolation" ON "modes_of_payment"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "payment_terms_tenant_isolation" ON "payment_terms"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "payment_terms_templates_tenant_isolation" ON "payment_terms_templates"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- payment_terms_template_items uses template_id join, but add policy via subquery
CREATE POLICY "payment_terms_template_items_tenant_isolation" ON "payment_terms_template_items"
  USING (template_id IN (SELECT id FROM payment_terms_templates WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

CREATE POLICY "payment_schedules_tenant_isolation" ON "payment_schedules"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "payment_entries_tenant_isolation" ON "payment_entries"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- payment_entry_references via payment_entry_id join
CREATE POLICY "payment_entry_references_tenant_isolation" ON "payment_entry_references"
  USING (payment_entry_id IN (SELECT id FROM payment_entries WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

-- payment_entry_deductions via payment_entry_id join
CREATE POLICY "payment_entry_deductions_tenant_isolation" ON "payment_entry_deductions"
  USING (payment_entry_id IN (SELECT id FROM payment_entries WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));

CREATE POLICY "payment_ledger_tenant_isolation" ON "payment_ledger"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "payment_requests_tenant_isolation" ON "payment_requests"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "dunning_types_tenant_isolation" ON "dunning_types"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "dunnings_tenant_isolation" ON "dunnings"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS "idx_modes_of_payment_tenant" ON "modes_of_payment" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_payment_terms_tenant" ON "payment_terms" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_payment_terms_templates_tenant" ON "payment_terms_templates" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_payment_schedules_tenant" ON "payment_schedules" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_payment_schedules_invoice" ON "payment_schedules" ("invoice_type", "invoice_id");
CREATE INDEX IF NOT EXISTS "idx_payment_entries_tenant" ON "payment_entries" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_payment_entries_party" ON "payment_entries" ("party_type", "party_id");
CREATE INDEX IF NOT EXISTS "idx_payment_entries_status" ON "payment_entries" ("status");
CREATE INDEX IF NOT EXISTS "idx_payment_entries_posting_date" ON "payment_entries" ("posting_date");
CREATE INDEX IF NOT EXISTS "idx_payment_ledger_tenant" ON "payment_ledger" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_payment_ledger_party" ON "payment_ledger" ("party_type", "party_id");
CREATE INDEX IF NOT EXISTS "idx_payment_ledger_voucher" ON "payment_ledger" ("voucher_type", "voucher_id");
CREATE INDEX IF NOT EXISTS "idx_payment_ledger_against" ON "payment_ledger" ("against_voucher_type", "against_voucher_id");
CREATE INDEX IF NOT EXISTS "idx_gl_entries_against_voucher" ON "gl_entries" ("against_voucher_type", "against_voucher_id");
CREATE INDEX IF NOT EXISTS "idx_payment_requests_tenant" ON "payment_requests" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_dunning_types_tenant" ON "dunning_types" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_dunnings_tenant" ON "dunnings" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_dunnings_customer" ON "dunnings" ("customer_id");
