-- Add grandfather pricing columns to subscriptions
-- When a user subscribes, their price is locked in. If admin later changes
-- the tier price, existing subscribers keep their old (grandfathered) price.

ALTER TABLE subscriptions
  ADD COLUMN subscribed_price_monthly DECIMAL(10,2),
  ADD COLUMN subscribed_price_yearly DECIMAL(10,2),
  ADD COLUMN price_locked_at TIMESTAMP;

-- Backfill: snapshot current tier prices for all existing subscriptions
UPDATE subscriptions s
SET
  subscribed_price_monthly = p.price_monthly,
  subscribed_price_yearly = p.price_yearly,
  price_locked_at = NOW()
FROM pricing_tiers p
WHERE s.tier_id = p.id;
