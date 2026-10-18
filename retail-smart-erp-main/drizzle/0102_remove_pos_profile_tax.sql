-- Migration: Remove tax_rate and tax_inclusive from pos_profiles
-- Tax settings now live on the tenants table (tenants.tax_rate, tenants.tax_inclusive)

ALTER TABLE "pos_profiles" DROP COLUMN IF EXISTS "tax_rate";
ALTER TABLE "pos_profiles" DROP COLUMN IF EXISTS "tax_inclusive";
