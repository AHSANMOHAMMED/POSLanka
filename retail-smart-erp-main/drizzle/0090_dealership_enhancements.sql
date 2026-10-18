-- Dealership Module Enhancements
-- Adds: dealers, vehicle imports, dealer allocations, vehicle expenses,
-- vehicle inspections, dealer payments, vehicle documents tables
-- Modifies: vehicle_inventory (new columns), users (dealer_id), user_role enum

-- Add dealer_sales role to user_role enum
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'dealer_sales';

-- Add new columns to vehicle_inventory
ALTER TABLE "vehicle_inventory" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'direct';
ALTER TABLE "vehicle_inventory" ADD COLUMN IF NOT EXISTS "landed_cost" decimal(14, 2);
ALTER TABLE "vehicle_inventory" ADD COLUMN IF NOT EXISTS "total_expenses" decimal(14, 2) DEFAULT 0;
ALTER TABLE "vehicle_inventory" ADD COLUMN IF NOT EXISTS "registration_no" varchar(50);
ALTER TABLE "vehicle_inventory" ADD COLUMN IF NOT EXISTS "engine_capacity_cc" integer;
ALTER TABLE "vehicle_inventory" ADD COLUMN IF NOT EXISTS "engine_power_kw" decimal(8, 2);

-- Add dealer_id to users table (FK added after dealers table is created)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dealer_id" uuid;

-- Create dealers table
CREATE TABLE IF NOT EXISTS "dealers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(255) NOT NULL,
  "code" varchar(50) NOT NULL,
  "type" varchar(20) DEFAULT 'authorized',
  "contact_person" varchar(255),
  "email" varchar(255),
  "phone" varchar(50),
  "address" text,
  "warehouse_id" uuid REFERENCES "warehouses"("id"),
  "territory" varchar(255),
  "commission_rate" decimal(5, 2),
  "credit_limit" decimal(14, 2),
  "current_balance" decimal(14, 2) DEFAULT 0,
  "payment_term_days" integer DEFAULT 30,
  "status" varchar(20) DEFAULT 'active',
  "contract_start_date" date,
  "contract_end_date" date,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "dealers_tenant_code" ON "dealers" ("tenant_id", "code");

-- Add FK from users to dealers (now that dealers table exists)
ALTER TABLE "users" ADD CONSTRAINT "users_dealer_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id");

-- Create vehicle_imports table
CREATE TABLE IF NOT EXISTS "vehicle_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "vehicle_inventory_id" uuid REFERENCES "vehicle_inventory"("id"),
  "import_no" varchar(50) NOT NULL,
  "supplier_id" uuid REFERENCES "suppliers"("id"),
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id"),
  -- CIF Components
  "fob_value" decimal(14, 2),
  "freight_cost" decimal(14, 2),
  "insurance_cost" decimal(14, 2),
  "cif_value" decimal(14, 2),
  "cif_currency" varchar(3) DEFAULT 'USD',
  "exchange_rate" decimal(12, 6),
  "cif_value_lkr" decimal(14, 2),
  -- Sri Lanka Tax Breakdown
  "customs_import_duty" decimal(14, 2),
  "customs_import_duty_rate" decimal(5, 2),
  "surcharge" decimal(14, 2),
  "surcharge_rate" decimal(5, 2),
  "excise_duty" decimal(14, 2),
  "excise_duty_rate" decimal(7, 2),
  "luxury_tax" decimal(14, 2),
  "luxury_tax_rate" decimal(5, 2),
  "vat_amount" decimal(14, 2),
  "vat_rate" decimal(5, 2),
  "pal_charge" decimal(14, 2),
  "cess_fee" decimal(14, 2),
  "total_taxes" decimal(14, 2),
  "total_landed_cost" decimal(14, 2),
  -- Vehicle Identification
  "hs_code" varchar(20),
  "engine_capacity_cc" integer,
  "engine_power_kw" decimal(8, 2),
  "import_country" varchar(100),
  "year_of_manufacture" integer,
  -- Tracking
  "bill_of_lading_no" varchar(100),
  "lc_no" varchar(100),
  "customs_declaration_no" varchar(100),
  "port_of_entry" varchar(100),
  "arrival_date" date,
  "clearance_date" date,
  "registration_no" varchar(50),
  "status" varchar(20) DEFAULT 'pending',
  "notes" text,
  "additional_costs" decimal(14, 2),
  "additional_costs_breakdown" jsonb DEFAULT '[]',
  "documents" jsonb DEFAULT '[]',
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_imports_tenant_no" ON "vehicle_imports" ("tenant_id", "import_no");

