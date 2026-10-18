-- Migration: Add partial receiving statuses to purchase_order_status enum
-- This adds 'partially_received' and 'fully_received' statuses for tracking receiving progress

-- Add new enum values for receiving workflow
ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'partially_received' AFTER 'confirmed';--> statement-breakpoint
ALTER TYPE "purchase_order_status" ADD VALUE IF NOT EXISTS 'fully_received' AFTER 'partially_received';
