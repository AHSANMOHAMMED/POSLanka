-- Recycle bin (2026-10): vendors can no longer permanently delete important records.
--  * master data (items, customers, suppliers, ...) is archived: is_active=false + a recycle_bin row
--  * disposable drafts keep their hard delete but leave a snapshot (row + child rows) in the bin
--  * only a super admin restores (undo) or purges (permanent delete)
--  * customers had no active flag: customers.is_active (archived customers are hidden everywhere)
-- Idempotent.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS recycle_bin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type varchar(50) NOT NULL,
  entity_table varchar(63) NOT NULL,
  entity_id uuid NOT NULL,
  display_name varchar(255),
  mode varchar(10) NOT NULL,
  snapshot jsonb,
  children jsonb,
  deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_by_name varchar(255),
  deleted_at timestamp NOT NULL DEFAULT now(),
  restored_at timestamp,
  restored_by uuid,
  purged_at timestamp,
  purged_by uuid
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE recycle_bin ADD CONSTRAINT recycle_bin_mode_check CHECK (mode IN ('archive', 'delete'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recycle_bin_tenant_deleted ON recycle_bin (tenant_id, deleted_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recycle_bin_entity ON recycle_bin (tenant_id, entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_recycle_bin_open ON recycle_bin (entity_id) WHERE restored_at IS NULL AND purged_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customers_tenant_active ON customers (tenant_id) WHERE is_active = false;
--> statement-breakpoint
ALTER TABLE recycle_bin ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recycle_bin FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_policy ON recycle_bin;
--> statement-breakpoint
CREATE POLICY tenant_isolation_policy ON recycle_bin FOR ALL TO public
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_login_access ON recycle_bin;
--> statement-breakpoint
CREATE POLICY platform_login_access ON recycle_bin FOR ALL TO public
  USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
  WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON recycle_bin TO app_user;
  END IF;
END $$;
