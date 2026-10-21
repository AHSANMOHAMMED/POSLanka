#!/usr/bin/env node
/**
 * POSLanka migration runner.
 *
 * Drop-in replacement for `drizzle-kit migrate` that is compatible with the same
 * `drizzle.__drizzle_migrations` table (hash + created_at = journal "when"), but
 * applies each migration file on its own instead of wrapping ALL pending files in
 * a single transaction. That matters on a fresh database: several migrations add
 * an enum value and use it in the same file, which PostgreSQL forbids inside one
 * transaction ("unsafe use of new value"). Statements are split on
 * `--> statement-breakpoint` exactly like drizzle does and executed in order; the
 * migration is recorded only after every statement of the file succeeded.
 *
 * Applied migrations are tracked by name in drizzle.__poslanka_migrations (see main()).
 *
 * Usage: node scripts/migrate.mjs   (reads DATABASE_URL_ADMIN || DATABASE_URL)
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { pgConnectionConfig } from './pg-connection.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const connectionString = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL (or DATABASE_URL_ADMIN) is required')
  process.exit(1)
}

const journal = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8'))
const client = new pg.Client(pgConnectionConfig(connectionString))

function splitStatements(sql) {
  return sql.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
}

async function main() {
  await client.connect()
  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"')
  await client.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`)

  // Serialize concurrent deploys (two instances starting at once)
  await client.query('SELECT pg_advisory_lock(hashtext(\'poslanka_migrations\'))')
  try {
    // Applied migrations are tracked BY NAME. The journal's "when" values are not unique
    // (37 and 46 migrations share single timestamps) and not monotonic, so the old
    // "when > newest applied" rule silently skipped migrations after an interrupted run.
    await client.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__poslanka_migrations" (
      tag text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
    let { rows: appliedRows } = await client.query('SELECT tag FROM "drizzle"."__poslanka_migrations"')
    if (appliedRows.length === 0) {
      // First run on a database migrated by drizzle-kit / the old runner: adopt what it applied.
      const { rows } = await client.query(
        'SELECT max(created_at) AS last FROM "drizzle"."__drizzle_migrations"'
      )
      const last = rows[0]?.last ? Number(rows[0].last) : 0
      const adopted = last > 0 ? journal.entries.filter((e) => e.when <= last) : []
      for (const e of adopted) {
        await client.query(
          'INSERT INTO "drizzle"."__poslanka_migrations" (tag, hash) VALUES ($1, $2) ON CONFLICT (tag) DO NOTHING',
          [e.tag, 'adopted-from-__drizzle_migrations']
        )
      }
      if (adopted.length > 0) {
        console.log(`Migrations: adopted ${adopted.length} previously applied migrations (run "npm run db:check-drift" to confirm the schema is complete)`)
      }
      appliedRows = adopted.map((e) => ({ tag: e.tag }))
    }
    const applied = new Set(appliedRows.map((r) => r.tag))
    const pending = journal.entries.filter((e) => !applied.has(e.tag))
    if (pending.length === 0) {
      console.log('Migrations: database is up to date')
      return
    }
    console.log(`Migrations: ${pending.length} pending`)

    for (const entry of pending) {
      const file = join(root, 'drizzle', `${entry.tag}.sql`)
      const sql = readFileSync(file, 'utf8')
      const hash = createHash('sha256').update(sql).digest('hex')
      const statements = splitStatements(sql)
      const started = Date.now()
      for (let i = 0; i < statements.length; i++) {
        try {
          await client.query(statements[i])
        } catch (err) {
          console.error(`\n✖ ${entry.tag} failed at statement #${i + 1}/${statements.length}:`)
          console.error(statements[i].slice(0, 400))
          console.error(`\n${err.message}`)
          process.exitCode = 1
          return
        }
      }
      await client.query(
        'INSERT INTO "drizzle"."__poslanka_migrations" (tag, hash) VALUES ($1, $2) ON CONFLICT (tag) DO UPDATE SET hash = EXCLUDED.hash',
        [entry.tag, hash]
      )
      // keep drizzle's own table in step for drizzle-kit tooling
      await client.query(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
        [hash, entry.when]
      )
      console.log(`✔ ${entry.tag} (${statements.length} statements, ${Date.now() - started} ms)`)
    }
    console.log('Migrations: complete')
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext(\'poslanka_migrations\'))').catch(() => undefined)
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration runner error:', err)
  process.exit(1)
})
