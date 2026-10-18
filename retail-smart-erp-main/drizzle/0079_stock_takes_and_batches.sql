-- Stock Takes (Physical Inventory Counts) and Item Batches (Lot Tracking)

-- Create stock take status enum
CREATE TYPE "public"."stock_take_status" AS ENUM('draft', 'in_progress', 'pending_review', 'completed', 'cancelled');

-- Create batch status enum
CREATE TYPE "public"."batch_status" AS ENUM('active', 'quarantine', 'expired', 'consumed');

-- Add track_batches column to items table
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "track_batches" boolean DEFAULT false NOT NULL;

-- Create stock_takes table
CREATE TABLE IF NOT EXISTS "stock_takes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "count_no" varchar(50) NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "status" "stock_take_status" DEFAULT 'draft' NOT NULL,
  "count_type" varchar(20) DEFAULT 'full' NOT NULL,
  "category_id" uuid,
  "notes" text,
  "created_by" uuid,
  "approved_by" uuid,
  "approved_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "total_items" integer DEFAULT 0 NOT NULL,
  "items_counted" integer DEFAULT 0 NOT NULL,
  "variance_count" integer DEFAULT 0 NOT NULL,
  "total_variance_value" numeric(12, 2) DEFAULT '0' NOT NULL,
  "cancellation_reason" text,
  "cancelled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "stock_takes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stock_takes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stock_takes_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stock_takes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stock_takes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);

-- Create stock_take_items table
CREATE TABLE IF NOT EXISTS "stock_take_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "stock_take_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "item_name" varchar(255) NOT NULL,
  "item_sku" varchar(100),
  "bin_location" varchar(50),
  "expected_quantity" numeric(12, 3) NOT NULL,
  "counted_quantity" numeric(12, 3),
  "variance" numeric(12, 3),
  "variance_value" numeric(12, 2),
  "cost_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "counted_by" uuid,
  "counted_at" timestamp,
  "notes" text,
  CONSTRAINT "stock_take_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stock_take_items_stock_take_id_stock_takes_id_fk" FOREIGN KEY ("stock_take_id") REFERENCES "public"."stock_takes"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "stock_take_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "stock_take_items_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);

-- Create item_batches table
CREATE TABLE IF NOT EXISTS "item_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_number" varchar(100) NOT NULL,
  "warehouse_id" uuid,
  "manufacturing_date" date,
  "expiry_date" date,
  "initial_quantity" numeric(12, 3) NOT NULL,
  "current_quantity" numeric(12, 3) NOT NULL,
  "supplier_batch_number" varchar(100),
  "purchase_receipt_id" uuid,
  "supplier_id" uuid,
  "status" "batch_status" DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "item_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "item_batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "item_batches_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "item_batches_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "public"."purchase_receipts"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "item_batches_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action
);

-- Enable Row Level Security
ALTER TABLE "stock_takes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_take_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_batches" ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "tenant_isolation_policy" ON "stock_takes"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "stock_take_items"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation_policy" ON "item_batches"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

-- Grant permissions to app_user role
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_takes" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_take_items" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "item_batches" TO app_user;
