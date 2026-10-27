import { NextRequest, NextResponse } from 'next/server'
import { reversePromotionRedemptions } from '@/lib/pricing/sale-pricing'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { posCashMovements, posOpeningEntries, sales, saleItems, payments, customers, customerCreditTransactions, warehouseStock, loyaltyTransactions, salesOrders, salesOrderItems, giftCards, giftCardTransactions } from '@/lib/db/schema'
import { applyStockChange } from '@/lib/inventory/apply-stock-change'
import { eq, and, sql } from 'drizzle-orm'
import { hasPermission, requirePermission, requireModule } from '@/lib/auth/roles'
import { allocateSerials } from '@/lib/inventory/serial-numbers'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { notifySaleVoided } from '@/lib/notifications/sales-alerts'
import { roundCurrency, parseCurrency } from '@/lib/utils/currency'
import { postVoidToGL } from '@/lib/accounting/auto-post'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { voidSaleSchema } from '@/lib/validation/schemas/sales'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { SAFE_USER } from '@/lib/db/safe-columns'
import { getSaleLineBatches, restoreSaleLineBatches } from '@/lib/inventory/batches'
import { assertBranchAccess } from '@/lib/auth/branch-access'
import { planBlockMessage, planOnSale } from '@/lib/installments/sale-guard'

// GET single sale
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const sale = await db.query.sales.findFirst({
        where: eq(sales.id, id),
        with: {
          customer: true,
          user: SAFE_USER,
          items: {
            with: {
              item: true,
            },
          },
          payments: true,
        },
      })

      if (!sale) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      // K4: a sale of another branch is not shown to branch-restricted staff
      const branchDenied = await assertBranchAccess(session, sale.warehouseId, db)
      if (branchDenied) return branchDenied

      // Filter payment data to only include safe fields
      const filteredPayments = (sale.payments || []).map(p => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        receivedBy: p.receivedBy,
        createdAt: p.createdAt,
        voidedAt: p.voidedAt,
      }))

      // D1: batch allocations per line
      const batchesByLine = await getSaleLineBatches(db, (sale.items || []).map((i) => i.id))
      const itemsWithBatches = (sale.items || []).map((i) => ({ ...i, batches: batchesByLine.get(i.id) || [] }))

      return NextResponse.json({ ...sale, items: itemsWithBatches, payments: filteredPayments })
    })
  } catch (error) {
    logError('api/sales/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch sale' }, { status: 500 })
  }
}

