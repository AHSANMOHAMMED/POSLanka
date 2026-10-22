import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'

/**
 * H3 — tenant purchasing settings, stored in tenants.settings.purchasing:
 *   matchPriceTolerancePct  invoice price may differ from the PO price by this % (default 0)
 *   matchQtyTolerancePct    invoice quantity may exceed received / ordered qty by this % (default 0)
 *   matchAction             'warn' (submit, flag the invoice) | 'block' (refuse to submit)
 *   autoReorder             daily cron creates draft purchase requisitions from reorder suggestions
 */
export interface PurchasingSettings {
  matchPriceTolerancePct: number
  matchQtyTolerancePct: number
  matchAction: 'warn' | 'block'
  autoReorder: boolean
}

export const DEFAULT_PURCHASING_SETTINGS: PurchasingSettings = {
  matchPriceTolerancePct: 0,
  matchQtyTolerancePct: 0,
  matchAction: 'warn',
  autoReorder: false,
}

const pct = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 1000) : 0
}

export function resolvePurchasingSettings(settings: unknown): PurchasingSettings {
  const p = ((settings || {}) as { purchasing?: Partial<PurchasingSettings> }).purchasing || {}
  return {
    matchPriceTolerancePct: pct(p.matchPriceTolerancePct),
    matchQtyTolerancePct: pct(p.matchQtyTolerancePct),
    matchAction: p.matchAction === 'block' ? 'block' : 'warn',
    autoReorder: p.autoReorder === true,
  }
}

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export async function getPurchasingSettings(tx: DbTx, tenantId: string): Promise<PurchasingSettings> {
  const [row] = rows<{ settings: unknown }>(await tx.execute(sql`SELECT settings FROM tenants WHERE id = ${tenantId} LIMIT 1`))
  return resolvePurchasingSettings(row?.settings)
}

/** Merge a patch into tenants.settings.purchasing (other settings keys are kept). */
export async function savePurchasingSettings(tx: DbTx, tenantId: string, patch: Partial<PurchasingSettings>): Promise<PurchasingSettings> {
  const current = await getPurchasingSettings(tx, tenantId)
  const next = resolvePurchasingSettings({ purchasing: { ...current, ...patch } })
  await tx.execute(sql`
    UPDATE tenants
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{purchasing}', ${JSON.stringify(next)}::jsonb, true)
    WHERE id = ${tenantId}
  `)
  return next
}
