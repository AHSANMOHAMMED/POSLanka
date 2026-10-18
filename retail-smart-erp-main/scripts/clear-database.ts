/**
 * Clear all data from the database
 * Usage: npx tsx scripts/clear-database.ts
 */

import 'dotenv/config'
import { db } from '../src/lib/db'
import { sql } from 'drizzle-orm'

async function clearDatabase() {
  console.log('⚠️  Clearing all data from database...\n')

  try {
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

    console.log('✅ All data cleared successfully!')
  } catch (error) {
    console.error('Error clearing database:', error)
    process.exit(1)
  }

  process.exit(0)
}

clearDatabase()
