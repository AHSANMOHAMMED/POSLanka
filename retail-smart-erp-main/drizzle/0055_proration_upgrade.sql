-- Add new_tier_id to payhere_transactions for tracking tier changes during upgrade payments
ALTER TABLE "payhere_transactions" ADD COLUMN "new_tier_id" uuid REFERENCES "pricing_tiers"("id");

-- Add wallet_credit_applied to track partial wallet deductions before PayHere payment
ALTER TABLE "payhere_transactions" ADD COLUMN "wallet_credit_applied" numeric(12, 2) DEFAULT '0';
