-- Tax Template Integration: connect tax templates to items and transactions
-- Adds per-item tax template assignment and per-transaction tax breakdown storage

-- Items: assign a tax template to each item
ALTER TABLE items ADD COLUMN IF NOT EXISTS tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- Accounting Settings: default tax template for items without one
ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS default_tax_template_id UUID REFERENCES tax_templates(id) ON DELETE SET NULL;

-- Sale Items: store which template was used and the breakdown
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS tax_template_id UUID;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Sales: aggregated tax breakdown across all items
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Work Orders: aggregated tax breakdown
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Restaurant Orders: aggregated tax breakdown
ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS tax_breakdown JSONB;

-- Performance index for item → tax template lookup
CREATE INDEX IF NOT EXISTS idx_items_tax_template_id ON items(tax_template_id) WHERE tax_template_id IS NOT NULL;

-- RLS policies for new columns are automatically covered by existing table-level policies
