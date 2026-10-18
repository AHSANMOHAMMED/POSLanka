import 'dotenv/config'
import { db } from '../src/lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    // Check if table exists
    const check = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'pos_profiles'
      ) as exists
    `)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (check as any)[0]?.exists || (check as any).rows?.[0]?.exists

    if (exists) {
      console.log('✓ pos_profiles table already exists')
    } else {
      console.log('Creating pos_profiles table...')

      await db.execute(sql`
        CREATE TABLE pos_profiles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          tenant_id uuid NOT NULL REFERENCES tenants(id),
          user_id uuid NOT NULL REFERENCES users(id),
          warehouse_id uuid NOT NULL REFERENCES warehouses(id),
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        )
      `)
      console.log('✓ Table created')
    }

    // Create indexes if not exist
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS pos_profiles_user_tenant_idx ON pos_profiles (tenant_id, user_id)`)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS pos_profiles_tenant_idx ON pos_profiles (tenant_id)`)
    await db.execute(sql`CREATE INDEX IF NOT EXISTS pos_profiles_warehouse_idx ON pos_profiles (warehouse_id)`)
    console.log('✓ Indexes created/verified')

    // Verify
    const cols = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'pos_profiles'
      ORDER BY ordinal_position
    `)

    console.log('\nTable structure:')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (cols as any).rows || cols
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.forEach((r: any) => console.log(`  - ${r.column_name}: ${r.data_type}`))

    console.log('\n✓ Done!')
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
