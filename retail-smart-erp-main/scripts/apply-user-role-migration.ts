import 'dotenv/config';
import { Client } from 'pg';

async function run() {
  const DATABASE_URL = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL or DATABASE_URL_ADMIN environment variable is required');
  }

  console.log('Connecting to database...');
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database');

    // Check current enum values
    const result = await client.query(`
      SELECT e.enumlabel 
      FROM pg_enum e 
      JOIN pg_type t ON e.enumtypid = t.oid 
      WHERE t.typname = 'user_role'
      ORDER BY e.enumsortorder
    `);
    console.log('Current user_role enum values:', result.rows.map(r => r.enumlabel));

    // Apply the migration
    console.log('\nApplying migration...');
    const statements = [
      `ALTER TYPE "public"."user_role" ADD VALUE 'chef' AFTER 'technician'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'waiter' AFTER 'chef'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'system_manager' AFTER 'waiter'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'accounts_manager' AFTER 'system_manager'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'sales_manager' AFTER 'accounts_manager'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'purchase_manager' AFTER 'sales_manager'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'hr_manager' AFTER 'purchase_manager'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'stock_manager' AFTER 'hr_manager'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'pos_user' AFTER 'stock_manager'`,
      `ALTER TYPE "public"."user_role" ADD VALUE 'report_user' AFTER 'pos_user'`
    ];

    for (const stmt of statements) {
      console.log('Executing:', stmt);
      try {
        await client.query(stmt);
        console.log('Success');
      } catch (err: any) {
        if (err.code === '42710') { // duplicate object
          console.log('Value already exists, skipping');
        } else {
          throw err;
        }
      }
    }

    // Verify the update
    const result2 = await client.query(`
      SELECT e.enumlabel 
      FROM pg_enum e 
      JOIN pg_type t ON e.enumtypid = t.oid 
      WHERE t.typname = 'user_role'
      ORDER BY e.enumsortorder
    `);
    console.log('\nUpdated user_role enum values:', result2.rows.map(r => r.enumlabel));
    console.log('\nTotal values:', result2.rows.length);

    if (result2.rows.length === 14) {
      console.log('\n✅ Migration completed successfully! PostgreSQL user_role enum now has all 14 values.');
    } else {
      console.log(`\n⚠️ Warning: Expected 14 values but got ${result2.rows.length}`);
    }

  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});