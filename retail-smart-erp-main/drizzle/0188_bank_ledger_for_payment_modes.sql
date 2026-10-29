-- 0188 (2026-10): card / bank transfer / cheque payments failed with "Cannot post to group account(s):
-- Bank Accounts" in shops whose payment modes (or default bank account) pointed at the "Bank Accounts"
-- GROUP account (new-shop seeding linked them to group #1120). For every such group: use its first
-- ledger child, or create a "Main Bank Account" ledger under it, and repoint
--   modes_of_payment.default_account_id, accounting_settings.default_bank_account_id and
--   pos_profile_payment_methods.account_id from the group to that ledger. Idempotent.
DO $$
DECLARE
  g RECORD;
  leaf uuid;
  num text;
BEGIN
  FOR g IN
    SELECT DISTINCT c.id, c.tenant_id, c.account_number, c.root_type, c.account_type
    FROM chart_of_accounts c
    WHERE c.is_group AND (
      c.id IN (SELECT default_account_id FROM modes_of_payment WHERE default_account_id IS NOT NULL)
      OR c.id IN (SELECT default_bank_account_id FROM accounting_settings WHERE default_bank_account_id IS NOT NULL)
      OR c.id IN (SELECT account_id FROM pos_profile_payment_methods WHERE account_id IS NOT NULL)
    )
  LOOP
    SELECT x.id INTO leaf FROM chart_of_accounts x
    WHERE x.parent_id = g.id AND NOT x.is_group AND x.tenant_id = g.tenant_id
    ORDER BY x.account_number NULLS LAST, x.created_at
    LIMIT 1;

    IF leaf IS NULL THEN
      -- next free number after the group's (1120 -> 1121, 1122, ...)
      num := NULL;
      IF g.account_number ~ '^[0-9]+$' THEN
        FOR i IN 1..50 LOOP
          IF NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE tenant_id = g.tenant_id AND account_number = (g.account_number::bigint + i)::text) THEN
            num := (g.account_number::bigint + i)::text;
            EXIT;
          END IF;
        END LOOP;
      END IF;
      INSERT INTO chart_of_accounts (tenant_id, name, account_number, parent_id, root_type, account_type, is_group, is_system_account)
      VALUES (g.tenant_id, 'Main Bank Account', COALESCE(num, COALESCE(g.account_number, 'BANK') || '-1'), g.id, g.root_type, g.account_type, false, false)
      RETURNING id INTO leaf;
    END IF;

    UPDATE modes_of_payment SET default_account_id = leaf WHERE default_account_id = g.id;
    UPDATE accounting_settings SET default_bank_account_id = leaf WHERE default_bank_account_id = g.id;
    UPDATE pos_profile_payment_methods SET account_id = leaf WHERE account_id = g.id;
  END LOOP;
END $$;
