-- Add hold_stock field to insurance_estimates table
-- When enabled, items in the estimate will be reserved from available stock

ALTER TABLE "insurance_estimates" ADD COLUMN "hold_stock" boolean DEFAULT false NOT NULL;
