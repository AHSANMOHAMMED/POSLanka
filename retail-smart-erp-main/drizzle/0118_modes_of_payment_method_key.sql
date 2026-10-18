-- Add method_key column to modes_of_payment for POS payment method lookup
-- method_key maps directly to POS payment method strings: 'cash', 'card', 'bank_transfer', etc.

ALTER TABLE modes_of_payment ADD COLUMN IF NOT EXISTS method_key VARCHAR(30);

-- Populate method_key for existing standard modes based on name patterns
UPDATE modes_of_payment SET method_key = 'cash' WHERE method_key IS NULL AND LOWER(name) = 'cash';
UPDATE modes_of_payment SET method_key = 'card' WHERE method_key IS NULL AND LOWER(name) IN ('credit card', 'card', 'debit card');
UPDATE modes_of_payment SET method_key = 'bank_transfer' WHERE method_key IS NULL AND LOWER(name) IN ('bank transfer', 'bank', 'wire transfer');
UPDATE modes_of_payment SET method_key = 'cheque' WHERE method_key IS NULL AND LOWER(name) IN ('cheque', 'check');
UPDATE modes_of_payment SET method_key = 'mobile_payment' WHERE method_key IS NULL AND LOWER(name) IN ('mobile payment', 'mobile', 'mobile money');
UPDATE modes_of_payment SET method_key = 'gift_card' WHERE method_key IS NULL AND LOWER(name) IN ('gift card', 'giftcard');
UPDATE modes_of_payment SET method_key = 'credit' WHERE method_key IS NULL AND LOWER(name) IN ('store credit', 'credit');

-- Unique index: one method_key per tenant (prevents duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_modes_of_payment_tenant_method_key
  ON modes_of_payment(tenant_id, method_key) WHERE method_key IS NOT NULL;
