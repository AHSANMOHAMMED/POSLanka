import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// Load environment variables from .env.local and .env
dotenv.config({ path: path.join(__dirname, '../../.env.local') })
dotenv.config({ path: path.join(__dirname, '../../.env') })

import { db } from '../../src/lib/db'
import { sql } from 'drizzle-orm'

async function applyIndexes() {
  console.log('🔧 Applying database indexes...\n')

  const sqlFile = fs.readFileSync(
    path.join(__dirname, '../../add-indexes.sql'),
    'utf-8'
  )

  // Split by semicolon and filter out comments and empty lines
  const statements = sqlFile
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && !s.startsWith('SELECT'))

  let created = 0
  let errors = 0

  for (const statement of statements) {
    if (!statement.includes('CREATE INDEX')) continue

    const indexName = statement.match(/idx_\w+/)?.[0] || 'unknown'

    try {
      await db.execute(sql.raw(statement))
      console.log(`  ✓ Created: ${indexName}`)
      created++
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`  ○ Exists: ${indexName}`)
      } else {
        console.log(`  ✗ Error: ${indexName} - ${error.message}`)
        errors++
      }
    }
  }

  console.log(`\n════════════════════════════════════════`)
  console.log(`  Indexes created: ${created}`)
  console.log(`  Errors: ${errors}`)
  console.log(`════════════════════════════════════════\n`)

  // Verify indexes exist
  console.log('📊 Verifying indexes on key tables...\n')

  const result = await db.execute(sql`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%'
    ORDER BY tablename, indexname
  `)

  const tables = new Map<string, string[]>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of result.rows as any[]) {
    if (!tables.has(row.tablename)) {
      tables.set(row.tablename, [])
    }
    tables.get(row.tablename)!.push(row.indexname)
  }

  for (const [table, indexes] of tables) {
    console.log(`  ${table}: ${indexes.length} indexes`)
  }

  console.log('\n✅ Done! Restart your dev server and run stress test again.')
  process.exit(0)
}

applyIndexes().catch(err => {
  console.error('Failed to apply indexes:', err)
  process.exit(1)
})
