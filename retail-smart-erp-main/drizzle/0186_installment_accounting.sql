-- 0186 (2026-10): hire purchase accounting (src/lib/installments/posting.ts).
--  * installment_schedule.interest_paid / principal_paid: the interest / principal each row has
--    received, stored (not derived) so a receipt voided or bounced out of order takes off exactly
--    what it posted to the ledger. Backfilled with the old derivation (interest first).
--  * installment_payments: void (voided_at / voided_by / void_reason), the cheque it was paid by
--    (cheque_id → cheques register), gl_mode: 'voucher' = posted as voucher installment_payment,
--    'legacy' = principal posted on the sale's payment voucher before 0186, NULL = not posted.
--  * installment_plans: receivable_account_id (where the financed principal sits: Accounts
--    Receivable for a plan from a credit sale, Installment Receivable for a hand-registered one),
--    opening_agreement (carried over from paper books: no revenue), written_off_amount,
--    recovered_value, repossession (details of goods taken back).
-- Idempotent. RLS on these tables comes from 0181.
ALTER TABLE installment_schedule ADD COLUMN IF NOT EXISTS interest_paid numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE installment_schedule ADD COLUMN IF NOT EXISTS principal_paid numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE installment_schedule
   SET interest_paid = LEAST(interest, paid_amount),
       principal_paid = GREATEST(0, paid_amount - LEAST(interest, paid_amount))
 WHERE paid_amount > 0 AND interest_paid + principal_paid <> paid_amount;
--> statement-breakpoint
ALTER TABLE installment_payments ADD COLUMN IF NOT EXISTS voided_at timestamp;
--> statement-breakpoint
ALTER TABLE installment_payments ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE installment_payments ADD COLUMN IF NOT EXISTS void_reason text;
--> statement-breakpoint
ALTER TABLE installment_payments ADD COLUMN IF NOT EXISTS cheque_id uuid REFERENCES cheques(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE installment_payments ADD COLUMN IF NOT EXISTS gl_mode varchar(10);
--> statement-breakpoint
UPDATE installment_payments SET gl_mode = 'legacy' WHERE gl_mode IS NULL AND sale_payment_id IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE installment_payments ADD CONSTRAINT installment_payments_gl_mode_check
    CHECK (gl_mode IS NULL OR gl_mode IN ('voucher', 'legacy'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_installment_payments_cheque ON installment_payments (cheque_id) WHERE cheque_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS receivable_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS opening_agreement boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS written_off_amount numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS recovered_value numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE installment_plans ADD COLUMN IF NOT EXISTS repossession jsonb;
