-- W7 receipts: tenant business profile + receipt settings (idempotent)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tax_id" varchar(50);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "brn" varchar(50);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "website" varchar(255);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "receipt_settings" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "pos_profiles" ADD COLUMN IF NOT EXISTS "receipt_settings" jsonb NOT NULL DEFAULT '{}'::jsonb;
