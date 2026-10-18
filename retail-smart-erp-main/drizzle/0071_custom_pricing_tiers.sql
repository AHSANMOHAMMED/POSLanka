-- Allow pricing tiers to have null prices (for "Custom" / "Contact Us" tiers)
ALTER TABLE pricing_tiers ALTER COLUMN price_monthly DROP NOT NULL;
ALTER TABLE pricing_tiers ALTER COLUMN price_yearly DROP NOT NULL;
