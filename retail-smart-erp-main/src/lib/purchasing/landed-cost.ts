import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbTx } from '@/lib/inventory/db-types'
import { landedCostVouchers, landedCostCharges, landedCostItems } from '@/lib/db/schema'
import { roundCurrency } from '@/lib/utils/currency'
import { postLandedCostToGL } from '@/lib/accounting/auto-post'
import { reverseGLEntries, tenantToday } from '@/lib/accounting/gl'
import { applyCostAdjustment } from './cost-adjustment'
import { adjustSupplierBalance } from './supplier-balance'
import { getTotalItemStock } from './stock-cost'

/**
 * H3 — Landed cost vouchers.
 *
 * Charges (freight, duty / customs, insurance, clearing, other) are allocated onto the stock lines
 * of one or more goods receipts (GRN) or purchase invoices, by value or by quantity. Per item the
 * allocated amount raises the weighted-average cost of the units still on hand
 * (applyCostAdjustment, source 'landed_cost'); the share of units already sold / consumed is
 * expensed to COGS.
 *   GL: Dr Stock [absorbed]  Dr COGS [expensed]  /  Cr AP (charge with supplier, + supplier
 *       balance) or Cr the charge's account.
 * Cancelling takes the absorbed amount back out of the current stock cost, reverses the GL
 * voucher ('landed_cost') and the supplier balances.
 */

export const LANDED_COST_CHARGE_TYPES = ['freight', 'duty', 'insurance', 'clearing', 'other'] as const
export type LandedCostChargeType = typeof LANDED_COST_CHARGE_TYPES[number]
export type LandedCostSourceType = 'grn' | 'purchase'

const round3 = (n: number) => Math.round(n * 1000) / 1000

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export class LandedCostError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 'LANDED_COST_INVALID') {
    super(message)
    this.name = 'LandedCostError'
  }
}

export interface LandedCostSourceLine {
  sourceType: LandedCostSourceType
  sourceId: string
  sourceNo: string
  itemId: string
  itemName: string
  quantity: number
  baseValue: number
}

