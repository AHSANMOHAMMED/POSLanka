-- Add Work In Progress (WIP) account tracking for work orders
-- This enables GL posting when parts/services are added to work orders

ALTER TABLE accounting_settings
ADD COLUMN IF NOT EXISTS default_wip_account_id UUID REFERENCES chart_of_accounts(id);

-- Add RLS policy for the new column (accounting_settings already has RLS)
-- No additional RLS needed as it inherits from the table policy
