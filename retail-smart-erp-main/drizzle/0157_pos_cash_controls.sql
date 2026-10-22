-- H1: POS cash control and server-side sale enforcement.
--  * pos_cash_movements: cash paid in / paid out of the drawer during an open shift
--  * pos_approval_uses: single-use ledger of supervisor approval tokens (nonce per tenant)
--  * sales.approved_by / sales.voided_by, sale_items.list_price (catalog price at sale time)
--  * pos_closing_entries.variance_reason / variance_note / report_data (Z-report snapshot)
--  * at most one open shift per user and per POS profile (counter / drawer)
-- Idempotent.
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  movement_no varchar(30) NOT NULL,
  opening_entry_id uuid NOT NULL REFERENCES pos_opening_entries(id),
  pos_profile_id uuid REFERENCES pos_profiles(id),
  type varchar(20) NOT NULL,                   -- 'paid_in' | 'paid_out'
  category varchar(30) NOT NULL,               -- petty_expense | supplier_payment | bank_drop | float_top_up | other
  amount numeric(15,2) NOT NULL,
  account_id uuid REFERENCES chart_of_accounts(id),
  note text,
  status varchar(20) NOT NULL DEFAULT 'posted', -- 'posted' | 'voided'
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  voided_at timestamp,
  voided_by uuid REFERENCES users(id),
  void_reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT pos_cash_movements_type_chk CHECK (type IN ('paid_in', 'paid_out')),
  CONSTRAINT pos_cash_movements_amount_chk CHECK (amount > 0),
  CONSTRAINT pos_cash_movements_status_chk CHECK (status IN ('posted', 'voided'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pos_cash_movements_shift_idx ON pos_cash_movements (tenant_id, opening_entry_id);
--> statement-breakpoint
ALTER TABLE pos_cash_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pos_cash_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_cash_movements;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON pos_cash_movements FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON pos_cash_movements;
--> statement-breakpoint
CREATE POLICY platform_login_access ON pos_cash_movements FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON pos_cash_movements TO app_user;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pos_approval_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nonce varchar(64) NOT NULL,
  scopes text NOT NULL,                        -- comma-separated scopes the token was used for
  approver_id uuid NOT NULL REFERENCES users(id),
  used_by uuid REFERENCES users(id),
  entity_type varchar(50) NOT NULL,            -- 'sale' | 'pos_cash_movement'
  entity_id uuid,
  used_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS pos_approval_uses_nonce_uq ON pos_approval_uses (tenant_id, nonce);
--> statement-breakpoint
ALTER TABLE pos_approval_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pos_approval_uses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON pos_approval_uses;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON pos_approval_uses FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON pos_approval_uses;
--> statement-breakpoint
CREATE POLICY platform_login_access ON pos_approval_uses FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON pos_approval_uses TO app_user;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS list_price numeric(12,2);
--> statement-breakpoint
ALTER TABLE pos_closing_entries ADD COLUMN IF NOT EXISTS variance_reason varchar(50);
--> statement-breakpoint
ALTER TABLE pos_closing_entries ADD COLUMN IF NOT EXISTS variance_note text;
--> statement-breakpoint
ALTER TABLE pos_closing_entries ADD COLUMN IF NOT EXISTS report_data jsonb;
--> statement-breakpoint
-- One open shift per user and one per POS profile (counter / drawer). The API checks first;
-- these partial unique indexes are the backstop against races. If existing data already has
-- duplicates the index is skipped with a NOTICE (close or cancel the extra shifts and re-run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'pos_opening_entries_one_open_per_user') THEN
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM pos_opening_entries WHERE status = 'open'
    GROUP BY tenant_id, user_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'pos_opening_entries has users with more than one open shift; unique index pos_opening_entries_one_open_per_user not created';
  ELSE
    CREATE UNIQUE INDEX pos_opening_entries_one_open_per_user
      ON pos_opening_entries (tenant_id, user_id) WHERE status = 'open';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'pos_opening_entries_one_open_per_profile') THEN
    NULL;
  ELSIF EXISTS (
    SELECT 1 FROM pos_opening_entries WHERE status = 'open'
    GROUP BY tenant_id, pos_profile_id HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'pos_opening_entries has POS profiles with more than one open shift; unique index pos_opening_entries_one_open_per_profile not created';
  ELSE
    CREATE UNIQUE INDEX pos_opening_entries_one_open_per_profile
      ON pos_opening_entries (tenant_id, pos_profile_id) WHERE status = 'open';
  END IF;
END $$;
