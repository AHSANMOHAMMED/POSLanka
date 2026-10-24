-- SMS & WhatsApp as a paid platform add-on (2026-10).
--  * messaging_subscriptions: one row per vendor, managed in the super-admin console. Channels on/off,
--    sender mask, prepaid credits or a monthly quota, price per message (invoicing info), expiry,
--    "use own SMS provider" (the vendor's sms_settings instead of the platform account), and the
--    owner's low-stock alert phone. Credits / quota are decremented atomically by sendMessage().
--  * messaging_credit_ledger: every top-up / adjustment / refund with the admin who made it.
--  * notification_logs.billed_via ('platform' | 'own') and purpose ('sale_receipt', ...).
-- Platform provider credentials live in system_settings['messaging_providers'] (secrets encrypted).
-- Idempotent.
CREATE TABLE IF NOT EXISTS messaging_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  sms_enabled boolean NOT NULL DEFAULT false,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  use_own_sms_provider boolean NOT NULL DEFAULT false,
  sender_mask varchar(11),
  billing_mode varchar(20) NOT NULL DEFAULT 'prepaid',
  sms_monthly_quota integer NOT NULL DEFAULT 0,
  whatsapp_monthly_quota integer NOT NULL DEFAULT 0,
  sms_credits integer NOT NULL DEFAULT 0,
  whatsapp_credits integer NOT NULL DEFAULT 0,
  period_month date,
  sms_used_period integer NOT NULL DEFAULT 0,
  whatsapp_used_period integer NOT NULL DEFAULT 0,
  sms_price numeric(10, 2) NOT NULL DEFAULT 0,
  whatsapp_price numeric(10, 2) NOT NULL DEFAULT 0,
  expires_at date,
  alert_phone varchar(30),
  low_stock_channel varchar(20) NOT NULL DEFAULT 'off',
  notes text,
  updated_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT messaging_subscriptions_billing_mode_check CHECK (billing_mode IN ('prepaid', 'monthly_quota')),
  CONSTRAINT messaging_subscriptions_low_stock_check CHECK (low_stock_channel IN ('off', 'sms', 'whatsapp')),
  CONSTRAINT messaging_subscriptions_credits_check CHECK (sms_credits >= 0 AND whatsapp_credits >= 0),
  CONSTRAINT messaging_subscriptions_quota_check CHECK (sms_monthly_quota >= 0 AND whatsapp_monthly_quota >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS messaging_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel varchar(20) NOT NULL,
  change integer NOT NULL,
  balance_after integer NOT NULL,
  reason varchar(30) NOT NULL,
  amount_paid numeric(12, 2),
  note text,
  admin_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT messaging_credit_ledger_channel_check CHECK (channel IN ('sms', 'whatsapp'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messaging_credit_ledger_tenant ON messaging_credit_ledger (tenant_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS billed_via varchar(20);
--> statement-breakpoint
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS purpose varchar(40);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant_channel_created ON notification_logs (tenant_id, channel, created_at DESC);
--> statement-breakpoint
ALTER TABLE messaging_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messaging_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON messaging_subscriptions;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON messaging_subscriptions FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON messaging_subscriptions;
--> statement-breakpoint
CREATE POLICY platform_login_access ON messaging_subscriptions FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON messaging_subscriptions TO app_user;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE messaging_credit_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messaging_credit_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON messaging_credit_ledger;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON messaging_credit_ledger FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON messaging_credit_ledger;
--> statement-breakpoint
CREATE POLICY platform_login_access ON messaging_credit_ledger FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON messaging_credit_ledger TO app_user;
  END IF;
END $$;
