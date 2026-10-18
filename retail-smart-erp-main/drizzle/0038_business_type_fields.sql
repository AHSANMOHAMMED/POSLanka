-- Add chef and waiter roles
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'chef';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'waiter';

-- Restaurant fields for items
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "preparation_time" integer;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "allergens" jsonb;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "calories" integer;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "is_vegetarian" boolean NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "is_vegan" boolean NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "is_gluten_free" boolean NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "spice_level" varchar(20);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "available_from" time;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "available_to" time;

-- Supermarket fields for items
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "plu_code" varchar(20);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_life_days" integer;
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "storage_temp" varchar(20);
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "expiry_date" date;
