-- Lifetime one-time pricing alongside monthly/yearly.
ALTER TABLE "pricing_tiers" ADD COLUMN IF NOT EXISTS "price_lifetime" numeric(10, 2);

COMMENT ON COLUMN "pricing_tiers"."price_lifetime" IS 'One-time lifetime plan price; NULL means not offered';
COMMENT ON COLUMN "subscriptions"."billing_cycle" IS 'monthly | yearly | lifetime';
