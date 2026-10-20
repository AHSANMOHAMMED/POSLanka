/**
 * Low / out-of-stock alerts. Registered once as an onStockDecreased listener by
 * src/lib/inventory/apply-stock-change.ts, so every stock writer that calls
 * notifyStockDecreased() after commit triggers them.
 *
 * Only `import type` from apply-stock-change here — a value import would create a cycle.
 */
import { and, eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { items, warehouses } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import type { StockChangeInput, StockChangeResult } from '@/lib/inventory/apply-stock-change'
import { deliverAlert, type NotifyOutcome } from './notify'
import { getAlertSettings } from './alert-settings'

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''))

/** Decide and deliver the alert for one decrease. Exported for tests; resolves to null when no alert applies. */
export async function handleStockDecrease(result: StockChangeResult, input: StockChangeInput): Promise<NotifyOutcome | null> {
  if (result.skipped || result.delta >= 0) return null
  const { tenantId, warehouseId, itemId } = input

  let type: 'out_of_stock' | 'low_stock' | null = null
  let min = result.minStock
  if (result.before > 0 && result.after <= 0) {
    type = 'out_of_stock'
  } else if (result.minStock > 0) {
    if (result.crossedMin) type = 'low_stock'
  } else {
    const settings = await getAlertSettings(tenantId)
    min = settings.defaultMinStock || 0
    if (min > 0 && result.before > min && result.after <= min) type = 'low_stock'
  }
  if (!type) return null

  const meta = await withTenant(tenantId, async (tdb) => {
    const [item] = await tdb.select({ trackStock: items.trackStock, isActive: items.isActive })
      .from(items).where(and(eq(items.id, itemId), eq(items.tenantId, tenantId))).limit(1)
    const [wh] = await tdb.select({ name: warehouses.name })
      .from(warehouses).where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId))).limit(1)
    return { item, warehouseName: wh?.name || null }
  })
  // services / non-stock items never alert
  if (!meta.item || !meta.item.trackStock) return null

  const where = meta.warehouseName ? ` at ${meta.warehouseName}` : ''
  const data = { screen: 'inventory', itemId, warehouseId }
  if (type === 'out_of_stock') {
    return deliverAlert(tenantId, 'out_of_stock', {
      title: `Out of stock: ${result.itemName}`,
      body: `${result.itemName} has run out${where} (${fmt(result.after)} left).`,
      data,
      dedupeKey: `out_of_stock:${warehouseId}:${itemId}`,
      permission: 'manageInventory',
    })
  }
  return deliverAlert(tenantId, 'low_stock', {
    title: `Low stock: ${result.itemName}`,
    body: `${result.itemName}: ${fmt(result.after)} left${where} (minimum ${fmt(min)}).`,
    data,
    dedupeKey: `low_stock:${warehouseId}:${itemId}`,
    permission: 'manageInventory',
  })
}

/** onStockDecreased listener: fire-and-forget, never throws. */
export function stockAlertListener(result: StockChangeResult, input: StockChangeInput): void {
  handleStockDecrease(result, input).catch((error) => {
    logError('notifications/stock-alerts', error, { tenantId: input.tenantId, itemId: input.itemId })
  })
}
