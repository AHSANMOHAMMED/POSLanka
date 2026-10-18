-- Sales Orders migration
-- Adds sales_orders and sales_order_items tables, and salesOrderId to sales

-- Create sales order status enum
DO $$ BEGIN
  CREATE TYPE "sales_order_status" AS ENUM ('draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create sales_orders table
CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "order_no" varchar(50) NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id"),
  "vehicle_id" uuid REFERENCES "vehicles"("id"),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
  "customer_name" varchar(255),
  "vehicle_plate" varchar(20),
  "vehicle_description" varchar(255),
  "expected_delivery_date" date,
  "delivery_address" text,
  "subtotal" numeric(12, 2) NOT NULL DEFAULT '0',
  "discount_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "discount_type" "discount_type",
  "tax_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "total" numeric(12, 2) NOT NULL DEFAULT '0',
  "status" "sales_order_status" NOT NULL DEFAULT 'draft',
  "notes" text,
  "cancellation_reason" text,
  "cancelled_at" timestamp,
  "confirmed_at" timestamp,
  "created_by" uuid REFERENCES "users"("id"),
  "confirmed_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create sales_order_items table
CREATE TABLE IF NOT EXISTS "sales_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "sales_order_id" uuid NOT NULL REFERENCES "sales_orders"("id"),
  "item_id" uuid REFERENCES "items"("id"),
  "item_name" varchar(255) NOT NULL,
  "quantity" numeric(12, 3) NOT NULL,
  "fulfilled_quantity" numeric(12, 3) NOT NULL DEFAULT '0',
  "unit_price" numeric(12, 2) NOT NULL,
  "discount" numeric(12, 2) NOT NULL DEFAULT '0',
  "discount_type" "discount_type",
  "tax" numeric(12, 2) NOT NULL DEFAULT '0',
  "tax_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "tax_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "total" numeric(12, 2) NOT NULL
);

-- Add sales_order_id column to sales table
DO $$ BEGIN
  ALTER TABLE "sales" ADD COLUMN "sales_order_id" uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Enable RLS on new tables
ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_order_items" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for sales_orders
DO $$ BEGIN
  CREATE POLICY "sales_orders_tenant_isolation" ON "sales_orders"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create RLS policies for sales_order_items
DO $$ BEGIN
  CREATE POLICY "sales_order_items_tenant_isolation" ON "sales_order_items"
    USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_sales_orders_tenant" ON "sales_orders"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sales_orders_status" ON "sales_orders"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_sales_orders_customer" ON "sales_orders"("customer_id");
CREATE INDEX IF NOT EXISTS "idx_sales_orders_warehouse" ON "sales_orders"("warehouse_id");
CREATE INDEX IF NOT EXISTS "idx_sales_order_items_order" ON "sales_order_items"("sales_order_id");
CREATE INDEX IF NOT EXISTS "idx_sales_order_items_tenant" ON "sales_order_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sales_sales_order" ON "sales"("sales_order_id");
