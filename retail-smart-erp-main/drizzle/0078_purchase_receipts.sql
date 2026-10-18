-- Purchase Receipts (GRN - Goods Received Notes)
-- Tracks individual receiving events against purchase orders

-- Create purchase receipt status enum
CREATE TYPE "public"."purchase_receipt_status" AS ENUM('draft', 'completed', 'cancelled');

-- Create purchase_receipts table
CREATE TABLE IF NOT EXISTS "purchase_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "receipt_no" varchar(50) NOT NULL,
  "purchase_order_id" uuid,
  "warehouse_id" uuid,
  "supplier_id" uuid,
  "receipt_date" date NOT NULL,
  "status" "purchase_receipt_status" DEFAULT 'draft' NOT NULL,
  "supplier_invoice_no" varchar(100),
  "supplier_bill_date" date,
  "notes" text,
  "received_by" uuid,
  "cancellation_reason" text,
  "cancelled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "purchase_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "purchase_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "purchase_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "purchase_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);

-- Create purchase_receipt_items table
CREATE TABLE IF NOT EXISTS "purchase_receipt_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "receipt_id" uuid NOT NULL,
  "purchase_order_item_id" uuid,
  "item_id" uuid,
  "item_name" varchar(255) NOT NULL,
  "quantity_received" numeric(12, 3) NOT NULL,
  "quantity_accepted" numeric(12, 3) NOT NULL,
  "quantity_rejected" numeric(12, 3) DEFAULT '0' NOT NULL,
  "rejection_reason" text,
  "notes" text,
  CONSTRAINT "purchase_receipt_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "purchase_receipt_items_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "purchase_receipt_items_purchase_order_item_id_purchase_order_items_id_fk" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "purchase_receipt_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action
);

-- Add return_reason column to purchases table
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "return_reason" varchar(50);

-- Enable Row Level Security
ALTER TABLE "purchase_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_receipt_items" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for purchase_receipts
CREATE POLICY "tenant_isolation_policy" ON "purchase_receipts"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "purchase_receipt_items"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Grant permissions to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_receipts" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_receipt_items" TO app_user;
