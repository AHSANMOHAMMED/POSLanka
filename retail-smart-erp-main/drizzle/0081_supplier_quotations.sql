-- Supplier Quotations
-- Request and compare quotes from suppliers

-- Enum for supplier quotation status
CREATE TYPE "public"."supplier_quotation_status" AS ENUM('draft', 'submitted', 'received', 'awarded', 'rejected', 'expired', 'cancelled');

-- Supplier quotations table
CREATE TABLE "supplier_quotations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "quotation_no" varchar(50) NOT NULL,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
  "requisition_id" uuid REFERENCES "purchase_requisitions"("id"),
  "status" "supplier_quotation_status" DEFAULT 'draft' NOT NULL,
  "valid_until" date,
  "delivery_days" integer,
  "payment_terms" varchar(255),
  "subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
  "tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "supplier_reference" varchar(100),
  "notes" text,
  "converted_to_po_id" uuid REFERENCES "purchase_orders"("id"),
  "cancellation_reason" text,
  "cancelled_at" timestamp,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Supplier quotation items table
CREATE TABLE "supplier_quotation_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "quotation_id" uuid NOT NULL REFERENCES "supplier_quotations"("id") ON DELETE CASCADE,
  "item_id" uuid REFERENCES "items"("id"),
  "item_name" varchar(255) NOT NULL,
  "quantity" numeric(12, 3) NOT NULL,
  "unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "tax" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "delivery_days" integer,
  "notes" text
);

-- Indexes
CREATE INDEX "idx_supplier_quotations_tenant" ON "supplier_quotations" ("tenant_id");
CREATE INDEX "idx_supplier_quotations_status" ON "supplier_quotations" ("tenant_id", "status");
CREATE INDEX "idx_supplier_quotations_supplier" ON "supplier_quotations" ("supplier_id");
CREATE INDEX "idx_supplier_quotation_items_quotation" ON "supplier_quotation_items" ("quotation_id");

-- Enable RLS
ALTER TABLE "supplier_quotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_quotation_items" ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "tenant_isolation_policy" ON "supplier_quotations"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "supplier_quotation_items"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Grant permissions to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_quotations" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_quotation_items" TO app_user;
