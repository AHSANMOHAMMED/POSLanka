import { sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type * as schema from '@/lib/db/schema'

/** A tenant-scoped drizzle handle: TenantDb or a (nested) transaction of it. */
export type DbTx = PgDatabase<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>

let savepointCounter = 0

/**
 * Run `fn` inside a SAVEPOINT on the current transaction. On error the savepoint
 * is rolled back (the outer transaction stays usable) and the error rethrown.
 * Uses explicit SQL so it also works with the `withTenant` handle, which is
 * already inside BEGIN but is not a drizzle transaction object.
 */
export async function withSavepoint<T>(tx: DbTx, fn: (sp: DbTx) => Promise<T>): Promise<T> {
  const name = `w2_sp_${++savepointCounter % 1_000_000}`
  await tx.execute(sql.raw(`SAVEPOINT ${name}`))
  try {
    const result = await fn(tx)
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${name}`))
    return result
  } catch (err) {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`))
    throw err
  }
}
