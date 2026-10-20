-- W1 staff accounts: enforce one active user per email per tenant.
-- Idempotent. Creates the unique index only when no duplicates exist;
-- otherwise emits a NOTICE listing them so they can be cleaned up manually.
-- staff_invites needs no column changes: warehouseIds / posProfileIds are
-- carried inside the existing tenant_assignments jsonb.
DO $$
DECLARE
  dup RECORD;
  dup_count integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'users_tenant_email_active_unique'
  ) THEN
    RAISE NOTICE 'users_tenant_email_active_unique already exists, skipping';
    RETURN;
  END IF;

  FOR dup IN
    SELECT tenant_id, lower(email) AS email_lc, count(*) AS n,
           string_agg(id::text, ', ') AS user_ids
    FROM users
    WHERE is_active = true
    GROUP BY tenant_id, lower(email)
    HAVING count(*) > 1
  LOOP
    dup_count := dup_count + 1;
    RAISE NOTICE 'Duplicate active user email: tenant=% email=% count=% user_ids=[%]',
      dup.tenant_id, dup.email_lc, dup.n, dup.user_ids;
  END LOOP;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Skipped creating users_tenant_email_active_unique: % duplicate group(s) found. Resolve them and re-run this migration.', dup_count;
  ELSE
    CREATE UNIQUE INDEX users_tenant_email_active_unique
      ON users (tenant_id, lower(email))
      WHERE is_active = true;
  END IF;
END $$;
