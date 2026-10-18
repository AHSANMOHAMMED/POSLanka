-- Add 'fully_paid' to layaway_status enum
-- This separates "all payments received" from "completion workflow done"
-- so that the proper completion flow (sale creation, stock deduction) still runs
ALTER TYPE "layaway_status" ADD VALUE IF NOT EXISTS 'fully_paid' AFTER 'active';
