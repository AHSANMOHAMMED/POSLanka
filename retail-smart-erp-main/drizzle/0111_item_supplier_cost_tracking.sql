-- Per-Supplier Cost Tracking & Cost History
-- Tracks per-supplier costs for items and logs all cost changes

-- Create cost change source enum
DO $$ BEGIN
  CREATE TYPE "public"."cost_change_source" AS ENUM('purchase', 'purchase_cancellation', 'manual_adjustment', 'purchase_return');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Item Supplier Costs: one row per item-supplier pair (latest cost)
CREATE TABLE IF NOT EXISTS "item_supplier_costs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id"),
  "last_cost_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "last_purchase_date" timestamp,
  "last_purchase_id" uuid REFERENCES "purchases"("id"),
  "total_purchased_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
  "supplier_part_number" varchar(100),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Item Cost History: append-only audit log of every cost change
CREATE TABLE IF NOT EXISTS "item_cost_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "supplier_id" uuid REFERENCES "suppliers"("id"),
  "source" "cost_change_source" NOT NULL,
  "previous_cost_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "new_cost_price" numeric(12, 2) DEFAULT '0' NOT NULL,
  "purchase_price" numeric(12, 2),
  "quantity" numeric(12, 3),
  "stock_before" numeric(12, 3),
  "stock_after" numeric(12, 3),
  "reference_id" uuid,
  "reference_no" varchar(50),
  "notes" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Unique index: one row per tenant+item+supplier
CREATE UNIQUE INDEX IF NOT EXISTS "item_supplier_costs_tenant_item_supplier_idx"
  ON "item_supplier_costs" ("tenant_id", "item_id", "supplier_id");

-- Query indexes
CREATE INDEX IF NOT EXISTS "item_supplier_costs_tenant_item_idx"
  ON "item_supplier_costs" ("tenant_id", "item_id");

CREATE INDEX IF NOT EXISTS "item_supplier_costs_tenant_supplier_idx"
  ON "item_supplier_costs" ("tenant_id", "supplier_id");

CREATE INDEX IF NOT EXISTS "item_cost_history_tenant_item_idx"
  ON "item_cost_history" ("tenant_id", "item_id");

CREATE INDEX IF NOT EXISTS "item_cost_history_tenant_item_created_idx"
  ON "item_cost_history" ("tenant_id", "item_id", "created_at" DESC);

-- Enable RLS
ALTER TABLE "item_supplier_costs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_cost_history" ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "tenant_isolation" ON "item_supplier_costs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "tenant_isolation" ON "item_cost_history"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grant permissions to app_user role
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON "item_supplier_costs" TO app_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON "item_cost_history" TO app_user;
EXCEPTION
  WHEN undefined_object THEN null;
END $$;
