-- 0036: Billing Overhaul
-- Adds locked status, PayHere transactions, lockout events, exchange rate cache
-- Updates pricing model to storage-only differentiation

-- ==================== ENUM CHANGES ====================

-- Add 'locked' to tenant_status enum
ALTER TYPE "tenant_status" ADD VALUE IF NOT EXISTS 'locked';

-- Add 'locked' to subscription_status enum
ALTER TYPE "subscription_status" ADD VALUE IF NOT EXISTS 'locked';

-- PayHere transaction status enum
DO $$ BEGIN
  CREATE TYPE "payhere_transaction_status" AS ENUM ('pending', 'success', 'failed', 'cancelled', 'refunded', 'charged_back');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Lockout event type enum
DO $$ BEGIN
  CREATE TYPE "lockout_event_type" AS ENUM (
    'trial_expiring', 'trial_expired', 'storage_warning', 'storage_critical',
    'subscription_expiring', 'subscription_expired',
    'locked', 'deletion_warning', 'deleted', 'unlocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================== TABLE MODIFICATIONS ====================

-- Add lockout columns to tenants table
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "locked_at" TIMESTAMP;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "locked_reason" VARCHAR(50);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "deletion_scheduled_at" TIMESTAMP;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "last_warning_sent_at" TIMESTAMP;

-- Add PayHere columns to subscriptions table
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payhere_subscription_id" VARCHAR(100);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "last_payment_at" TIMESTAMP;

-- ==================== NEW TABLES ====================

-- PayHere transactions - tracks all PayHere payments
CREATE TABLE IF NOT EXISTS "payhere_transactions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL REFERENCES "accounts"("id"),
  "subscription_id" UUID REFERENCES "subscriptions"("id"),
  "pending_company_id" UUID REFERENCES "pending_companies"("id"),
  "order_id" VARCHAR(100) NOT NULL UNIQUE,
  "payhere_payment_id" VARCHAR(100),
  "amount" DECIMAL(12, 2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'LKR',
  "status" "payhere_transaction_status" NOT NULL DEFAULT 'pending',
  "payment_method" VARCHAR(50),
  "description" TEXT,
  "period_months" INTEGER NOT NULL DEFAULT 1,
  "billing_cycle" VARCHAR(20) DEFAULT 'monthly',
  "status_code" VARCHAR(10),
  "status_message" TEXT,
  "md5sig" VARCHAR(100),
  "card_holder_name" VARCHAR(255),
  "card_no" VARCHAR(20),
  "paid_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Lockout events - audit trail for lockout lifecycle
CREATE TABLE IF NOT EXISTS "lockout_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_type" "lockout_event_type" NOT NULL,
  "details" JSONB DEFAULT '{}',
  "notification_sent" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Exchange rate cache - server-side rate storage
CREATE TABLE IF NOT EXISTS "exchange_rate_cache" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "base_currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "rates" JSONB NOT NULL DEFAULT '{}',
  "source" VARCHAR(50),
  "fetched_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMP NOT NULL
);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS "idx_payhere_transactions_account" ON "payhere_transactions"("account_id");
CREATE INDEX IF NOT EXISTS "idx_payhere_transactions_subscription" ON "payhere_transactions"("subscription_id");
CREATE INDEX IF NOT EXISTS "idx_payhere_transactions_status" ON "payhere_transactions"("status");
CREATE INDEX IF NOT EXISTS "idx_payhere_transactions_order_id" ON "payhere_transactions"("order_id");

CREATE INDEX IF NOT EXISTS "idx_lockout_events_tenant" ON "lockout_events"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lockout_events_type" ON "lockout_events"("event_type");
CREATE INDEX IF NOT EXISTS "idx_lockout_events_created" ON "lockout_events"("created_at");

CREATE INDEX IF NOT EXISTS "idx_tenants_locked_at" ON "tenants"("locked_at") WHERE "locked_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_tenants_deletion_scheduled" ON "tenants"("deletion_scheduled_at") WHERE "deletion_scheduled_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_exchange_rate_cache_base" ON "exchange_rate_cache"("base_currency");
CREATE INDEX IF NOT EXISTS "idx_exchange_rate_cache_expires" ON "exchange_rate_cache"("expires_at");

-- ==================== UPDATE PRICING TIERS ====================

-- Update existing tiers or insert new ones with storage-only differentiation
-- All features included on ALL plans, only storage differs

-- Deduplicate pricing_tiers: keep the one with an active subscription reference, or the oldest
DELETE FROM "pricing_tiers" WHERE "id" IN (
  SELECT p."id" FROM "pricing_tiers" p
  WHERE p."id" NOT IN (
    -- Keep tiers referenced by subscriptions
    SELECT DISTINCT "tier_id" FROM "subscriptions"
    UNION
    -- Keep tiers referenced by pending companies
    SELECT DISTINCT "tier_id" FROM "pending_companies"
  )
  AND EXISTS (
    SELECT 1 FROM "pricing_tiers" p2
    WHERE p2."name" = p."name" AND p2."id" < p."id"
  )
);

-- If there are still duplicates (both referenced), keep the older one
DELETE FROM "pricing_tiers" WHERE "id" IN (
  SELECT p."id" FROM "pricing_tiers" p
  WHERE EXISTS (
    SELECT 1 FROM "pricing_tiers" p2
    WHERE p2."name" = p."name" AND p2."created_at" < p."created_at"
  )
  AND p."id" NOT IN (SELECT DISTINCT "tier_id" FROM "subscriptions")
  AND p."id" NOT IN (SELECT DISTINCT "tier_id" FROM "pending_companies")
);

-- Add unique constraint on name for pricing tiers (needed for ON CONFLICT)
DO $$ BEGIN
  ALTER TABLE "pricing_tiers" ADD CONSTRAINT "pricing_tiers_name_unique" UNIQUE ("name");
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN duplicate_object THEN NULL;
END $$;

-- First, deactivate all existing tiers
UPDATE "pricing_tiers" SET "is_active" = false;

-- Upsert Trial tier
INSERT INTO "pricing_tiers" ("name", "display_name", "price_monthly", "price_yearly", "currency", "max_users", "max_sales_monthly", "max_database_bytes", "max_file_storage_bytes", "features", "is_active", "sort_order")
VALUES ('trial', 'Trial', 0, 0, 'LKR', NULL, NULL, 83886080, 104857600, '{"allFeaturesIncluded": true}', true, 0)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "price_monthly" = EXCLUDED."price_monthly",
  "price_yearly" = EXCLUDED."price_yearly",
  "max_users" = EXCLUDED."max_users",
  "max_sales_monthly" = EXCLUDED."max_sales_monthly",
  "max_database_bytes" = EXCLUDED."max_database_bytes",
  "max_file_storage_bytes" = EXCLUDED."max_file_storage_bytes",
  "features" = EXCLUDED."features",
  "is_active" = true,
  "sort_order" = EXCLUDED."sort_order";

-- Upsert Starter tier
INSERT INTO "pricing_tiers" ("name", "display_name", "price_monthly", "price_yearly", "currency", "max_users", "max_sales_monthly", "max_database_bytes", "max_file_storage_bytes", "features", "is_active", "sort_order")
VALUES ('starter', 'Starter', 1990, 19900, 'LKR', NULL, NULL, 524288000, 524288000, '{"allFeaturesIncluded": true}', true, 1)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "price_monthly" = EXCLUDED."price_monthly",
  "price_yearly" = EXCLUDED."price_yearly",
  "max_users" = EXCLUDED."max_users",
  "max_sales_monthly" = EXCLUDED."max_sales_monthly",
  "max_database_bytes" = EXCLUDED."max_database_bytes",
  "max_file_storage_bytes" = EXCLUDED."max_file_storage_bytes",
  "features" = EXCLUDED."features",
  "is_active" = true,
  "sort_order" = EXCLUDED."sort_order";

-- Upsert Professional tier
INSERT INTO "pricing_tiers" ("name", "display_name", "price_monthly", "price_yearly", "currency", "max_users", "max_sales_monthly", "max_database_bytes", "max_file_storage_bytes", "features", "is_active", "sort_order")
VALUES ('professional', 'Professional', 4990, 49900, 'LKR', NULL, NULL, 3221225472, 2147483648, '{"allFeaturesIncluded": true}', true, 2)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "price_monthly" = EXCLUDED."price_monthly",
  "price_yearly" = EXCLUDED."price_yearly",
  "max_users" = EXCLUDED."max_users",
  "max_sales_monthly" = EXCLUDED."max_sales_monthly",
  "max_database_bytes" = EXCLUDED."max_database_bytes",
  "max_file_storage_bytes" = EXCLUDED."max_file_storage_bytes",
  "features" = EXCLUDED."features",
  "is_active" = true,
  "sort_order" = EXCLUDED."sort_order";

-- Upsert Business tier
INSERT INTO "pricing_tiers" ("name", "display_name", "price_monthly", "price_yearly", "currency", "max_users", "max_sales_monthly", "max_database_bytes", "max_file_storage_bytes", "features", "is_active", "sort_order")
VALUES ('business', 'Business', 9990, 99900, 'LKR', NULL, NULL, 10737418240, 5368709120, '{"allFeaturesIncluded": true}', true, 3)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "price_monthly" = EXCLUDED."price_monthly",
  "price_yearly" = EXCLUDED."price_yearly",
  "max_users" = EXCLUDED."max_users",
  "max_sales_monthly" = EXCLUDED."max_sales_monthly",
  "max_database_bytes" = EXCLUDED."max_database_bytes",
  "max_file_storage_bytes" = EXCLUDED."max_file_storage_bytes",
  "features" = EXCLUDED."features",
  "is_active" = true,
  "sort_order" = EXCLUDED."sort_order";

-- Upsert Enterprise tier
INSERT INTO "pricing_tiers" ("name", "display_name", "price_monthly", "price_yearly", "currency", "max_users", "max_sales_monthly", "max_database_bytes", "max_file_storage_bytes", "features", "is_active", "sort_order")
VALUES ('enterprise', 'Enterprise', 24990, 249900, 'LKR', NULL, NULL, 53687091200, 26843545600, '{"allFeaturesIncluded": true}', true, 4)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "price_monthly" = EXCLUDED."price_monthly",
  "price_yearly" = EXCLUDED."price_yearly",
  "max_users" = EXCLUDED."max_users",
  "max_sales_monthly" = EXCLUDED."max_sales_monthly",
  "max_database_bytes" = EXCLUDED."max_database_bytes",
  "max_file_storage_bytes" = EXCLUDED."max_file_storage_bytes",
  "features" = EXCLUDED."features",
  "is_active" = true,
  "sort_order" = EXCLUDED."sort_order";

