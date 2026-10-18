-- Remove bundle functionality from the system

-- Drop bundle-related foreign key constraints and columns from work_order_parts
ALTER TABLE "work_order_parts" DROP COLUMN IF EXISTS "bundle_item_id";
ALTER TABLE "work_order_parts" DROP COLUMN IF EXISTS "bundle_instance_id";

-- Drop bundle-related foreign key constraints and columns from insurance_estimate_items
ALTER TABLE "insurance_estimate_items" DROP COLUMN IF EXISTS "bundle_item_id";
ALTER TABLE "insurance_estimate_items" DROP COLUMN IF EXISTS "bundle_instance_id";

-- Drop service type bundle components table
DROP TABLE IF EXISTS "service_type_bundle_components";

-- Drop item bundle components table
DROP TABLE IF EXISTS "item_bundle_components";

-- Remove isBundle column from service_types
ALTER TABLE "service_types" DROP COLUMN IF EXISTS "is_bundle";

-- Remove isBundle column from items
ALTER TABLE "items" DROP COLUMN IF EXISTS "is_bundle";
