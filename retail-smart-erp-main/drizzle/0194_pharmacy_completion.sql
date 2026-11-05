-- Pharmacy completion (2026-11): patient safety notes, dosage instructions on dispensed lines,
-- and lookups for the patient medication history.
--  * customers.allergies / medical_notes: shown as a warning at the POS when the customer is picked
--    (pharmacies only; NULL for everyone else, nothing changes for other business types)
--  * sale_items.dosage_instructions: "1 tablet 3 times a day after meals" for the dispensing label
--  * prescription photos / scans live in the files table (attached_to_type = 'prescription')
--  * the controlled-drug register is derived from stock_movements + prescriptions (no new stock data)
-- Additive and idempotent.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS allergies text;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN IF NOT EXISTS medical_notes text;
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS dosage_instructions varchar(255);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_customer ON prescriptions (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_patient_phone ON prescriptions (tenant_id, patient_phone) WHERE patient_phone IS NOT NULL;
