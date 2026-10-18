-- Migration: Purchase Order / Invoice Workflow Improvements
-- This migration:
-- 1. Moves supplierInvoiceNo and supplierBillDate from purchase_orders to purchases
-- 2. Adds paymentTerm to purchases to distinguish cash vs credit purchases
-- 3. Updates purchase_order_status enum for estimate-like workflow

-- Step 1: Add new columns to purchases table
ALTER TABLE "purchases" ADD COLUMN "supplier_invoice_no" varchar(100);--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "supplier_bill_date" date;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "payment_term" varchar(20) DEFAULT 'cash';--> statement-breakpoint

-- Step 2: Remove columns from purchase_orders (they belong on the invoice)
ALTER TABLE "purchase_orders" DROP COLUMN IF EXISTS "supplier_invoice_no";--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP COLUMN IF EXISTS "supplier_bill_date";--> statement-breakpoint

-- Step 3: Update purchase_order_status enum to match estimate workflow
-- Current: draft, pending_approval, approved, ordered, partially_received, received, cancelled
-- New: draft, submitted, confirmed, invoice_created, cancelled
-- We need to rename the existing enum values

-- First add the new values
ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'submitted';--> statement-breakpoint
ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'confirmed';--> statement-breakpoint
ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'invoice_created';--> statement-breakpoint

-- Convert existing data to new statuses
UPDATE "purchase_orders" SET status = 'submitted' WHERE status = 'pending_approval';--> statement-breakpoint
UPDATE "purchase_orders" SET status = 'confirmed' WHERE status = 'approved';--> statement-breakpoint
UPDATE "purchase_orders" SET status = 'confirmed' WHERE status = 'ordered';--> statement-breakpoint
UPDATE "purchase_orders" SET status = 'invoice_created' WHERE status = 'partially_received';--> statement-breakpoint
UPDATE "purchase_orders" SET status = 'invoice_created' WHERE status = 'received';
