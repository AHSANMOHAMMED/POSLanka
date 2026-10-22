-- Super-admin console: platform admin management, single-use impersonation links and
-- vendor broadcasts (in-app / account portal / email) with delivery history.
-- Idempotent: every statement can run again safely.

-- 1) Platform admins: admin-enforced two-factor, forced password change after a reset,
--    and when the account was deactivated.
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS totp_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS deactivated_at timestamp;
--> statement-breakpoint

-- 2) Impersonation ("open as owner") links: one row per issued token (jti). The vendor
--    sign-in consumes it with a single conditional UPDATE, so a link works exactly once.
CREATE TABLE IF NOT EXISTS admin_impersonation_tokens (
  jti uuid PRIMARY KEY,
  super_admin_id uuid REFERENCES super_admins(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  used_ip varchar(45),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admin_impersonation_tokens_expires_idx ON admin_impersonation_tokens (expires_at);
--> statement-breakpoint

-- 3) Broadcasts sent from the console (notifications and emails) and their per-recipient delivery.
CREATE TABLE IF NOT EXISTS platform_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(20) NOT NULL DEFAULT 'notification',          -- notification | email
  super_admin_id uuid REFERENCES super_admins(id) ON DELETE SET NULL,
  title varchar(255) NOT NULL,
  body text NOT NULL,
  link varchar(500),
  category varchar(30) NOT NULL DEFAULT 'info',             -- info | maintenance | billing | feature | warning
  channels text[] NOT NULL DEFAULT '{}',                     -- in_app | account | email
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,               -- filters used to pick vendors / addresses
  recipient_scope varchar(20) NOT NULL DEFAULT 'owners',     -- owners | all_staff
  status varchar(20) NOT NULL DEFAULT 'sending',             -- sending | sent | partial | failed
  vendor_count integer NOT NULL DEFAULT 0,
  in_app_count integer NOT NULL DEFAULT 0,
  account_count integer NOT NULL DEFAULT 0,
  email_sent integer NOT NULL DEFAULT 0,
  email_logged integer NOT NULL DEFAULT 0,                    -- email transport not configured: written to the server log
  email_failed integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_broadcasts_kind_created_idx ON platform_broadcasts (kind, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS platform_broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES platform_broadcasts(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  vendor_name varchar(255),
  email varchar(255),
  in_app_count integer NOT NULL DEFAULT 0,
  account_count integer NOT NULL DEFAULT 0,
  email_status varchar(20),                                  -- sent | logged | failed | skipped | NULL (no email)
  error text,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_broadcast_recipients_broadcast_idx ON platform_broadcast_recipients (broadcast_id);
--> statement-breakpoint

-- 4) Audit-log filters (vendor, action, date) on a growing table.
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admin_audit_logs_resource_id_idx ON admin_audit_logs (resource_id);
--> statement-breakpoint

-- 5) Platform-only tables: tenant code (the app role) never reads or writes them.
--    The columns are named vendor_id (not tenant_id) because rows are not tenant-owned data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE ALL ON admin_impersonation_tokens, platform_broadcasts, platform_broadcast_recipients FROM app_user;
  END IF;
END $$;
