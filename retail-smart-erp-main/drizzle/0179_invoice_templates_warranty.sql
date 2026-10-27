-- 0179: Zoho-style invoice template designer + quotation units/tax/warranty + sale-line warranty.
-- Idempotent (production is live).

-- Full template designer settings (see src/lib/print/invoice-template.ts, InvoiceTemplateConfig)
ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Quotation lines: unit sold, per-line tax rate and warranty
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS uom varchar(20);
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS uom_factor numeric(14,6) NOT NULL DEFAULT 1;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS warranty_months integer;

-- Sale lines: warranty captured at sale time (items.warranty_months, sale date + months)
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS warranty_months integer;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS warranty_until date;
