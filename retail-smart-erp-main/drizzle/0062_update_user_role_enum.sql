-- Migration to add missing values to user_role enum
-- The enum currently has 4 values: 'owner', 'manager', 'cashier', 'technician'
-- We need to add 10 more values to match the Drizzle schema and TypeScript UserRole type

-- Add missing values in a logical order
ALTER TYPE "public"."user_role" ADD VALUE 'chef' AFTER 'technician';
ALTER TYPE "public"."user_role" ADD VALUE 'waiter' AFTER 'chef';
ALTER TYPE "public"."user_role" ADD VALUE 'system_manager' AFTER 'waiter';
ALTER TYPE "public"."user_role" ADD VALUE 'accounts_manager' AFTER 'system_manager';
ALTER TYPE "public"."user_role" ADD VALUE 'sales_manager' AFTER 'accounts_manager';
ALTER TYPE "public"."user_role" ADD VALUE 'purchase_manager' AFTER 'sales_manager';
ALTER TYPE "public"."user_role" ADD VALUE 'hr_manager' AFTER 'purchase_manager';
ALTER TYPE "public"."user_role" ADD VALUE 'stock_manager' AFTER 'hr_manager';
ALTER TYPE "public"."user_role" ADD VALUE 'pos_user' AFTER 'stock_manager';
ALTER TYPE "public"."user_role" ADD VALUE 'report_user' AFTER 'pos_user';