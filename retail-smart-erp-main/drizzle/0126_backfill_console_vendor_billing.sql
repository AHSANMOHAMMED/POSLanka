-- Vendors created from the super-admin console before this fix had no billing
-- account, membership, subscription or usage row. Backfill them from the owner user.
DO $$
DECLARE
  t RECORD;
  acc_id uuid;
  trial_tier uuid;
BEGIN
  SELECT id INTO trial_tier FROM pricing_tiers WHERE name = 'trial' LIMIT 1;
  IF trial_tier IS NULL THEN
    RAISE NOTICE 'no trial pricing tier; backfill skipped';
    RETURN;
  END IF;

  FOR t IN
    SELECT tn.id AS tenant_id, tn.slug, tn.country, tn.currency,
           u.id AS user_id, lower(u.email) AS email, u.full_name, u.password_hash, u.account_id
    FROM tenants tn
    JOIN LATERAL (
      SELECT * FROM users WHERE users.tenant_id = tn.id AND users.role = 'owner' ORDER BY created_at LIMIT 1
    ) u ON true
    WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = tn.id)
  LOOP
    acc_id := t.account_id;
    IF acc_id IS NULL THEN
      SELECT id INTO acc_id FROM accounts WHERE lower(email) = t.email LIMIT 1;
    END IF;
    IF acc_id IS NULL THEN
      INSERT INTO accounts (email, password_hash, full_name, phone, country, currency, email_verified, is_active)
      VALUES (t.email, t.password_hash, t.full_name,
              'unset-' || t.slug || '-' || substr(md5(random()::text), 1, 8),
              COALESCE(t.country, 'LK'), COALESCE(t.currency, 'LKR'), true, true)
      RETURNING id INTO acc_id;
    END IF;

    UPDATE users SET account_id = acc_id WHERE id = t.user_id AND account_id IS NULL;
    UPDATE tenants SET primary_owner_id = acc_id WHERE id = t.tenant_id AND primary_owner_id IS NULL;

    INSERT INTO account_tenants (account_id, tenant_id, role, is_owner, accepted_at)
    SELECT acc_id, t.tenant_id, 'owner', true, now()
    WHERE NOT EXISTS (SELECT 1 FROM account_tenants WHERE account_id = acc_id AND tenant_id = t.tenant_id);

    INSERT INTO subscriptions (tenant_id, billing_account_id, tier_id, status, current_period_start, current_period_end, billing_cycle)
    VALUES (t.tenant_id, acc_id, trial_tier, 'trial', now(), '2099-12-31', 'monthly');

    INSERT INTO tenant_usage (tenant_id) VALUES (t.tenant_id) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
