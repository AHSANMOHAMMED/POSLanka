import { sql } from 'drizzle-orm'
import type { DbTx } from './db-types'

/**
 * D1 — per-tenant quarantine location. Returned goods go here (instead of sellable stock)
 * when tenants.settings.returns.restockMode = 'quarantine'. It is an ordinary warehouse with
 * code 'QUARANTINE', created on demand; sales / POS shifts refuse it (see isQuarantineWarehouse).
 */
export const QUARANTINE_WAREHOUSE_CODE = 'QUARANTINE'

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

/** Find (or create) the tenant's quarantine warehouse and return its id. */
export async function getOrCreateQuarantineWarehouse(tx: DbTx, tenantId: string): Promise<string> {
  const find = async () => rows<{ id: string }>(await tx.execute(sql`
    SELECT id FROM warehouses
    WHERE tenant_id = ${tenantId} AND upper(code) = ${QUARANTINE_WAREHOUSE_CODE}
    ORDER BY created_at LIMIT 1
  `))[0]?.id
  const existing = await find()
  if (existing) return existing
  // per-tenant creation lock: two concurrent returns must not create two quarantine warehouses
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('quarantine_wh:' || ${tenantId}))`)
  const again = await find()
  if (again) return again
  const [created] = rows<{ id: string }>(await tx.execute(sql`
    INSERT INTO warehouses (tenant_id, name, code, is_default, is_active)
    VALUES (${tenantId}, 'Quarantine (returns)', ${QUARANTINE_WAREHOUSE_CODE}, false, true)
    RETURNING id
  `))
  return created.id
}

export function isQuarantineCode(code: string | null | undefined): boolean {
  return !!code && code.trim().toUpperCase() === QUARANTINE_WAREHOUSE_CODE
}

export async function isQuarantineWarehouse(tx: DbTx, warehouseId: string): Promise<boolean> {
  const [row] = rows<{ code: string }>(await tx.execute(sql`SELECT code FROM warehouses WHERE id = ${warehouseId} LIMIT 1`))
  return isQuarantineCode(row?.code)
}
