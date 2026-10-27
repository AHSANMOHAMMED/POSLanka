-- 0187 (2026-10): cash collected outside the POS sale screen reaches the cashier's drawer / shift.
--  * payments.pos_opening_entry_id: the open shift of the user who took the money, for payments
--    on invoices raised outside the POS (print-job "deliver & invoice", work-order invoice). POS
--    sales keep using sales.pos_opening_entry_id; carried-over advance rows stay NULL (they were
--    counted in the shift that received them).
--  * print_job_payments.pos_opening_entry_id (advance taken) and refund_pos_opening_entry_id
--    (advance handed back on cancel).
--  * layaway_payments.pos_opening_entry_id (deposits / instalments).
-- NULL = no open shift at the time (recorded without a shift). Totalled by
-- src/lib/pos/shift-collections.ts into the shift's expected amounts and Z report. Idempotent.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS pos_opening_entry_id uuid REFERENCES pos_opening_entries(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE print_job_payments ADD COLUMN IF NOT EXISTS pos_opening_entry_id uuid REFERENCES pos_opening_entries(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE print_job_payments ADD COLUMN IF NOT EXISTS refund_pos_opening_entry_id uuid REFERENCES pos_opening_entries(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE layaway_payments ADD COLUMN IF NOT EXISTS pos_opening_entry_id uuid REFERENCES pos_opening_entries(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payments_shift_idx ON payments (tenant_id, pos_opening_entry_id) WHERE pos_opening_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS print_job_payments_shift_idx ON print_job_payments (tenant_id, pos_opening_entry_id) WHERE pos_opening_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS print_job_payments_refund_shift_idx ON print_job_payments (tenant_id, refund_pos_opening_entry_id) WHERE refund_pos_opening_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS layaway_payments_shift_idx ON layaway_payments (tenant_id, pos_opening_entry_id) WHERE pos_opening_entry_id IS NOT NULL;
