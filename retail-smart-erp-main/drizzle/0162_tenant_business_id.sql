-- Business ID: a short, permanent, human-friendly identifier for each vendor (e.g. PL482913).
-- Staff type it at sign-in (web and mobile) instead of the URL slug, and it is shown on the
-- vendor's settings, receipts and the super-admin console. Every insert path gets one from the
-- column default, so no application code has to remember to generate it. Idempotent.

-- SECURITY DEFINER: the uniqueness probe must see every tenant, not just the caller's RLS view.
CREATE OR REPLACE FUNCTION generate_business_id() RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  candidate varchar;
BEGIN
  LOOP
    candidate := 'PL' || lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE business_id = candidate);
  END LOOP;
  RETURN candidate;
END $$;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_id varchar(12);
UPDATE tenants SET business_id = generate_business_id() WHERE business_id IS NULL;
ALTER TABLE tenants ALTER COLUMN business_id SET DEFAULT generate_business_id();
ALTER TABLE tenants ALTER COLUMN business_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_business_id_unique ON tenants (business_id);

-- Permanent: staff, receipts and printed material refer to it, so it never changes once issued.
CREATE OR REPLACE FUNCTION tenants_keep_business_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    NEW.business_id := OLD.business_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_keep_business_id ON tenants;
CREATE TRIGGER trg_tenants_keep_business_id
  BEFORE UPDATE OF business_id ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_keep_business_id();
