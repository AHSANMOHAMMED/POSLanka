-- Add Cash Over/Short account setting for POS shift closing GL posting
ALTER TABLE accounting_settings
ADD COLUMN IF NOT EXISTS default_cash_over_short_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
