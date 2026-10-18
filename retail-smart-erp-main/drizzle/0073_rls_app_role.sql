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
GRANT app_user TO postgres;
