-- Migration: Storage-based pricing with LKR-only billing
-- Adds storage limit columns, billing cycle, and seeds 4 LKR pricing tiers

-- 1. Add storage columns to pricing_tiers
ALTER TABLE pricing_tiers ADD COLUMN IF NOT EXISTS max_database_bytes BIGINT;
ALTER TABLE pricing_tiers ADD COLUMN IF NOT EXISTS max_file_storage_bytes BIGINT;

-- 2. Add override/billing columns to subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS override_database_bytes BIGINT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS override_file_storage_bytes BIGINT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) DEFAULT 'monthly';

-- 3. Fix tenant_usage storage columns to BIGINT (they may already be BIGINT in DB)
-- Only alter if they are currently integer type
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenant_usage' AND column_name = 'storage_bytes' AND data_type = 'integer'
  ) THEN
    ALTER TABLE tenant_usage ALTER COLUMN storage_bytes TYPE BIGINT;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenant_usage' AND column_name = 'file_storage_bytes' AND data_type = 'integer'
  ) THEN
    ALTER TABLE tenant_usage ALTER COLUMN file_storage_bytes TYPE BIGINT;
  END IF;
END $$;

-- 4. Change default currency for pricing_tiers to LKR
ALTER TABLE pricing_tiers ALTER COLUMN currency SET DEFAULT 'LKR';

-- 5. Create storage_alerts table
CREATE TABLE IF NOT EXISTS storage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  alert_type VARCHAR(20) NOT NULL,
  sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
  acknowledged_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_storage_alerts_tenant ON storage_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_storage_alerts_type ON storage_alerts(tenant_id, alert_type);

-- 6. Deactivate old tiers (basic, standard, premium) - keep trial
UPDATE pricing_tiers SET is_active = false WHERE name IN ('basic', 'standard', 'premium');

-- 7. Seed new LKR pricing tiers
-- Trial tier (update existing or insert)
INSERT INTO pricing_tiers (name, display_name, price_monthly, price_yearly, currency, max_users, max_sales_monthly, max_database_bytes, max_file_storage_bytes, features, is_active, sort_order)
VALUES (
  'trial', 'Free Trial', 0, 0, 'LKR', NULL, NULL,
  83886080, 209715200,  -- 80 MB database, 200 MB files
  '{"basicPOS": true, "inventory": true, "reports": true, "workOrders": true, "multiLocation": false, "insuranceEstimates": true, "advancedReports": false, "apiAccess": false, "prioritySupport": false}',
  true, 0
)
ON CONFLICT (id) DO NOTHING;

-- Starter: LKR 1,990/mo, 19,900/yr, 500MB DB, 500MB files, 1 location
INSERT INTO pricing_tiers (name, display_name, price_monthly, price_yearly, currency, max_users, max_sales_monthly, max_database_bytes, max_file_storage_bytes, features, is_active, sort_order)
VALUES (
  'starter', 'Starter', 1990.00, 19900.00, 'LKR', NULL, NULL,
  524288000, 524288000,  -- 500 MB each
  '{"basicPOS": true, "inventory": true, "reports": true, "workOrders": true, "multiLocation": false, "insuranceEstimates": true, "advancedReports": false, "apiAccess": false, "prioritySupport": false, "locations": 1, "supportType": "email"}',
  true, 1
);

-- Professional: LKR 4,990/mo, 49,900/yr, 3GB DB, 2GB files, up to 5 locations
INSERT INTO pricing_tiers (name, display_name, price_monthly, price_yearly, currency, max_users, max_sales_monthly, max_database_bytes, max_file_storage_bytes, features, is_active, sort_order)
VALUES (
  'professional', 'Professional', 4990.00, 49900.00, 'LKR', NULL, NULL,
  3221225472, 2147483648,  -- 3 GB DB, 2 GB files
  '{"basicPOS": true, "inventory": true, "reports": true, "workOrders": true, "multiLocation": true, "insuranceEstimates": true, "advancedReports": true, "apiAccess": false, "prioritySupport": true, "locations": 5, "supportType": "email_chat"}',
  true, 2
);

-- Business: LKR 9,990/mo, 99,900/yr, 10GB DB, 5GB files, up to 15 locations
INSERT INTO pricing_tiers (name, display_name, price_monthly, price_yearly, currency, max_users, max_sales_monthly, max_database_bytes, max_file_storage_bytes, features, is_active, sort_order)
VALUES (
  'business', 'Business', 9990.00, 99900.00, 'LKR', NULL, NULL,
  10737418240, 5368709120,  -- 10 GB DB, 5 GB files
  '{"basicPOS": true, "inventory": true, "reports": true, "workOrders": true, "multiLocation": true, "insuranceEstimates": true, "advancedReports": true, "apiAccess": true, "prioritySupport": true, "locations": 15, "supportType": "phone_chat"}',
  true, 3
);

-- Enterprise: LKR 24,990/mo, 249,900/yr, 50GB DB, 25GB files, unlimited locations
INSERT INTO pricing_tiers (name, display_name, price_monthly, price_yearly, currency, max_users, max_sales_monthly, max_database_bytes, max_file_storage_bytes, features, is_active, sort_order)
VALUES (
  'enterprise', 'Enterprise', 24990.00, 249900.00, 'LKR', NULL, NULL,
  53687091200, 26843545600,  -- 50 GB DB, 25 GB files
  '{"basicPOS": true, "inventory": true, "reports": true, "workOrders": true, "multiLocation": true, "insuranceEstimates": true, "advancedReports": true, "apiAccess": true, "prioritySupport": true, "locations": -1, "supportType": "dedicated_manager", "customReports": true}',
  true, 4
);
