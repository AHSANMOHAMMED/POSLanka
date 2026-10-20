-- Migration to add missing values to user_role enum
-- The enum currently has 4 values: 'owner', 'manager', 'cashier', 'technician'
-- We need to add 10 more values to match the Drizzle schema and TypeScript UserRole type

-- Add missing values in a logical order
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'chef' AFTER 'technician';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'waiter' AFTER 'chef';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'system_manager' AFTER 'waiter';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'accounts_manager' AFTER 'system_manager';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'sales_manager' AFTER 'accounts_manager';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'purchase_manager' AFTER 'sales_manager';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'hr_manager' AFTER 'purchase_manager';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'stock_manager' AFTER 'hr_manager';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'pos_user' AFTER 'stock_manager';
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'report_user' AFTER 'pos_user';