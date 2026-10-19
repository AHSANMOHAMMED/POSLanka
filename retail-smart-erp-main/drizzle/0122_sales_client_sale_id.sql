-- Add client_sale_id to sales for offline POS idempotency
ALTER TABLE "sales" ADD COLUMN "client_sale_id" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_sales_tenant_client_sale" ON "sales" ("tenant_id", "client_sale_id") WHERE "client_sale_id" IS NOT NULL;