/**
 * Issue 19: PUT to void a sale directly.
 *
 * H1 — voids after the shift closed. A closed shift's totals and Z report are final, so:
 *  - only users with manageSales may void a sale whose POS shift is no longer open
 *    (403 SHIFT_CLOSED_VOID_FORBIDDEN otherwise);
 *  - the closed shift's closing entry / Z snapshot is never touched;
 *  - when the sale took cash, that cash is handed back from the voiding user's own OPEN shift:
 *    it is recorded there as a 'void_refund' paid-out (no separate GL — the void's reversal
 *    already credits Cash), so that drawer's expected cash and tie-out stay right. Without an
 *    open shift the void is refused (400 OPEN_SHIFT_REQUIRED). Card / credit sales need none.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission to void sales
    const permError = requirePermission(session, 'voidSales')
    if (permError) return permError

    // Resolve valid user ID (session.user.id may be accountId for stale JWTs)
    const userId = await resolveUserIdRequired(session)

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, voidSaleSchema)
    if (!parsed.success) return parsed.response
    const { voidReason } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // K4: branch-restricted staff can only void sales of their own branches
      const target = await db.query.sales.findFirst({ where: eq(sales.id, id), columns: { warehouseId: true } })
      const branchDenied = await assertBranchAccess(session, target?.warehouseId, db)
      if (branchDenied) return branchDenied

      // Use transaction for atomic operations
      const result = await db.transaction(async (tx) => {
        // Lock and get current sale (RLS scopes the query)
        const [sale] = await tx
          .select()
          .from(sales)
          .where(eq(sales.id, id))
          .for('update')

        if (!sale) {
          throw new Error('NOT_FOUND')
        }

        // Can't void an already voided sale
        if (sale.status === 'void') {
          throw new Error('ALREADY_VOIDED')
        }

        // Can't void return sales - they need to be handled differently
        if (sale.isReturn) {
          throw new Error('CANNOT_VOID_RETURN')
        }

        // A sale financed by a hire purchase plan: cancel / settle the plan first
        const hpPlan = await planOnSale(tx, sale.id)
        if (hpPlan) throw new Error(`HP_PLAN_EXISTS:${planBlockMessage(hpPlan)}`)

        // H1: sale of a shift that is already closed (see the rule above)
        let refundShift: typeof posOpeningEntries.$inferSelect | null = null
        let cashToRefund = 0
        if (sale.posOpeningEntryId) {
          const [saleShift] = await tx.select().from(posOpeningEntries).where(eq(posOpeningEntries.id, sale.posOpeningEntryId))
          if (saleShift && saleShift.status !== 'open') {
            if (!hasPermission(session.user.role, 'manageSales', session.user.tenantId, session.user.customRoleId)) {
              throw new Error('SHIFT_CLOSED_VOID_FORBIDDEN')
            }
            const [cashRow] = await tx.select({ cash: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
              .from(payments)
              .where(and(eq(payments.saleId, id), eq(payments.method, 'cash'), sql`${payments.voidedAt} IS NULL`))
            cashToRefund = roundCurrency(parseCurrency(cashRow?.cash))
            if (cashToRefund > 0) {
              const [open] = await tx.select().from(posOpeningEntries)
                .where(and(eq(posOpeningEntries.userId, userId), eq(posOpeningEntries.status, 'open')))
                .for('update')
              if (!open) throw new Error('OPEN_SHIFT_REQUIRED')
              refundShift = open
            }
          }
        }

        // Get sale items to restore stock (RLS scopes the query)
        const saleItemsList = await tx.query.saleItems.findMany({
          where: eq(saleItems.saleId, id),
          with: {
            item: true,
          },
        })

        // Issue #2: Check for existing returns against this sale to avoid double-restoring stock
        const existingReturns = await tx.query.sales.findMany({
          where: and(
            eq(sales.returnAgainst, id),
            eq(sales.isReturn, true),
            sql`${sales.status} != 'void'`
          ),
          with: {
            items: true,
          },
        })

        // Build map of already-returned quantities per itemId
        const returnedQtyMap = new Map<string, number>()
        for (const returnSale of existingReturns) {
          for (const returnItem of returnSale.items) {
            if (returnItem.itemId) {
              const prev = returnedQtyMap.get(returnItem.itemId) || 0
              returnedQtyMap.set(returnItem.itemId, prev + Math.abs(parseFloat(returnItem.quantity)))
            }
          }
        }

        // Restore stock for each item (minus already-returned quantities) through the ledger.
        // returned_quantity is maintained per line by src/lib/sales/returns.ts (and backfilled for
        // legacy returns); fall back to the per-item map for lines that predate it.
        const legacyRemaining = new Map(returnedQtyMap)
        const returnedSerialIds = new Set<string>()
        for (const returnSale of existingReturns) {
          for (const returnItem of returnSale.items) {
            for (const sid of (returnItem.serialNumberIds as string[] | null) || []) returnedSerialIds.add(sid)
          }
        }
        for (const saleItem of saleItemsList) {
          const item = Array.isArray(saleItem.item) ? saleItem.item[0] : saleItem.item
          if (item?.trackStock && sale.warehouseId && saleItem.itemId) {
            const originalQty = parseFloat(saleItem.quantity)
            let alreadyReturned = parseFloat(saleItem.returnedQuantity || '0')
            if (!(alreadyReturned > 0)) {
              const pool = legacyRemaining.get(saleItem.itemId) || 0
              alreadyReturned = Math.min(pool, originalQty)
              legacyRemaining.set(saleItem.itemId, pool - alreadyReturned)
            }
            // Only restore the quantity that hasn't already been returned — in base units (H5:
            // a line sold in boxes moves quantity × uom_factor pieces)
            const uomFactor = parseFloat(saleItem.uomFactor || '1') || 1
            const qty = Math.round(Math.max(0, originalQty - alreadyReturned) * uomFactor * 1000) / 1000

            if (qty > 0) {
              const input = {
                tenantId: session.user.tenantId,
                warehouseId: sale.warehouseId,
                itemId: saleItem.itemId,
                mode: 'delta' as const,
                qty,
                type: 'in' as const,
                referenceType: 'sale_void',
                referenceId: id,
                notes: `Stock restored from voided sale ${sale.invoiceNo}`,
                userId,
                source: 'pos',
                idempotencyKey: `sale_void:${id}:${saleItem.id}`,
              }
              await applyStockChange(tx, input)
            }
          }

          // D1: put the not-yet-returned batch quantities back into the batches they came from
          // (sale_item_batches.returned_quantity tracks what earlier returns already restored)
          if (sale.warehouseId && parseFloat(saleItem.quantity) > 0) {
            await restoreSaleLineBatches(tx, {
              tenantId: session.user.tenantId,
              saleItemId: saleItem.id,
              qty: Math.round(parseFloat(saleItem.quantity) * (parseFloat(saleItem.uomFactor || '1') || 1) * 1000) / 1000,
              toWarehouseId: sale.warehouseId,
            })
          }

          // Restore serial numbers to 'available' status (skip serials already returned — they
          // were made available by the return and may have been resold since)
          const serialIds = ((saleItem.serialNumberIds as string[] | null) || []).filter(sid => !returnedSerialIds.has(sid))
          if (serialIds.length) {
            await allocateSerials(tx, {
              tenantId: session.user.tenantId,
              serialNumberIds: serialIds,
              newStatus: 'available',
              referenceType: 'sale_void',
              referenceId: id,
              changedBy: userId,
              notes: `Serials restored from voided sale ${sale.invoiceNo}`,
            })
          }
        }

        // H5: the sale's promotion redemptions stop counting (usage limits free up again)
        await reversePromotionRedemptions(tx, id)

        // Reverse customer credit transactions if any
        if (sale.customerId) {
          const creditTransactions = await tx.query.customerCreditTransactions.findMany({
            where: and(
              eq(customerCreditTransactions.referenceType, 'sale'),
              eq(customerCreditTransactions.referenceId, id)
            ),
          })

          if (creditTransactions.length > 0) {
            // Lock customer for update
            const [customer] = await tx
              .select()
              .from(customers)
              .where(eq(customers.id, sale.customerId))
              .for('update')

            if (customer) {
              const originalBalance = parseFloat(customer.balance || '0')
              let newBalance = originalBalance

              for (const trans of creditTransactions) {
                const amount = parseFloat(trans.amount)
                if (trans.type === 'use') {
                  // Credit was used for payment - restore it
                  newBalance = roundCurrency(newBalance + Math.abs(amount))
                } else if (trans.type === 'overpayment') {
                  // Overpayment was added to credit - deduct it back
                  newBalance = roundCurrency(newBalance - Math.abs(amount))
                }
              }

              // Prevent negative balance
              newBalance = Math.max(0, newBalance)

              // Update customer balance
              await tx.update(customers)
                .set({
                  balance: newBalance.toFixed(2),
                  updatedAt: new Date(),
                })
                .where(eq(customers.id, sale.customerId))

              // Create reversal credit transaction record
              const balanceChange = roundCurrency(newBalance - originalBalance)
              if (balanceChange !== 0) {
                await tx.insert(customerCreditTransactions).values({
                  tenantId: session.user.tenantId,
                  customerId: sale.customerId,
                  type: 'adjustment',
                  amount: balanceChange.toFixed(2),
                  balanceAfter: newBalance.toFixed(2),
                  referenceType: 'sale_void',
                  referenceId: id,
                  notes: `Credit adjusted from voided sale ${sale.invoiceNo}`,
                  createdBy: userId,
                })
              }
            }
          }
        }

        // Reverse loyalty points earned/redeemed from this sale
        if (sale.customerId) {
          const loyaltyTxns = await tx.query.loyaltyTransactions.findMany({
            where: and(
              eq(loyaltyTransactions.saleId, id),
              eq(loyaltyTransactions.customerId, sale.customerId)
            ),
          })

          if (loyaltyTxns.length > 0) {
            // Lock customer for update
            const [customer] = await tx
              .select()
              .from(customers)
              .where(eq(customers.id, sale.customerId))
              .for('update')

            if (customer) {
              let currentPoints = customer.loyaltyPoints || 0

              for (const txn of loyaltyTxns) {
                if (txn.type === 'earn') {
                  // Points were earned - deduct them
                  currentPoints = Math.max(0, currentPoints - txn.points)
                } else if (txn.type === 'redeem') {
                  // Points were redeemed (negative value) - restore them
                  currentPoints += Math.abs(txn.points)
                }
              }

              // Create reversal loyalty transaction
              const netPointChange = currentPoints - (customer.loyaltyPoints || 0)
              if (netPointChange !== 0) {
                await tx.insert(loyaltyTransactions).values({
                  tenantId: session.user.tenantId,
                  customerId: sale.customerId,
                  type: 'adjustment',
                  points: netPointChange,
                  balanceAfter: currentPoints,
                  saleId: id,
                  notes: `Loyalty points reversed from voided sale ${sale.invoiceNo}`,
                })
              }

              await tx.update(customers)
                .set({
                  loyaltyPoints: currentPoints,
                  updatedAt: new Date(),
                })
                .where(eq(customers.id, sale.customerId))
            }
          }
        }

        // Gift cards. (1) Cards ISSUED by this sale: the GL liability is reversed below, so the
        // card must stop working — unless the customer already spent from it (then the money is
        // gone and the sale cannot simply be voided). (2) Cards REDEEMED on this sale get the
        // amount back (the GL reversal restores the liability).
        const issuedCards = await tx.select().from(giftCards)
          .where(eq(giftCards.purchaseSaleId, id))
          .for('update')
        for (const card of issuedCards) {
          if (card.status === 'blocked') continue
          if (parseCurrency(card.currentBalance) + 0.001 < parseCurrency(card.initialBalance)) {
            throw new Error(`GIFT_CARD_USED:${card.cardNumber}`)
          }
        }
        for (const card of issuedCards) {
          if (card.status === 'blocked') continue
          await tx.update(giftCards)
            .set({ currentBalance: '0', status: 'blocked' })
            .where(eq(giftCards.id, card.id))
          await tx.insert(giftCardTransactions).values({
            tenantId: session.user.tenantId,
            giftCardId: card.id,
            type: 'void',
            amount: String(-parseCurrency(card.currentBalance)),
            balanceAfter: '0',
            saleId: id,
            createdBy: userId,
          })
        }
        const redemptions = await tx.select().from(giftCardTransactions)
          .where(and(eq(giftCardTransactions.saleId, id), eq(giftCardTransactions.type, 'redemption')))
        const redeemedByCard = new Map<string, number>()
        for (const r of redemptions) {
          redeemedByCard.set(r.giftCardId, roundCurrency((redeemedByCard.get(r.giftCardId) || 0) + parseCurrency(r.amount)))
        }
        for (const [giftCardId, amount] of redeemedByCard) {
          if (!(amount > 0)) continue
          const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, giftCardId)).for('update')
          if (!card) continue
          const newBalance = roundCurrency(parseCurrency(card.currentBalance) + amount)
          await tx.update(giftCards)
            .set({ currentBalance: String(newBalance), status: card.status === 'used' ? 'active' : card.status })
            .where(eq(giftCards.id, giftCardId))
          await tx.insert(giftCardTransactions).values({
            tenantId: session.user.tenantId,
            giftCardId,
            type: 'void_refund',
            amount: String(amount),
            balanceAfter: String(newBalance),
            saleId: id,
            createdBy: userId,
          })
        }

        // RC-12: Void all associated payments with full audit trail
        await tx.update(payments)
          .set({
            voidedAt: new Date(),
            voidedBy: userId,
            voidReason: voidReason,
          })
          .where(eq(payments.saleId, id))

        // Restore SO state when voiding an SO-linked invoice
        let restoredSalesOrderId: string | null = null
        if (sale.salesOrderId) {
          // Lock the sales order
          const [linkedOrder] = await tx
            .select()
            .from(salesOrders)
            .where(eq(salesOrders.id, sale.salesOrderId))
            .for('update')

          if (linkedOrder) {
            // Get SO items for matching
            const soItems = await tx
              .select()
              .from(salesOrderItems)
              .where(eq(salesOrderItems.salesOrderId, sale.salesOrderId))

            // For each voided sale item, decrement fulfilledQuantity and re-reserve stock
            for (const saleItem of saleItemsList) {
              if (!saleItem.itemId) continue

              const originalQty = parseFloat(saleItem.quantity)
              const alreadyReturned = returnedQtyMap.get(saleItem.itemId) || 0
              const restoreQty = Math.max(0, originalQty - alreadyReturned)

              if (restoreQty <= 0) continue

              // Find matching SO item by itemId
              const soItem = soItems.find(si => si.itemId === saleItem.itemId)
              if (soItem) {
                const currentFulfilled = parseFloat(soItem.fulfilledQuantity || '0')
                const rawNewFulfilled = currentFulfilled - restoreQty
                if (rawNewFulfilled < 0) {
                  console.warn(`Data inconsistency: fulfilledQuantity would go negative for SO item ${soItem.id} (current: ${currentFulfilled}, restore: ${restoreQty}). Clamping to 0.`)
                }
                const newFulfilled = Math.max(0, rawNewFulfilled)
                await tx.update(salesOrderItems)
                  .set({ fulfilledQuantity: newFulfilled.toString() })
                  .where(eq(salesOrderItems.id, soItem.id))
              }

              // Re-reserve stock on warehouseStock (cap to currentStock to prevent over-reservation)
              if (sale.warehouseId) {
                const [stock] = await tx
                  .select()
                  .from(warehouseStock)
                  .where(and(
                    eq(warehouseStock.itemId, saleItem.itemId),
                    eq(warehouseStock.warehouseId, sale.warehouseId)
                  ))
                  .for('update')

                if (stock) {
                  await tx.update(warehouseStock)
                    .set({
                      // 0184: quantities are in the line's unit; the reservation is in base units
                      reservedStock: sql`LEAST(${warehouseStock.reservedStock} + ${Math.round(restoreQty * (Number(saleItem.uomFactor) || 1) * 1000) / 1000}, ${warehouseStock.currentStock})`,
                      updatedAt: new Date(),
                    })
                    .where(eq(warehouseStock.id, stock.id))
                }
              }
            }

            // Recalculate SO status based on updated fulfilled quantities
            const updatedSoItems = await tx
              .select()
              .from(salesOrderItems)
              .where(eq(salesOrderItems.salesOrderId, sale.salesOrderId))

            const allZero = updatedSoItems.every(item =>
              parseCurrency(item.fulfilledQuantity || '0') === 0
            )
            const allFulfilled = updatedSoItems.every(item =>
              parseCurrency(item.fulfilledQuantity || '0') >= parseCurrency(item.quantity)
            )

            let newStatus: 'confirmed' | 'partially_fulfilled' | 'fulfilled'
            if (allZero) {
              newStatus = 'confirmed'
            } else if (allFulfilled) {
              newStatus = 'fulfilled'
            } else {
              newStatus = 'partially_fulfilled'
            }

            await tx.update(salesOrders)
              .set({ status: newStatus, updatedAt: new Date() })
              .where(eq(salesOrders.id, sale.salesOrderId))

            restoredSalesOrderId = sale.salesOrderId
          }
        }

        // Reverse GL entries for all voucher types associated with this sale
        await postVoidToGL(tx, session.user.tenantId, 'sale', id)
        await postVoidToGL(tx, session.user.tenantId, 'gift_card_sale', id)
        await postVoidToGL(tx, session.user.tenantId, 'payment', id)
        await postVoidToGL(tx, session.user.tenantId, 'credit_payment', id)
        // If this sale was from a work order invoice, also reverse WIP-to-COGS entries
        if (sale.workOrderId) {
          await postVoidToGL(tx, session.user.tenantId, 'work_order_invoice', sale.workOrderId)
        }

        // Void the sale
        const [voidedSale] = await tx.update(sales)
          .set({
            status: 'void',
            voidReason,
            voidedAt: new Date(),
            voidedBy: userId,
          })
          .where(eq(sales.id, id))
          .returning()

        // K1: cheques taken for this sale and not yet banked go back to the customer (the void
        // above already reversed their payment in the ledger)
        await tx.execute(sql`
          UPDATE cheques SET status = 'cancelled', cancelled_at = now(), settlement_reversed = true,
            bounce_reason = ${`Sale voided: ${voidReason}`.slice(0, 1000)}, updated_at = now(), updated_by = ${userId},
            status_history = status_history || jsonb_build_array(jsonb_build_object('status', 'cancelled', 'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'by', ${userId}::text, 'note', 'Sale voided'))
          WHERE sale_id = ${id} AND status IN ('pending', 'deposited')`)

        // H1: cash of a closed shift's sale leaves the voiding user's current drawer
        let refundMovementNo: string | null = null
        if (refundShift && cashToRefund > 0) {
          const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(posCashMovements)
            .where(eq(posCashMovements.openingEntryId, refundShift.id))
          refundMovementNo = `${refundShift.entryNumber}-CM${String(n + 1).padStart(2, '0')}`
          await tx.insert(posCashMovements).values({
            tenantId: session.user.tenantId,
            movementNo: refundMovementNo,
            openingEntryId: refundShift.id,
            posProfileId: refundShift.posProfileId,
            type: 'paid_out',
            category: 'void_refund',
            amount: String(cashToRefund),
            note: `Cash refund of voided ${sale.invoiceNo} (closed shift): ${voidReason}`.slice(0, 1000),
            createdBy: userId,
            approvedBy: userId,
          })
        }

        // WS-2/WS-3: Return affected itemIds and warehouseId for specific broadcasts
        const affectedItemIds = [...new Set(saleItemsList.map(i => i.itemId).filter(Boolean))] as string[]
        return { voidedSale, affectedItemIds, warehouseId: sale.warehouseId, restoredSalesOrderId, before: sale, refundShift, refundMovementNo, cashToRefund }
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'sale', 'updated', id, {
        userId,
        activityAction: 'cancel',
        entityName: result.voidedSale.invoiceNo,
        description: `Voided sale ${result.voidedSale.invoiceNo}: ${voidReason}`,
        metadata: {
          posOpeningEntryId: result.before.posOpeningEntryId,
          reason: voidReason,
          refundShiftId: result.refundShift?.id || null,
          refundMovementNo: result.refundMovementNo,
          cashRefunded: result.cashToRefund || 0,
          voidedBy: userId,
          before: { status: result.before.status, total: result.before.total, paidAmount: result.before.paidAmount },
          after: { status: 'void' },
        },
      })
      if (result.refundShift) logAndBroadcast(session.user.tenantId, 'pos-shift', 'updated', result.refundShift.id)
      notifySaleVoided(session.user.tenantId, {
        saleId: id, invoiceNo: result.voidedSale.invoiceNo, total: Math.abs(Number(result.voidedSale.total) || 0),
        reason: voidReason, actorUserId: userId, actorName: session.user.name,
      })
      // WS-3: Broadcast specific item stock updates (not 'all')
      for (const itemId of result.affectedItemIds) {
        logAndBroadcast(session.user.tenantId, 'item', 'updated', itemId)
      }
      // WS-2: Broadcast warehouse-stock updates
      if (result.warehouseId) {
        logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', result.warehouseId)
      }
      // Broadcast SO update if we restored its state
      if (result.restoredSalesOrderId) {
        logAndBroadcast(session.user.tenantId, 'sales-order', 'updated', result.restoredSalesOrderId)
      }

      return NextResponse.json(result.voidedSale)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    if (message.startsWith('HP_PLAN_EXISTS:')) {
      return NextResponse.json({ error: message.slice('HP_PLAN_EXISTS:'.length), code: 'HP_PLAN_EXISTS' }, { status: 409 })
    }
    logError('api/sales/[id]', error)

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }
    if (message === 'ALREADY_VOIDED') {
      return NextResponse.json({ error: 'This sale has already been voided' }, { status: 400 })
    }
    if (message.startsWith('GIFT_CARD_USED:')) {
      return NextResponse.json({
        error: `Gift card ${message.slice('GIFT_CARD_USED:'.length)} sold on this invoice has already been used; the sale cannot be voided`,
        code: 'GIFT_CARD_USED',
      }, { status: 400 })
    }
    if (message === 'SHIFT_CLOSED_VOID_FORBIDDEN') {
      return NextResponse.json({ error: 'This sale belongs to a closed shift. Only a supervisor can void it.', code: 'SHIFT_CLOSED_VOID_FORBIDDEN' }, { status: 403 })
    }
    if (message === 'OPEN_SHIFT_REQUIRED') {
      return NextResponse.json({ error: 'The sale was paid in cash on a closed shift. Open your own shift so the refund is taken from your drawer.', code: 'OPEN_SHIFT_REQUIRED' }, { status: 400 })
    }
    if (message === 'CANNOT_VOID_RETURN') {
      return NextResponse.json({ error: 'Return transactions cannot be voided directly' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to void sale' }, { status: 500 })
  }
}
