-- Migration for bundle tracking in work_order_parts and insurance_estimate_items

-- Add bundle tracking columns to work_order_parts
ALTER TABLE "work_order_parts" ADD COLUMN IF NOT EXISTS "bundle_item_id" uuid REFERENCES "items"("id");
ALTER TABLE "work_order_parts" ADD COLUMN IF NOT EXISTS "bundle_instance_id" varchar(100);

-- Create index for faster bundle grouping queries
CREATE INDEX IF NOT EXISTS "idx_work_order_parts_bundle_instance" ON "work_order_parts" ("bundle_instance_id");

-- Add bundle tracking columns to insurance_estimate_items
ALTER TABLE "insurance_estimate_items" ADD COLUMN IF NOT EXISTS "bundle_item_id" uuid REFERENCES "items"("id");
ALTER TABLE "insurance_estimate_items" ADD COLUMN IF NOT EXISTS "bundle_instance_id" varchar(100);

-- Create index for faster bundle grouping queries
CREATE INDEX IF NOT EXISTS "idx_estimate_items_bundle_instance" ON "insurance_estimate_items" ("bundle_instance_id");
