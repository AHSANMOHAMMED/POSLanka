-- Unified Tax Template System: Add tax template columns to all document tables
-- This enables ERPNext-style unified tax handling across all transaction types

-- =====================================================
-- HEADER-LEVEL: Add tax_breakdown + tax_template_id
-- =====================================================

-- Purchases
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- Purchase Orders
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- Sales Orders
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- Layaways
ALTER TABLE layaways ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;
ALTER TABLE layaways ADD COLUMN IF NOT EXISTS tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- Supplier Quotations
ALTER TABLE supplier_quotations ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;
ALTER TABLE supplier_quotations ADD COLUMN IF NOT EXISTS tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- Insurance Estimates
ALTER TABLE insurance_estimates ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;
ALTER TABLE insurance_estimates ADD COLUMN IF NOT EXISTS tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- =====================================================
-- LINE-ITEM LEVEL: Add tax_rate, tax_amount, tax_template_id, tax_breakdown
-- =====================================================

-- Purchase Items (has existing `tax` column for flat amounts — kept for backward compat)
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) NOT NULL DEFAULT '0';
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15,2) NOT NULL DEFAULT '0';
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS tax_template_id UUID;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Purchase Order Items (has existing `tax` column — kept for backward compat)
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) NOT NULL DEFAULT '0';
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15,2) NOT NULL DEFAULT '0';
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_template_id UUID;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Sales Order Items (already has tax_rate + tax_amount, add template + breakdown)
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS tax_template_id UUID;
ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Layaway Items (currently has NO tax columns at all)
ALTER TABLE layaway_items ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) NOT NULL DEFAULT '0';
ALTER TABLE layaway_items ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15,2) NOT NULL DEFAULT '0';
ALTER TABLE layaway_items ADD COLUMN IF NOT EXISTS tax_template_id UUID;
ALTER TABLE layaway_items ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Supplier Quotation Items (has existing `tax` column — kept for backward compat)
ALTER TABLE supplier_quotation_items ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) NOT NULL DEFAULT '0';
ALTER TABLE supplier_quotation_items ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(15,2) NOT NULL DEFAULT '0';
ALTER TABLE supplier_quotation_items ADD COLUMN IF NOT EXISTS tax_template_id UUID;
ALTER TABLE supplier_quotation_items ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- =====================================================
-- ACCOUNTING SETTINGS: Separate default purchase tax template
-- =====================================================

ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_purchase_tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- =====================================================
-- PERFORMANCE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_purchases_tax_template_id ON purchases(tax_template_id) WHERE tax_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tax_template_id ON purchase_orders(tax_template_id) WHERE tax_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_orders_tax_template_id ON sales_orders(tax_template_id) WHERE tax_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_layaways_tax_template_id ON layaways(tax_template_id) WHERE tax_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insurance_estimates_tax_template_id ON insurance_estimates(tax_template_id) WHERE tax_template_id IS NOT NULL;

-- RLS: New columns on existing RLS-enabled tables are automatically covered by table-level policies
