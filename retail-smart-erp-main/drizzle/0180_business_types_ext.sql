-- New business types: electronics & appliances (big items, hire purchase, delivery/installation),
-- hardware & building supplies, printing & photo studios (sized job orders), offices (HR/attendance).
-- ADD VALUE can't be used in the same transaction it's added in; nothing here uses the new values.
ALTER TYPE "business_type" ADD VALUE IF NOT EXISTS 'electronics';
--> statement-breakpoint
ALTER TYPE "business_type" ADD VALUE IF NOT EXISTS 'hardware';
--> statement-breakpoint
ALTER TYPE "business_type" ADD VALUE IF NOT EXISTS 'print_studio';
--> statement-breakpoint
ALTER TYPE "business_type" ADD VALUE IF NOT EXISTS 'office';
