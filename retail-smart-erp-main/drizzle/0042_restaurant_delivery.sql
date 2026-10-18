-- Migration: Add delivery fields to restaurant_orders
-- Supports delivery order type with address, driver, status tracking

-- Create delivery status enum
DO $$ BEGIN
  CREATE TYPE "delivery_status" AS ENUM ('pending','dispatched','in_transit','delivered','failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add delivery columns to restaurant_orders
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "delivery_address" text;
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "delivery_phone" varchar(50);
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "delivery_notes" text;
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "driver_name" varchar(255);
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "driver_phone" varchar(50);
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "estimated_delivery_time" timestamp;
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "actual_delivery_time" timestamp;
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "delivery_status" delivery_status DEFAULT 'pending';
ALTER TABLE "restaurant_orders" ADD COLUMN IF NOT EXISTS "delivery_fee" decimal(12,2) DEFAULT '0';
