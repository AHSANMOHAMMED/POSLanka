/**
 * Restaurant order totals. Shared by the order item routes and the kitchen item route so every
 * change to a line (add, quantity, cancel) recomputes the bill the same way.
 *
 * Cancelled lines (voided after being sent to the kitchen) are not billed.
 */
import { eq } from 'drizzle-orm'
import { restaurantOrders, restaurantOrderItems } from '@/lib/db/schema'
import { roundCurrency } from '@/lib/utils/currency'
import { calculateItemTax, aggregateTaxBreakdown } from '@/lib/utils/tax-template'
import { resolveTaxTemplatesForItems, getDefaultTaxTemplate, getEffectiveTaxTemplate } from '@/lib/utils/tax-template-resolver'

/** Lines that are billed: everything except cancelled ones. */
export function billableOrderItems<T extends { status?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.status !== 'cancelled')
}

// Recalculate order totals with per-item tax templates
export async function recalculateOrderTotals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  orderId: string,
  tenantId: string
) {
  // A settled (completed / cancelled) order keeps the totals it was billed with
  const [orderRow] = await db.select({ status: restaurantOrders.status })
    .from(restaurantOrders).where(eq(restaurantOrders.id, orderId))
  if (!orderRow || orderRow.status === 'completed' || orderRow.status === 'cancelled') return

  // Get all items for this order
  const orderItems = billableOrderItems(await db.query.restaurantOrderItems.findMany({
    where: eq(restaurantOrderItems.orderId, orderId),
  }) as Array<{ itemId: string | null; unitPrice: string; quantity: number; status: string | null }>)

  // Calculate subtotal with proper rounding
  const subtotal = roundCurrency(orderItems.reduce((sum: number, item: { unitPrice: string; quantity: number }) => {
    return sum + roundCurrency(parseFloat(item.unitPrice) * item.quantity)
  }, 0))

  // Per-item tax calculation using tax templates
  const defaultTemplate = await getDefaultTaxTemplate(db, tenantId)
  const itemIds = orderItems
    .map((oi: { itemId: string | null }) => oi.itemId)
    .filter(Boolean) as string[]
  const itemTemplateMap = itemIds.length > 0
    ? await resolveTaxTemplatesForItems(db, itemIds)
    : new Map()

  const allBreakdowns: Array<Array<{ taxName: string; rate: number; amount: number; accountId: string | null; includedInPrice: boolean }>> = []
  let totalTax = 0

  for (const oi of orderItems as Array<{ itemId: string | null; unitPrice: string; quantity: number }>) {
    const lineTotal = roundCurrency(parseFloat(oi.unitPrice) * oi.quantity)
    if (lineTotal <= 0) continue
    const template = getEffectiveTaxTemplate(itemTemplateMap, oi.itemId, defaultTemplate)
    const taxResult = calculateItemTax(lineTotal, template)
    totalTax += taxResult.totalTax
    if (taxResult.breakdown.length > 0) allBreakdowns.push(taxResult.breakdown)
  }

  totalTax = roundCurrency(totalTax)
  const taxBreakdown = allBreakdowns.length > 0 ? aggregateTaxBreakdown(allBreakdowns) : null

  // Get current order for tip amount
  const currentOrder = await db.query.restaurantOrders.findFirst({
    where: eq(restaurantOrders.id, orderId),
  })
  const tipAmount = currentOrder ? roundCurrency(parseFloat(currentOrder.tipAmount || '0')) : 0

  // Only add exclusive tax to total (inclusive is already in subtotal)
  const exclusiveTax = roundCurrency(
    (taxBreakdown || []).filter(b => !b.includedInPrice).reduce((s, b) => s + b.amount, 0)
  )
  const total = roundCurrency(subtotal + exclusiveTax + tipAmount)

  // Update order totals
  await db.update(restaurantOrders)
    .set({
      subtotal: String(subtotal),
      taxAmount: String(totalTax),
      taxBreakdown: taxBreakdown,
      total: String(total),
      updatedAt: new Date(),
    })
    .where(eq(restaurantOrders.id, orderId))
}