/** Stock lines of the given GRNs / purchase invoices (only documents that are live). */
export async function loadLandedCostSources(
  tx: DbTx,
  tenantId: string,
  sources: { type: LandedCostSourceType; id: string }[],
): Promise<LandedCostSourceLine[]> {
  const grnIds = sources.filter(s => s.type === 'grn').map(s => s.id)
  const purchaseIds = sources.filter(s => s.type === 'purchase').map(s => s.id)
  const out: LandedCostSourceLine[] = []
  if (grnIds.length > 0) {
    const list = rows<{ id: string; receipt_no: string; status: string; item_id: string | null; item_name: string; qty: string; unit_cost: string | null; po_price: string | null; has_stock: boolean }>(await tx.execute(sql`
      SELECT r.id, r.receipt_no, r.status, ri.item_id, ri.item_name, ri.quantity_accepted * ri.uom_factor AS qty,
             ri.unit_cost / ri.uom_factor AS unit_cost, poi.unit_price / poi.uom_factor AS po_price,
             EXISTS (SELECT 1 FROM stock_movements m WHERE m.tenant_id = r.tenant_id AND m.reference_type = 'purchase_order_receive'
                     AND m.idempotency_key LIKE 'po-receive:' || r.id::text || ':%') AS has_stock
      FROM purchase_receipts r
      JOIN purchase_receipt_items ri ON ri.receipt_id = r.id
      LEFT JOIN purchase_order_items poi ON poi.id = ri.purchase_order_item_id
      WHERE r.tenant_id = ${tenantId} AND r.id IN (${sql.join(grnIds.map(i => sql`${i}::uuid`), sql`, `)})
      ORDER BY r.receipt_no, ri.item_name
    `))
    const seen = new Set(list.map(l => l.id))
    for (const id of grnIds) if (!seen.has(id)) throw new LandedCostError('Goods receipt not found', 404, 'NOT_FOUND')
    for (const l of list) {
      if (l.status === 'cancelled') throw new LandedCostError(`Goods receipt ${l.receipt_no} is cancelled`)
      if (!l.has_stock) throw new LandedCostError(`Goods receipt ${l.receipt_no} did not put stock in (received without stock update)`)
      if (!l.item_id || !(parseFloat(l.qty) > 0)) continue
      const qty = parseFloat(l.qty)
      const price = parseFloat(l.unit_cost ?? l.po_price ?? '0')
      out.push({ sourceType: 'grn', sourceId: l.id, sourceNo: l.receipt_no, itemId: l.item_id, itemName: l.item_name, quantity: qty, baseValue: roundCurrency(qty * price) })
    }
  }
  if (purchaseIds.length > 0) {
    const list = rows<{ id: string; purchase_no: string; status: string; is_return: boolean; item_id: string | null; item_name: string; qty: string; unit_price: string }>(await tx.execute(sql`
      -- 0184: base units / cost per base unit
      SELECT p.id, p.purchase_no, p.status, p.is_return, pi.item_id, pi.item_name, pi.quantity * pi.uom_factor AS qty,
             pi.unit_price / pi.uom_factor AS unit_price
      FROM purchases p
      JOIN purchase_items pi ON pi.purchase_id = p.id
      WHERE p.tenant_id = ${tenantId} AND p.id IN (${sql.join(purchaseIds.map(i => sql`${i}::uuid`), sql`, `)})
      ORDER BY p.purchase_no, pi.item_name
    `))
    const seen = new Set(list.map(l => l.id))
    for (const id of purchaseIds) if (!seen.has(id)) throw new LandedCostError('Purchase invoice not found', 404, 'NOT_FOUND')
    for (const l of list) {
      if (l.is_return) throw new LandedCostError(`${l.purchase_no} is a purchase return`)
      if (l.status === 'draft' || l.status === 'cancelled') throw new LandedCostError(`Purchase invoice ${l.purchase_no} is ${l.status}`)
      if (!l.item_id || !(parseFloat(l.qty) > 0)) continue
      const qty = parseFloat(l.qty)
      out.push({ sourceType: 'purchase', sourceId: l.id, sourceNo: l.purchase_no, itemId: l.item_id, itemName: l.item_name, quantity: qty, baseValue: roundCurrency(qty * parseFloat(l.unit_price)) })
    }
  }
  if (out.length === 0) throw new LandedCostError('The selected documents have no stock lines to allocate to')
  return out
}

/** Split `total` over the lines by value or quantity; the rounding remainder goes to the largest line. */
export function allocateLandedCost<T extends { quantity: number; baseValue: number }>(
  lines: T[], total: number, method: 'value' | 'quantity',
): (T & { allocatedAmount: number })[] {
  const weight = (l: T) => (method === 'quantity' ? l.quantity : l.baseValue)
  const totalWeight = lines.reduce((s, l) => s + weight(l), 0)
  if (!(totalWeight > 0)) {
    throw new LandedCostError(method === 'value'
      ? 'Cannot allocate by value: the selected lines have no value. Allocate by quantity instead.'
      : 'Cannot allocate by quantity: the selected lines have no quantity.')
  }
  const out = lines.map(l => ({ ...l, allocatedAmount: roundCurrency(total * weight(l) / totalWeight) }))
  const diff = roundCurrency(total - out.reduce((s, l) => s + l.allocatedAmount, 0))
  if (diff !== 0) {
    let maxIdx = 0
    out.forEach((l, i) => { if (weight(l) > weight(out[maxIdx])) maxIdx = i })
    out[maxIdx].allocatedAmount = roundCurrency(out[maxIdx].allocatedAmount + diff)
  }
  return out
}

