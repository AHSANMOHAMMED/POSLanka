-- Add ERPNext-style SMS gateway parameters
ALTER TABLE sms_settings
ADD COLUMN IF NOT EXISTS generic_message_param VARCHAR(50) DEFAULT 'text',
ADD COLUMN IF NOT EXISTS generic_recipient_param VARCHAR(50) DEFAULT 'to',
ADD COLUMN IF NOT EXISTS generic_static_params JSONB DEFAULT '[]';

-- Add comment explaining the new fields
COMMENT ON COLUMN sms_settings.generic_message_param IS 'Parameter name for message content (e.g., text, message, msg)';
COMMENT ON COLUMN sms_settings.generic_recipient_param IS 'Parameter name for phone number (e.g., to, mobile, phone)';
COMMENT ON COLUMN sms_settings.generic_static_params IS 'Array of {key, value} objects for static parameters like API key, sender ID';
