-- Migration 0030: Comprehensive Audit Fixes
-- Adds missing columns, constraints, and indexes identified in codebase audit

-- ============================================================
-- 1. UNIQUE constraint on warehouse_stock (Issue #65)
-- Prevents duplicate stock records for same warehouse+item+tenant
-- ============================================================

-- Deduplicate existing rows first (keep the one with highest stock)
DELETE FROM warehouse_stock ws1
USING warehouse_stock ws2
WHERE ws1.warehouse_id = ws2.warehouse_id
  AND ws1.item_id = ws2.item_id
  AND ws1.tenant_id = ws2.tenant_id
  AND ws1.id < ws2.id
  AND CAST(ws1.current_stock AS DECIMAL) <= CAST(ws2.current_stock AS DECIMAL);

-- Now create the unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_stock_unique
  ON warehouse_stock(warehouse_id, item_id, tenant_id);

-- ============================================================
-- 2. Add cancellation fields to layaways (Issue #102)
-- ============================================================
ALTER TABLE layaways ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE layaways ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

-- ============================================================
-- 3. Add cancellation fields to core_returns (Issue #105)
-- ============================================================
ALTER TABLE core_returns ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE core_returns ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

-- ============================================================
-- 4. Add cancellation fields to restaurant_orders (Issue #106)
-- ============================================================
ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

-- ============================================================
-- 5. Add cost fields to stock_transfer_items (Issue #72)
-- ============================================================
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,2) DEFAULT 0;
ALTER TABLE stock_transfer_items ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10,2) DEFAULT 0;

-- ============================================================
-- 6. Add 'partial' to sale_status enum (Issue #13)
-- ============================================================
ALTER TYPE sale_status ADD VALUE IF NOT EXISTS 'partial' BEFORE 'completed';

-- ============================================================
-- 7. Add tax settings to tenants (Issue #30, #60)
-- Used by work orders, estimates, and legacy POS for tax calculation
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 8. Enable RLS on new columns (maintain existing RLS policies)
-- ============================================================
-- No new tables added, only new columns on existing RLS-enabled tables.
-- Existing RLS policies already cover these tables.
