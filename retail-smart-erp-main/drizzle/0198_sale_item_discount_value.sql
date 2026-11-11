-- Per-item POS discount input value (percentage e.g. 10, or fixed amount e.g. 500.00).
-- sale_items.discount stores the computed currency discount subtracted on the line;
-- discount_type ('percentage' | 'fixed') and discount_value let receipts and sales details show
-- the exact percentage or fixed discount that produced it. Additive and idempotent.
ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "discount_value" numeric(12, 2);
