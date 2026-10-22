-- Platform-admin roles, promo codes applied at checkout, PayHere refunds and phone push for
-- console broadcasts. Idempotent: every statement can run again safely.

-- 1) Platform-admin roles (src/lib/admin/roles.ts). Existing admins become owners.
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'owner';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'super_admins_role_check') THEN
    ALTER TABLE super_admins ADD CONSTRAINT super_admins_role_check CHECK (role IN ('owner', 'support', 'billing', 'viewer'));
  END IF;
END $$;
--> statement-breakpoint

-- 2) Promo codes applied when a vendor pays. The discount is stored on the payment; the use is
--    counted (coupon_redemptions + coupon_codes.used_count) only when the card payment succeeds,
--    the wallet is charged or the bank slip is approved. One redemption per payment (unique).
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES coupon_codes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS coupon_code varchar(50);
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS list_amount numeric(12,2);
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE payment_deposits ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES coupon_codes(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE payment_deposits ADD COLUMN IF NOT EXISTS coupon_code varchar(50);
--> statement-breakpoint
ALTER TABLE payment_deposits ADD COLUMN IF NOT EXISTS list_amount numeric(12,2);
--> statement-breakpoint
ALTER TABLE payment_deposits ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid REFERENCES coupon_codes(id) ON DELETE SET NULL,
  coupon_code varchar(50) NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source varchar(20) NOT NULL,                                -- payhere | wallet | bank_deposit
  payhere_transaction_id uuid UNIQUE REFERENCES payhere_transactions(id) ON DELETE SET NULL,
  payment_deposit_id uuid UNIQUE REFERENCES payment_deposits(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  list_amount numeric(12,2) NOT NULL,
  discount_amount numeric(12,2) NOT NULL,
  paid_amount numeric(12,2) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_account_idx ON coupon_redemptions (coupon_id, account_id);
--> statement-breakpoint

-- 3) PayHere refunds made from the console (Refund API). refund_status: processing (request in
--    flight / claimed), refunded, failed. The claim (NULL/failed → processing) is a conditional
--    UPDATE, so a double click cannot refund twice.
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refund_status varchar(20);
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2);
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refund_reference varchar(100);
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refund_reason text;
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refund_error text;
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refund_requested_at timestamp;
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refunded_at timestamp;
--> statement-breakpoint
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS refunded_by uuid REFERENCES super_admins(id) ON DELETE SET NULL;
--> statement-breakpoint

-- 4) Console broadcasts: phone push (Expo) totals and per-recipient push delivery.
ALTER TABLE platform_broadcasts ADD COLUMN IF NOT EXISTS push_scope varchar(20);
--> statement-breakpoint
ALTER TABLE platform_broadcasts ADD COLUMN IF NOT EXISTS push_sent integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE platform_broadcasts ADD COLUMN IF NOT EXISTS push_failed integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE platform_broadcasts ADD COLUMN IF NOT EXISTS push_no_device integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE platform_broadcast_recipients ADD COLUMN IF NOT EXISTS push_status varchar(20);
--> statement-breakpoint
ALTER TABLE platform_broadcast_recipients ADD COLUMN IF NOT EXISTS push_sent integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE platform_broadcast_recipients ADD COLUMN IF NOT EXISTS push_failed integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- 5) Platform-only table: tenant code (the app role) never reads or writes it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE ALL ON coupon_redemptions FROM app_user;
  END IF;
END $$;
