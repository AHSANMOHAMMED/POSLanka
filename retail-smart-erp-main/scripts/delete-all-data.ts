import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function deleteAllData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('Deleting all data from database...');

  try {
    await pool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        -- Disable triggers
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'ALTER TABLE ' || quote_ident(r.tablename) || ' DISABLE TRIGGER ALL';
        END LOOP;

        -- Truncate all tables
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;

        -- Re-enable triggers
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'ALTER TABLE ' || quote_ident(r.tablename) || ' ENABLE TRIGGER ALL';
        END LOOP;
      END $$;
    `);

    console.log('All data deleted successfully!');
  } finally {
    await pool.end();
  }
}

deleteAllData().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
