-- Create a non-superuser role for the application.
-- Superusers bypass RLS policies entirely. By switching to this role
-- via SET LOCAL ROLE within tenant-scoped transactions, we ensure
-- that RLS policies are enforced at the database level.
--
-- Usage: Set DATABASE_APP_ROLE=app_user in your environment variables.
-- The application will then SET LOCAL ROLE app_user inside withTenant()
-- and withTenantTransaction() calls, making RLS effective.

-- Create the app_user role (NOLOGIN = cannot connect directly, only via SET ROLE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;

-- Grant necessary permissions on the public schema
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Ensure future tables and sequences also get permissions automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- Allow the postgres superuser to switch to this role via SET ROLE
-- Membership for the login role that runs the app (DigitalOcean: doadmin; self-hosted: postgres).
-- Managed databases do not allow granting roles to a superuser, so grant to the migrating
-- user and only additionally to "postgres" where that is permitted.
DO $$
BEGIN
  BEGIN
    EXECUTE format('GRANT app_user TO %I', current_user);
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'could not grant app_user to %: %', current_user, SQLERRM;
  END;
  IF current_user <> 'postgres' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    BEGIN
      GRANT app_user TO postgres;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'app_user not granted to postgres (not permitted here): %', SQLERRM;
    END;
  END IF;
END $$;
