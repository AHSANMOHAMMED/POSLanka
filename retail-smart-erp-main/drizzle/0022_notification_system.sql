-- SMS Settings (per tenant)
CREATE TABLE sms_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  provider VARCHAR(50) NOT NULL DEFAULT 'none', -- 'none', 'websms_lk', 'twilio', 'generic_http'
  is_enabled BOOLEAN NOT NULL DEFAULT false,

  -- WebSMS.lk / Newsletters.lk
  websms_api_key VARCHAR(255),
  websms_api_token VARCHAR(255),
  websms_sender_id VARCHAR(20),

  -- Twilio
  twilio_account_sid VARCHAR(100),
  twilio_auth_token VARCHAR(255),
  twilio_phone_number VARCHAR(20),

  -- Generic HTTP Gateway
  generic_api_url VARCHAR(500),
  generic_method VARCHAR(10) DEFAULT 'POST',
  generic_headers JSONB DEFAULT '{}',
  generic_body_template TEXT,
  generic_auth_type VARCHAR(20), -- 'none', 'basic', 'bearer', 'api_key'
  generic_auth_value VARCHAR(255),

  daily_limit INTEGER DEFAULT 500,
  monthly_limit INTEGER DEFAULT 10000,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(tenant_id)
);

-- Email Settings (per tenant)
CREATE TABLE email_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  provider VARCHAR(50) NOT NULL DEFAULT 'none', -- 'none', 'smtp', 'sendgrid', 'resend'
  is_enabled BOOLEAN NOT NULL DEFAULT false,

  from_name VARCHAR(100),
  from_email VARCHAR(255),
  reply_to_email VARCHAR(255),

  -- SMTP (Nodemailer)
  smtp_host VARCHAR(255),
  smtp_port INTEGER DEFAULT 587,
  smtp_secure BOOLEAN DEFAULT true,
  smtp_user VARCHAR(255),
  smtp_password VARCHAR(255),

  -- SendGrid
  sendgrid_api_key VARCHAR(255),

  -- Resend
  resend_api_key VARCHAR(255),

  daily_limit INTEGER DEFAULT 500,
  monthly_limit INTEGER DEFAULT 10000,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(tenant_id)
);

-- Notification Templates
CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  channel VARCHAR(20) NOT NULL, -- 'sms', 'email', 'both'

  -- Auto-trigger settings
  trigger_event VARCHAR(100), -- 'work_order.created', 'appointment.reminder', etc.
  is_auto_trigger BOOLEAN DEFAULT false,

  -- SMS content
  sms_content TEXT,

  -- Email content
  email_subject VARCHAR(255),
  email_body TEXT,

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Notification Logs (message history)
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  channel VARCHAR(20) NOT NULL, -- 'sms', 'email'
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'

  -- Recipient info
  recipient_type VARCHAR(50), -- 'customer', 'supplier', 'staff', 'manual'
  recipient_id UUID,
  recipient_name VARCHAR(255),
  recipient_contact VARCHAR(255) NOT NULL, -- phone number or email

  -- Message content
  template_id UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
  subject VARCHAR(255), -- for emails
  content TEXT NOT NULL,

  -- Related entity
  entity_type VARCHAR(50), -- 'work_order', 'appointment', 'sale', etc.
  entity_id UUID,
  entity_reference VARCHAR(50), -- work order number, invoice number, etc.

  -- Provider response
  provider VARCHAR(50),
  provider_message_id VARCHAR(255),
  provider_response JSONB,
  error_message TEXT,

  -- Cost tracking
  cost DECIMAL(10, 4) DEFAULT 0,
  segments INTEGER DEFAULT 1, -- SMS segments

  -- Timestamps
  sent_by UUID REFERENCES users(id),
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Usage Tracking (monthly aggregates)
CREATE TABLE notification_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL, -- 'sms', 'email'
  period_month DATE NOT NULL, -- First day of month
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_cost DECIMAL(10, 2) DEFAULT 0,
  UNIQUE(tenant_id, channel, period_month)
);

-- Indexes for performance
CREATE INDEX idx_notification_logs_tenant_date ON notification_logs(tenant_id, created_at DESC);
CREATE INDEX idx_notification_logs_status ON notification_logs(tenant_id, status);
CREATE INDEX idx_notification_logs_channel ON notification_logs(tenant_id, channel);
CREATE INDEX idx_notification_logs_recipient ON notification_logs(tenant_id, recipient_contact);
CREATE INDEX idx_notification_templates_tenant ON notification_templates(tenant_id);
CREATE INDEX idx_notification_templates_trigger ON notification_templates(tenant_id, trigger_event) WHERE is_auto_trigger = true;
CREATE INDEX idx_notification_usage_tenant_period ON notification_usage(tenant_id, period_month);

-- Enable Row Level Security
ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies (tenant isolation)
CREATE POLICY tenant_isolation_sms_settings ON sms_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_email_settings ON email_settings
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_notification_templates ON notification_templates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_notification_logs ON notification_logs
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_notification_usage ON notification_usage
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
