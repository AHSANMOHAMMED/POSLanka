-- Per-tenant AI consent: allow tenants to opt-in/out of AI features
-- Default false = privacy-safe (existing tenants start with AI disabled)

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_consent_accepted_at timestamp;
