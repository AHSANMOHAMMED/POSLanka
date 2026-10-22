-- Non-functional hardening (2026-10): PayHere activation guard + shared audit-run state.
-- payhere_transactions.activated_at is set in the same database transaction that applies a
-- successful payment (renewal / upgrade / wallet debit) or after the company it pays for was
-- created. A payment recorded as `success` with activated_at NULL means activation failed and
-- is retried by the next PayHere notification and the enforce-subscriptions cron.
-- Idempotent.
ALTER TABLE payhere_transactions ADD COLUMN IF NOT EXISTS activated_at timestamp;
--> statement-breakpoint
-- Payments that succeeded before this column existed were activated by the old code path.
UPDATE payhere_transactions SET activated_at = COALESCE(paid_at, updated_at)
WHERE status = 'success' AND activated_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payhere_transactions_unactivated
  ON payhere_transactions (updated_at) WHERE status = 'success' AND activated_at IS NULL;
--> statement-breakpoint
-- System audit progress (src/lib/audit/runner.ts) moves out of process memory so every app
-- instance sees the same run and only one audit per tenant runs at a time.
CREATE TABLE IF NOT EXISTS audit_runs (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'idle',
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON audit_runs;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON audit_runs FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON audit_runs;
--> statement-breakpoint
CREATE POLICY platform_login_access ON audit_runs FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON audit_runs TO app_user;
  END IF;
END $$;
