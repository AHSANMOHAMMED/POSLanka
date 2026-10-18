-- Purchase Requisitions
-- Formal purchase request workflow: draft -> pending_approval -> approved -> ordered

-- Enum for purchase requisition status
CREATE TYPE "public"."purchase_requisition_status" AS ENUM('draft', 'pending_approval', 'approved', 'partially_ordered', 'ordered', 'rejected', 'cancelled');

-- Purchase requisitions table
CREATE TABLE "purchase_requisitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "requisition_no" varchar(50) NOT NULL,
  "status" "purchase_requisition_status" DEFAULT 'draft' NOT NULL,
  "requested_by" uuid REFERENCES "users"("id"),
  "department" varchar(100),
  "cost_center_id" uuid REFERENCES "cost_centers"("id"),
  "required_by_date" date,
  "purpose" text,
  "notes" text,
  "estimated_total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp,
  "approval_notes" text,
  "rejected_by" uuid REFERENCES "users"("id"),
  "rejected_at" timestamp,
  "rejection_reason" text,
  "cancellation_reason" text,
  "cancelled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Purchase requisition items table
CREATE TABLE "purchase_requisition_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "requisition_id" uuid NOT NULL REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE,
  "item_id" uuid REFERENCES "items"("id"),
  "item_name" varchar(255) NOT NULL,
  "quantity" numeric(12, 3) NOT NULL,
  "ordered_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
  "estimated_unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "estimated_total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "preferred_supplier_id" uuid REFERENCES "suppliers"("id"),
  "warehouse_id" uuid REFERENCES "warehouses"("id"),
  "notes" text
);

-- Indexes
CREATE INDEX "idx_purchase_requisitions_tenant" ON "purchase_requisitions" ("tenant_id");
CREATE INDEX "idx_purchase_requisitions_status" ON "purchase_requisitions" ("tenant_id", "status");
CREATE INDEX "idx_purchase_requisition_items_requisition" ON "purchase_requisition_items" ("requisition_id");

-- Enable RLS
ALTER TABLE "purchase_requisitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_requisition_items" ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "tenant_isolation_policy" ON "purchase_requisitions"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "purchase_requisition_items"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Grant permissions to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_requisitions" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_requisition_items" TO app_user;
