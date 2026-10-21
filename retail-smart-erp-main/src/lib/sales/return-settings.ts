/**
 * D1 — tenant settings for returns and batch selling, stored in tenants.settings:
 *   settings.returns = { serialReturnStatus: 'available' | 'defective', restockMode: 'stock' | 'quarantine' }
 *   settings.batches = { allowExpiredSale: boolean }
 * Defaults keep the pre-D1 behaviour: returned goods are sellable again, expired batches are
 * never sold.
 */
import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'

export type SerialReturnStatus = 'available' | 'defective'
export type RestockMode = 'stock' | 'quarantine'

export interface ReturnSettings {
  serialReturnStatus: SerialReturnStatus
  restockMode: RestockMode
}

export interface BatchSettings {
  allowExpiredSale: boolean
}

export const DEFAULT_RETURN_SETTINGS: ReturnSettings = { serialReturnStatus: 'available', restockMode: 'stock' }
export const DEFAULT_BATCH_SETTINGS: BatchSettings = { allowExpiredSale: false }

export function resolveReturnSettings(settings: unknown): ReturnSettings {
  const r = ((settings || {}) as { returns?: Partial<ReturnSettings> }).returns || {}
  return {
    serialReturnStatus: r.serialReturnStatus === 'defective' ? 'defective' : 'available',
    restockMode: r.restockMode === 'quarantine' ? 'quarantine' : 'stock',
  }
}

export function resolveBatchSettings(settings: unknown): BatchSettings {
  const b = ((settings || {}) as { batches?: Partial<BatchSettings> }).batches || {}
  return { allowExpiredSale: b.allowExpiredSale === true }
}

/** Read tenants.settings once and resolve both groups. */
export async function getTenantSalesSettings(tx: DbTx, tenantId: string): Promise<{ returns: ReturnSettings; batches: BatchSettings }> {
  const res = await tx.execute(sql`SELECT settings FROM tenants WHERE id = ${tenantId} LIMIT 1`)
  const row = ((res as unknown as { rows?: Array<{ settings: unknown }> }).rows || [])[0]
  return { returns: resolveReturnSettings(row?.settings), batches: resolveBatchSettings(row?.settings) }
}
