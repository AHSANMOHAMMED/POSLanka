/**
 * Compares every table/column declared in src/lib/db/schema.ts with the live database
 * (DATABASE_URL). Exits 1 when the code expects a table or column that the migrations
 * never created — the kind of drift that makes a feature fail only in production.
 *   DATABASE_URL=... npx tsx scripts/check-schema-drift.ts
 */
import { Client } from 'pg'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../src/lib/db/schema'

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const { rows } = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public'`
  )
  await client.end()
  const db = new Map<string, Map<string, string>>()
  for (const r of rows) {
    if (!db.has(r.table_name)) db.set(r.table_name, new Map())
    db.get(r.table_name)!.set(r.column_name, r.is_nullable)
  }
  const problems: string[] = []
  let tables = 0
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue
    const cfg = getTableConfig(value)
    tables++
    const cols = db.get(cfg.name)
    if (!cols) { problems.push(`MISSING TABLE  ${cfg.name}`); continue }
    for (const c of cfg.columns) {
      if (!cols.has(c.name)) problems.push(`MISSING COLUMN ${cfg.name}.${c.name}`)
      else if (c.notNull && cols.get(c.name) === 'YES' && !c.hasDefault) problems.push(`NULLABLE IN DB ${cfg.name}.${c.name} (schema says NOT NULL)`)
    }
  }
  console.log(`Checked ${tables} tables declared in schema.ts`)
  for (const p of problems) console.log('  ' + p)
  if (problems.some((p) => p.startsWith('MISSING'))) { console.log(`${problems.length} problem(s)`); process.exit(1) }
  console.log('OK: every declared table and column exists in the database')
}
main().catch((e) => { console.error(e); process.exit(2) })
