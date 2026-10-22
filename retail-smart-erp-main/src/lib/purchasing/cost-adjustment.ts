import { sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import { recordItemChange } from '@/lib/inventory/item-audit'
import { getTotalItemStock } from './stock-cost'

/**
 * H3 — spread an extra cost (landed cost charge, invoice-vs-GRN price difference) over the units
 * it belongs to.
 *
 * `basisQty` units of the item received the extra `amount`. The share for units still on hand
 * (min(total stock across all warehouses, basisQty) / basisQty) raises the weighted-average cost
 * of the stock on hand:
 *     newCost = currentCost + absorbed / onHand
 * The share for units already sold / consumed can no longer be capitalised: it is returned as
 * `expensed` (the caller posts it to COGS). A negative amount (cheaper invoice, cancellation)
 * lowers the cost the same way, never below zero (what cannot be taken out of the cost is
 * expensed instead).
 *
 * Writes an item_cost_history row (source given) and the item audit trail. Locks the item row.
 */

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export interface CostAdjustmentInput {
  tenantId: string
  itemId: string
  amount: number
  basisQty: number
  source: 'landed_cost' | 'landed_cost_cancellation' | 'price_variance'
  supplierId?: string | null
  referenceId?: string | null
  referenceNo?: string | null
  userId?: string | null
  notes?: string | null
}

export interface CostAdjustmentResult {
  absorbed: number
  expensed: number
  onHand: number
  previousCost: number
  newCost: number
}

export async function applyCostAdjustment(tx: DbTx, input: CostAdjustmentInput): Promise<CostAdjustmentResult> {
  const amount = round2(Number(input.amount) || 0)
  const [item] = rows<{ cost_price: string | null }>(await tx.execute(sql`
    SELECT cost_price FROM items WHERE tenant_id = ${input.tenantId} AND id = ${input.itemId} FOR UPDATE
  `))
  const previousCost = round2(parseFloat(item?.cost_price || '0'))
  if (!item || amount === 0) return { absorbed: 0, expensed: amount, onHand: 0, previousCost, newCost: previousCost }

  const onHand = Math.max(0, await getTotalItemStock(tx, input.tenantId, input.itemId))
  const basis = Math.max(0, Number(input.basisQty) || 0)
  const share = basis > 0 ? Math.min(onHand, basis) / basis : (onHand > 0 ? 1 : 0)
  let absorbed = round2(amount * share)
  let newCost = previousCost
  if (onHand > 0 && absorbed !== 0) {
    newCost = round2(previousCost + absorbed / onHand)
    if (newCost < 0) {
      // cannot take more out of the stock than it is valued at
      newCost = 0
      absorbed = round2(-previousCost * onHand)
    }
  } else {
    absorbed = 0
  }
  const expensed = round2(amount - absorbed)

  if (newCost !== previousCost) {
    await tx.execute(sql`
      UPDATE items
      SET cost_price = ${newCost.toFixed(2)}::numeric,
          updated_by = COALESCE(${input.userId || null}::uuid, updated_by),
          version = version + 1,
          updated_at = now()
      WHERE tenant_id = ${input.tenantId} AND id = ${input.itemId}
    `)
    await recordItemChange(tx, {
      tenantId: input.tenantId,
      itemId: input.itemId,
      userId: input.userId || null,
      source: 'purchase',
      action: 'update',
      before: { costPrice: previousCost },
      after: { costPrice: newCost },
      notes: `${input.source === 'price_variance' ? 'Invoice price difference' : 'Landed cost'}${input.referenceNo ? ` ${input.referenceNo.slice(0, 50)}` : ''}`,
    })
  }

  await tx.execute(sql`
    INSERT INTO item_cost_history (
      tenant_id, item_id, supplier_id, source, previous_cost_price, new_cost_price,
      purchase_price, quantity, stock_before, stock_after, reference_id, reference_no, notes, created_by
    ) VALUES (
      ${input.tenantId}, ${input.itemId}, ${input.supplierId || null}, ${input.source}::cost_change_source,
      ${previousCost.toFixed(2)}::numeric, ${newCost.toFixed(2)}::numeric,
      ${amount.toFixed(2)}::numeric, ${round3(basis).toFixed(3)}::numeric,
      ${round3(onHand).toFixed(3)}::numeric, ${round3(onHand).toFixed(3)}::numeric,
      ${input.referenceId || null}, ${input.referenceNo ? input.referenceNo.slice(0, 50) : null},
      ${(input.notes || `absorbed ${absorbed.toFixed(2)}, expensed ${expensed.toFixed(2)}`).slice(0, 1000)}, ${input.userId || null}
    )
  `)

  return { absorbed, expensed, onHand, previousCost, newCost }
}
