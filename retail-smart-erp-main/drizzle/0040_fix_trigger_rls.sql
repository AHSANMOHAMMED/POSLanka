-- Migration 0039: Fix trigger functions to bypass RLS
-- The tenant_usage trigger functions insert into an RLS-protected table,
-- but they fire before app.tenant_id can be set (e.g., during tenant creation).
-- SECURITY DEFINER makes them run as the function owner (postgres), bypassing RLS.

CREATE OR REPLACE FUNCTION update_tenant_usage_count()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  column_name TEXT;
  delta INTEGER;
  target_tenant_id UUID;
BEGIN
  column_name := TG_TABLE_NAME || '_count';

  IF TG_OP = 'INSERT' THEN
    target_tenant_id := NEW.tenant_id;
    delta := 1;
  ELSIF TG_OP = 'DELETE' THEN
    target_tenant_id := OLD.tenant_id;
    delta := -1;
  ELSE
    RETURN NULL;
  END IF;

  IF target_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO tenant_usage (tenant_id)
  VALUES (target_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  EXECUTE format(
    'UPDATE tenant_usage SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE tenant_id = $2',
    column_name, column_name
  ) USING delta, target_tenant_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_tenant_usage_on_insert()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO tenant_usage (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
