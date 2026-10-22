import { sql } from 'drizzle-orm'
import type { DbTx } from './db-types'

/**
 * H3 — may a stock-out from this context take the warehouse below zero?
 *
 * Follows the POS profile's allowNegativeStock:
 *   1. the profile of the sale's POS shift (sale → pos_opening_entries → pos_profiles), else
 *   2. the tenant's active POS profile for the warehouse (default profile first).
 * No profile → `whenNoProfile` (default false: blocked, like a POS sale).
 */
export async function allowNegativeStockFor(
  tx: DbTx,
  opts: { tenantId: string; warehouseId: string | null; saleId?: string | null; whenNoProfile?: boolean },
): Promise<boolean> {
  const fallback = opts.whenNoProfile ?? false
  if (opts.saleId) {
    const res = await tx.execute(sql`
      SELECT p.allow_negative_stock
      FROM sales s
      JOIN pos_opening_entries o ON o.id = s.pos_opening_entry_id
      JOIN pos_profiles p ON p.id = o.pos_profile_id
      WHERE s.tenant_id = ${opts.tenantId} AND s.id = ${opts.saleId}
      LIMIT 1
    `)
    const row = ((res as unknown as { rows?: { allow_negative_stock: boolean }[] }).rows || [])[0]
    if (row) return row.allow_negative_stock === true
  }
  if (!opts.warehouseId) return fallback
  const res = await tx.execute(sql`
    SELECT allow_negative_stock FROM pos_profiles
    WHERE tenant_id = ${opts.tenantId} AND warehouse_id = ${opts.warehouseId} AND status = 'active'
    ORDER BY is_default DESC, created_at
    LIMIT 1
  `)
  const row = ((res as unknown as { rows?: { allow_negative_stock: boolean }[] }).rows || [])[0]
  return row ? row.allow_negative_stock === true : fallback
}
