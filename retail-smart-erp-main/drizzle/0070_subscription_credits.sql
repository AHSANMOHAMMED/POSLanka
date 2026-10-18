-- Account Subscription Credits
-- Stores remaining subscription/trial time when a company is deleted mid-plan.
-- Applied to the user's next company creation.
CREATE TABLE IF NOT EXISTS account_subscription_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  tier_id UUID NOT NULL REFERENCES pricing_tiers(id),
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
  type VARCHAR(20) NOT NULL DEFAULT 'trial',
  remaining_days INTEGER NOT NULL,
  original_end TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  used_at TIMESTAMP,
  used_tenant_id UUID
);
