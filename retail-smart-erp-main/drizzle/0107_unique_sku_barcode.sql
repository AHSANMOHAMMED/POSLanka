-- Add unique constraints on SKU and barcode per tenant
-- Uses partial unique indexes (WHERE ... IS NOT NULL AND ... != '')
-- so that null/empty values don't conflict

CREATE UNIQUE INDEX IF NOT EXISTS items_tenant_sku_unique
  ON items (tenant_id, sku)
  WHERE sku IS NOT NULL AND sku != '';

CREATE UNIQUE INDEX IF NOT EXISTS items_tenant_barcode_unique
  ON items (tenant_id, barcode)
  WHERE barcode IS NOT NULL AND barcode != '';
