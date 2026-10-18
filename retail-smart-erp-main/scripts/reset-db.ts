import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'

async function resetDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const db = drizzle(pool)

  console.log('Truncating all tables...')

  // Disable foreign key checks, truncate all tables, re-enable
  await db.execute(sql`
    DO $$
    DECLARE
      r RECORD;
    BEGIN
      -- Disable triggers
      SET session_replication_role = 'replica';

      -- Truncate all tables in public schema
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;

      -- Re-enable triggers
      SET session_replication_role = 'origin';
    END $$;
  `)

  console.log('All tables truncated successfully!')

  await pool.end()
  process.exit(0)
}

resetDatabase().catch((err) => {
  console.error('Error resetting database:', err)
  process.exit(1)
})
