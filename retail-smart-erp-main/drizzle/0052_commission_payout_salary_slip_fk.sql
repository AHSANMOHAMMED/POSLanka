-- Add salary_slip_id FK to commission_payouts for bidirectional link
ALTER TABLE commission_payouts ADD COLUMN IF NOT EXISTS salary_slip_id uuid;
