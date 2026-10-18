-- AI Intelligence Layer: Error Logging + Alerts
-- Creates ai_error_logs and ai_alerts tables with RLS

-- Enums
DO $$ BEGIN
  CREATE TYPE "ai_log_level" AS ENUM ('error', 'warning', 'info');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ai_alert_type" AS ENUM ('anomaly', 'insight', 'error', 'suggestion');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ai_alert_severity" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AI Error Logs table (tenantId nullable for system-wide errors)
CREATE TABLE IF NOT EXISTS "ai_error_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id"),
  "level" "ai_log_level" NOT NULL DEFAULT 'error',
  "source" varchar(255) NOT NULL,
  "message" text NOT NULL,
  "stack" text,
  "context" jsonb,
  "ai_analysis" text,
  "ai_suggestion" text,
  "group_hash" varchar(64),
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- AI Alerts table
CREATE TABLE IF NOT EXISTS "ai_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "type" "ai_alert_type" NOT NULL,
  "severity" "ai_alert_severity" NOT NULL DEFAULT 'medium',
  "title" varchar(255) NOT NULL,
  "message" text NOT NULL,
  "entity_type" varchar(50),
  "entity_id" uuid,
  "metadata" jsonb,
  "read_at" timestamp,
  "dismissed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "ai_error_logs_tenant_idx" ON "ai_error_logs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ai_error_logs_level_idx" ON "ai_error_logs" ("level");
CREATE INDEX IF NOT EXISTS "ai_error_logs_created_at_idx" ON "ai_error_logs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_error_logs_group_hash_idx" ON "ai_error_logs" ("group_hash");

CREATE INDEX IF NOT EXISTS "ai_alerts_tenant_idx" ON "ai_alerts" ("tenant_id");
CREATE INDEX IF NOT EXISTS "ai_alerts_type_idx" ON "ai_alerts" ("type");
CREATE INDEX IF NOT EXISTS "ai_alerts_created_at_idx" ON "ai_alerts" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_alerts_unread_idx" ON "ai_alerts" ("tenant_id", "read_at") WHERE "read_at" IS NULL;

-- RLS for ai_error_logs (tenant-scoped logs only)
ALTER TABLE "ai_error_logs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_error_logs_tenant_isolation" ON "ai_error_logs";
CREATE POLICY "ai_error_logs_tenant_isolation" ON "ai_error_logs"
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- RLS for ai_alerts
ALTER TABLE "ai_alerts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_alerts_tenant_isolation" ON "ai_alerts";
CREATE POLICY "ai_alerts_tenant_isolation" ON "ai_alerts"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
