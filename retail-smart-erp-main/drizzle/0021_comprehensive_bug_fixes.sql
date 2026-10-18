-- Migration: Comprehensive Bug Fixes
-- Addresses: STW-8, AEW-3, RC-12 from codebase audit

-- ==================== STOCK TRANSFERS ====================

-- Add 'rejected' status to stock_transfer_status enum
-- Note: PostgreSQL doesn't allow IF NOT EXISTS for enum values directly
-- We need to check if the value exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'rejected'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'stock_transfer_status')
  ) THEN
    ALTER TYPE stock_transfer_status ADD VALUE 'rejected';
  END IF;
END
$$;

-- Add rejection tracking fields to stock_transfers (STW-8)
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT;

-- Add constraint to ensure received quantity doesn't exceed transferred quantity (STW-2)
-- Note: This is handled at application level due to partial receive workflows

-- ==================== INSURANCE ESTIMATES ====================

-- Add workOrderIds array for tracking multiple partial conversions (AEW-3)
ALTER TABLE insurance_estimates
  ADD COLUMN IF NOT EXISTS work_order_ids UUID[] DEFAULT '{}';

-- ==================== PAYMENTS ====================

-- Add void tracking fields (RC-12)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ==================== INDEXES ====================

-- Index for finding estimates by work order
CREATE INDEX IF NOT EXISTS idx_insurance_estimates_work_order_ids
  ON insurance_estimates USING GIN (work_order_ids);

-- Index for rejected transfers
CREATE INDEX IF NOT EXISTS idx_stock_transfers_rejected_at
  ON stock_transfers (rejected_at) WHERE rejected_at IS NOT NULL;

-- ==================== RLS UPDATES ====================

-- The new columns are covered by existing tenant-based RLS policies
-- No additional RLS changes needed
