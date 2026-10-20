-- Push notification device registry (tenant users, account owners, super admins)
CREATE TABLE IF NOT EXISTS "user_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" uuid REFERENCES "accounts"("id") ON DELETE CASCADE,
  "super_admin_id" uuid REFERENCES "super_admins"("id") ON DELETE CASCADE,
  "push_token" varchar(255) NOT NULL,
  "platform" varchar(20) NOT NULL DEFAULT 'android',
  "device_name" varchar(255),
  "app_version" varchar(50),
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_devices_token" ON "user_devices" ("push_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_devices_tenant_user" ON "user_devices" ("tenant_id", "user_id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_devices" TO app_user;
--> statement-breakpoint
-- Super admin TOTP two-factor authentication
ALTER TABLE "super_admins" ADD COLUMN IF NOT EXISTS "totp_secret" text;
--> statement-breakpoint
ALTER TABLE "super_admins" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean NOT NULL DEFAULT false;
