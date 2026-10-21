ALTER TABLE "pos_profile_payment_methods" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "chart_of_accounts"("id");