/** A submitted (not cancelled) voucher allocated to this GRN / invoice, or null. */
export async function activeLandedCostFor(tx: DbTx, sourceType: LandedCostSourceType, sourceId: string): Promise<{ id: string; voucherNo: string } | null> {
  const [row] = await tx.select({ id: landedCostVouchers.id, voucherNo: landedCostVouchers.voucherNo })
    .from(landedCostItems)
    .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostItems.voucherId))
    .where(and(
      eq(landedCostItems.sourceType, sourceType),
      eq(landedCostItems.sourceId, sourceId),
      eq(landedCostVouchers.status, 'submitted'),
    ))
    .limit(1)
  return row || null
}

/**
 * Submit a draft voucher: allocate, raise item costs, post GL, update supplier balances.
 * The voucher row must be locked by the caller.
 */
export async function submitLandedCostVoucher(
  tx: DbTx,
  opts: { tenantId: string; voucherId: string; userId: string | null },
): Promise<{ absorbed: number; expensed: number }> {
  const [voucher] = await tx.select().from(landedCostVouchers).where(eq(landedCostVouchers.id, opts.voucherId)).for('update')
  if (!voucher) throw new LandedCostError('Landed cost voucher not found', 404, 'NOT_FOUND')
  if (voucher.status !== 'draft') throw new LandedCostError(`Only draft vouchers can be submitted (status: ${voucher.status})`)

  const charges = await tx.select().from(landedCostCharges).where(eq(landedCostCharges.voucherId, voucher.id))
  const total = roundCurrency(charges.reduce((s, c) => s + parseFloat(c.amount), 0))
  if (!(total > 0)) throw new LandedCostError('Add at least one charge with an amount')
  const lines = await tx.select().from(landedCostItems).where(eq(landedCostItems.voucherId, voucher.id))
  if (lines.length === 0) throw new LandedCostError('Select at least one goods receipt or purchase invoice')

  // Re-validate the documents (they may have been cancelled since the draft was saved)
  const sourceKeys = [...new Map(lines.map(l => [`${l.sourceType}:${l.sourceId}`, { type: l.sourceType as LandedCostSourceType, id: l.sourceId }])).values()]
  await loadLandedCostSources(tx, opts.tenantId, sourceKeys)

  const allocated = allocateLandedCost(
    lines.map(l => ({ id: l.id, itemId: l.itemId, quantity: parseFloat(l.quantity), baseValue: parseFloat(l.baseValue) })),
    total, voucher.allocationMethod === 'quantity' ? 'quantity' : 'value',
  )

  // Per item (lock order: itemId) so units on hand are not counted twice for two lines of one item
  const byItem = new Map<string, { amount: number; qty: number; lineIdx: number[] }>()
  allocated.forEach((l, idx) => {
    const agg = byItem.get(l.itemId) || { amount: 0, qty: 0, lineIdx: [] }
    agg.amount = roundCurrency(agg.amount + l.allocatedAmount)
    agg.qty = round3(agg.qty + l.quantity)
    agg.lineIdx.push(idx)
    byItem.set(l.itemId, agg)
  })
  let absorbed = 0
  let expensed = 0
  const lineResult = allocated.map(() => ({ absorbed: 0, expensed: 0, costBefore: 0, costAfter: 0 }))
  for (const itemId of [...byItem.keys()].sort()) {
    const agg = byItem.get(itemId)!
    const res = await applyCostAdjustment(tx, {
      tenantId: opts.tenantId, itemId, amount: agg.amount, basisQty: agg.qty, source: 'landed_cost',
      referenceId: voucher.id, referenceNo: voucher.voucherNo, userId: opts.userId,
      notes: `Landed cost ${voucher.voucherNo}`,
    })
    absorbed = roundCurrency(absorbed + res.absorbed)
    expensed = roundCurrency(expensed + res.expensed)
    // spread the item's absorbed / expensed split back over its lines
    let restAbs = res.absorbed
    agg.lineIdx.forEach((idx, k) => {
      const l = allocated[idx]
      const abs = k === agg.lineIdx.length - 1 ? restAbs : roundCurrency(agg.amount ? res.absorbed * l.allocatedAmount / agg.amount : 0)
      restAbs = roundCurrency(restAbs - abs)
      lineResult[idx] = { absorbed: abs, expensed: roundCurrency(l.allocatedAmount - abs), costBefore: res.previousCost, costAfter: res.newCost }
    })
  }

  for (let i = 0; i < allocated.length; i++) {
    await tx.update(landedCostItems).set({
      allocatedAmount: allocated[i].allocatedAmount.toFixed(2),
      absorbedAmount: lineResult[i].absorbed.toFixed(2),
      expensedAmount: lineResult[i].expensed.toFixed(2),
      costBefore: lineResult[i].costBefore.toFixed(2),
      costAfter: lineResult[i].costAfter.toFixed(2),
    }).where(eq(landedCostItems.id, allocated[i].id))
  }

  const postingDate = voucher.postingDate || await tenantToday(opts.tenantId)
  await postLandedCostToGL(tx, opts.tenantId, {
    voucherId: voucher.id,
    voucherNo: voucher.voucherNo,
    postingDate,
    absorbed,
    expensed,
    credits: charges.map(c => ({
      amount: parseFloat(c.amount),
      supplierId: c.supplierId,
      accountId: c.creditAccountId,
      remarks: `${c.chargeType}${c.description ? `: ${c.description}` : ''} (${voucher.voucherNo})`,
    })),
  })

  // charges billed by a supplier are owed to them (AP)
  for (const c of charges) {
    if (c.supplierId && !c.creditAccountId) {
      await adjustSupplierBalance(tx, {
        tenantId: opts.tenantId, supplierId: c.supplierId, delta: parseFloat(c.amount), type: 'purchase',
        referenceType: 'landed_cost', referenceId: voucher.id,
        notes: `Landed cost ${voucher.voucherNo}: ${c.chargeType}`, userId: opts.userId,
      })
    }
  }

  await tx.update(landedCostVouchers).set({
    status: 'submitted',
    totalCharges: total.toFixed(2),
    absorbedAmount: absorbed.toFixed(2),
    expensedAmount: expensed.toFixed(2),
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(landedCostVouchers.id, voucher.id))

  return { absorbed, expensed }
}

/** Cancel a submitted voucher (or discard a draft). */
export async function cancelLandedCostVoucher(
  tx: DbTx,
  opts: { tenantId: string; voucherId: string; userId: string | null; reason?: string | null },
): Promise<void> {
  const [voucher] = await tx.select().from(landedCostVouchers).where(eq(landedCostVouchers.id, opts.voucherId)).for('update')
  if (!voucher) throw new LandedCostError('Landed cost voucher not found', 404, 'NOT_FOUND')
  if (voucher.status === 'cancelled') throw new LandedCostError('Voucher is already cancelled')

  if (voucher.status === 'submitted') {
    const lines = await tx.select().from(landedCostItems).where(eq(landedCostItems.voucherId, voucher.id))
    const byItem = new Map<string, number>()
    for (const l of lines) byItem.set(l.itemId, roundCurrency((byItem.get(l.itemId) || 0) + parseFloat(l.absorbedAmount)))
    for (const itemId of [...byItem.keys()].sort()) {
      const amount = byItem.get(itemId)!
      if (amount === 0) continue
      // take exactly what was capitalised back out of the stock now on hand
      const onHand = Math.max(0, await getTotalItemStock(tx, opts.tenantId, itemId))
      await applyCostAdjustment(tx, {
        tenantId: opts.tenantId, itemId, amount: -amount, basisQty: onHand, source: 'landed_cost_cancellation',
        referenceId: voucher.id, referenceNo: voucher.voucherNo, userId: opts.userId,
        notes: `Landed cost ${voucher.voucherNo} cancelled`,
      })
    }
    await reverseGLEntries(tx, opts.tenantId, 'landed_cost', voucher.id, await tenantToday(opts.tenantId))
    const charges = await tx.select().from(landedCostCharges).where(eq(landedCostCharges.voucherId, voucher.id))
    for (const c of charges) {
      if (c.supplierId && !c.creditAccountId) {
        await adjustSupplierBalance(tx, {
          tenantId: opts.tenantId, supplierId: c.supplierId, delta: -parseFloat(c.amount), type: 'cancel',
          referenceType: 'landed_cost', referenceId: voucher.id,
          notes: `Landed cost ${voucher.voucherNo} cancelled`, userId: opts.userId,
        })
      }
    }
  }

  await tx.update(landedCostVouchers).set({
    status: 'cancelled',
    cancelledAt: new Date(),
    cancellationReason: opts.reason || null,
    updatedAt: new Date(),
  }).where(eq(landedCostVouchers.id, voucher.id))
}

/** Replace a draft's charges and lines (lines re-read from the selected documents). */
export async function saveLandedCostDraft(
  tx: DbTx,
  opts: {
    tenantId: string
    voucherId: string
    sources: { type: LandedCostSourceType; id: string }[]
    charges: { chargeType: LandedCostChargeType; description?: string | null; amount: number; supplierId?: string | null; creditAccountId?: string | null }[]
  },
): Promise<void> {
  const lines = await loadLandedCostSources(tx, opts.tenantId, opts.sources)
  await tx.delete(landedCostCharges).where(eq(landedCostCharges.voucherId, opts.voucherId))
  await tx.delete(landedCostItems).where(eq(landedCostItems.voucherId, opts.voucherId))
  if (opts.charges.length > 0) {
    await tx.insert(landedCostCharges).values(opts.charges.map(c => ({
      tenantId: opts.tenantId,
      voucherId: opts.voucherId,
      chargeType: c.chargeType,
      description: c.description || null,
      amount: roundCurrency(c.amount).toFixed(2),
      supplierId: c.supplierId || null,
      creditAccountId: c.creditAccountId || null,
    })))
  }
  await tx.insert(landedCostItems).values(lines.map(l => ({
    tenantId: opts.tenantId,
    voucherId: opts.voucherId,
    sourceType: l.sourceType,
    sourceId: l.sourceId,
    sourceNo: l.sourceNo,
    itemId: l.itemId,
    itemName: l.itemName,
    quantity: l.quantity.toFixed(3),
    baseValue: l.baseValue.toFixed(2),
  })))
  const total = roundCurrency(opts.charges.reduce((s, c) => s + c.amount, 0))
  await tx.update(landedCostVouchers).set({ totalCharges: total.toFixed(2), updatedAt: new Date() })
    .where(eq(landedCostVouchers.id, opts.voucherId))
}

/** Voucher with charges and lines. */
export async function getLandedCostVoucher(tx: DbTx, voucherId: string) {
  const [voucher] = await tx.select().from(landedCostVouchers).where(eq(landedCostVouchers.id, voucherId))
  if (!voucher) return null
  const charges = await tx.select().from(landedCostCharges).where(eq(landedCostCharges.voucherId, voucherId))
  const lines = await tx.select().from(landedCostItems).where(eq(landedCostItems.voucherId, voucherId))
  return { ...voucher, charges, items: lines }
}

/** Voucher ids that allocate to any of the given documents (for document pages). */
export async function landedCostVouchersFor(tx: DbTx, sourceIds: string[]): Promise<{ id: string; voucherNo: string; status: string }[]> {
  if (sourceIds.length === 0) return []
  return tx.selectDistinct({ id: landedCostVouchers.id, voucherNo: landedCostVouchers.voucherNo, status: landedCostVouchers.status })
    .from(landedCostItems)
    .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostItems.voucherId))
    .where(inArray(landedCostItems.sourceId, sourceIds))
}