-- Create dealer_allocations table
CREATE TABLE IF NOT EXISTS "dealer_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "dealer_id" uuid NOT NULL REFERENCES "dealers"("id"),
  "vehicle_inventory_id" uuid NOT NULL REFERENCES "vehicle_inventory"("id"),
  "allocated_at" timestamp DEFAULT now() NOT NULL,
  "allocated_by" uuid REFERENCES "users"("id"),
  "returned_at" timestamp,
  "returned_by" uuid REFERENCES "users"("id"),
  "return_reason" text,
  "status" varchar(20) DEFAULT 'allocated',
  "stock_transfer_id" uuid REFERENCES "stock_transfers"("id"),
  "asking_price" decimal(12, 2),
  "minimum_price" decimal(12, 2),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create vehicle_expenses table
CREATE TABLE IF NOT EXISTS "vehicle_expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "vehicle_inventory_id" uuid NOT NULL REFERENCES "vehicle_inventory"("id"),
  "category" varchar(50) NOT NULL,
  "description" varchar(255),
  "amount" decimal(12, 2) NOT NULL,
  "vendor_name" varchar(255),
  "supplier_id" uuid REFERENCES "suppliers"("id"),
  "receipt_no" varchar(100),
  "expense_date" date,
  "is_capitalized" boolean NOT NULL DEFAULT true,
  "gl_posted" boolean NOT NULL DEFAULT false,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create vehicle_inspections table
CREATE TABLE IF NOT EXISTS "dealership_inspections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "vehicle_inventory_id" uuid REFERENCES "vehicle_inventory"("id"),
  "type" varchar(20) NOT NULL,
  "inspected_by" uuid REFERENCES "users"("id"),
  "inspection_date" date,
  "overall_rating" varchar(20),
  "checklist" jsonb DEFAULT '[]',
  "photos" jsonb DEFAULT '[]',
  "mileage_at_inspection" integer,
  "notes" text,
  "status" varchar(20) DEFAULT 'draft',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create dealer_payments table
CREATE TABLE IF NOT EXISTS "dealer_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "dealer_id" uuid NOT NULL REFERENCES "dealers"("id"),
  "payment_no" varchar(50) NOT NULL,
  "type" varchar(20) NOT NULL,
  "direction" varchar(10) NOT NULL,
  "amount" decimal(14, 2) NOT NULL,
  "payment_method" varchar(20),
  "reference_no" varchar(100),
  "vehicle_inventory_id" uuid REFERENCES "vehicle_inventory"("id"),
  "dealer_allocation_id" uuid REFERENCES "dealer_allocations"("id"),
  "sale_id" uuid REFERENCES "sales"("id"),
  "balance_before" decimal(14, 2),
  "balance_after" decimal(14, 2),
  "gl_posted" boolean NOT NULL DEFAULT false,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "payment_date" date,
  "due_date" date,
  "status" varchar(20) DEFAULT 'pending',
  "cancellation_reason" text,
  "cancelled_at" timestamp,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "confirmed_by" uuid REFERENCES "users"("id"),
  "confirmed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "dealer_payments_tenant_no" ON "dealer_payments" ("tenant_id", "payment_no");

-- Create vehicle_documents table
CREATE TABLE IF NOT EXISTS "vehicle_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "vehicle_inventory_id" uuid REFERENCES "vehicle_inventory"("id"),
  "vehicle_import_id" uuid REFERENCES "vehicle_imports"("id"),
  "dealer_id" uuid REFERENCES "dealers"("id"),
  "document_type" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "file_url" varchar(500),
  "file_type" varchar(50),
  "file_size" integer,
  "issue_date" date,
  "expiry_date" date,
  "is_expired" boolean NOT NULL DEFAULT false,
  "alert_before_days" integer DEFAULT 30,
  "document_no" varchar(100),
  "issued_by" varchar(255),
  "status" varchar(20) DEFAULT 'valid',
  "uploaded_by" uuid REFERENCES "users"("id"),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for vehicle_documents
CREATE INDEX IF NOT EXISTS "vehicle_documents_tenant_vehicle" ON "vehicle_documents" ("tenant_id", "vehicle_inventory_id");
CREATE INDEX IF NOT EXISTS "vehicle_documents_tenant_dealer" ON "vehicle_documents" ("tenant_id", "dealer_id");
CREATE INDEX IF NOT EXISTS "vehicle_documents_tenant_expiry" ON "vehicle_documents" ("tenant_id", "expiry_date");

-- Enable RLS on all new tables
ALTER TABLE "dealers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dealer_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dealership_inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dealer_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_documents" ENABLE ROW LEVEL SECURITY;

-- RLS policies for new tables
CREATE POLICY "tenant_isolation" ON "dealers" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_isolation" ON "vehicle_imports" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_isolation" ON "dealer_allocations" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_isolation" ON "vehicle_expenses" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_isolation" ON "dealership_inspections" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_isolation" ON "dealer_payments" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_isolation" ON "vehicle_documents" USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
