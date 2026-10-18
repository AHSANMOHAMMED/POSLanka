import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/roles'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { layaways, layawayItems, layawayPayments, customers, customerCreditTransactions, users, items as itemsTable } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { parseCurrency, roundCurrency } from '@/lib/utils/currency'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateLayawaySchema } from '@/lib/validation/schemas/layaways'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single layaway with items and payments
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    // Get layaway with joins (RLS filters by tenant)
    const [layaway] = await db
      .select({
        id: layaways.id,
        layawayNo: layaways.layawayNo,
        customerId: layaways.customerId,
        customerName: customers.name,
        customerPhone: customers.phone,
        customerEmail: customers.email,
        subtotal: layaways.subtotal,
        taxAmount: layaways.taxAmount,
        total: layaways.total,
        depositAmount: layaways.depositAmount,
        paidAmount: layaways.paidAmount,
        balanceDue: layaways.balanceDue,
        status: layaways.status,
        dueDate: layaways.dueDate,
        notes: layaways.notes,
        cancellationReason: layaways.cancellationReason,
        cancelledAt: layaways.cancelledAt,
        createdBy: layaways.createdBy,
        createdByName: users.fullName,
        createdAt: layaways.createdAt,
        updatedAt: layaways.updatedAt,
      })
      .from(layaways)
      .leftJoin(customers, eq(layaways.customerId, customers.id))
      .leftJoin(users, eq(layaways.createdBy, users.id))
      .where(eq(layaways.id, id))

    if (!layaway) {
      return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
    }

    // Get items
    const items = await db
      .select({
        id: layawayItems.id,
        itemId: layawayItems.itemId,
        itemName: layawayItems.itemName,
        itemSku: itemsTable.sku,
        itemBarcode: itemsTable.barcode,
        itemOemPartNumber: itemsTable.oemPartNumber,
        itemPluCode: itemsTable.pluCode,
        quantity: layawayItems.quantity,
        unitPrice: layawayItems.unitPrice,
        total: layawayItems.total,
      })
      .from(layawayItems)
      .leftJoin(itemsTable, eq(layawayItems.itemId, itemsTable.id))
      .where(eq(layawayItems.layawayId, id))

    // Get payments
    const payments = await db
      .select({
        id: layawayPayments.id,
        amount: layawayPayments.amount,
        paymentMethod: layawayPayments.paymentMethod,
        reference: layawayPayments.reference,
        receivedBy: layawayPayments.receivedBy,
        receivedByName: users.fullName,
        createdAt: layawayPayments.createdAt,
      })
      .from(layawayPayments)
      .leftJoin(users, eq(layawayPayments.receivedBy, users.id))
      .where(eq(layawayPayments.layawayId, id))

    return { data: { ...layaway, items, payments } }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }
  return NextResponse.json(result.data)
}

// PUT update layaway
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const parsed = await validateBody(request, updateLayawaySchema)
  if (!parsed.success) return parsed.response
  const { dueDate, notes, status, cancellationReason, expectedUpdatedAt } = parsed.data

  // Handle cancellation with transaction
  if (status === 'cancelled') {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'manageSales')
      if (permError) return { error: permError }

      // Get current layaway with lock to prevent concurrent modification (RLS filters by tenant)
      const [currentLayaway] = await tx
        .select()
        .from(layaways)
        .where(eq(layaways.id, id))
        .for('update')

      if (!currentLayaway) {
        return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
      }

      // Optimistic locking check
      if (expectedUpdatedAt) {
        const clientTime = new Date(expectedUpdatedAt).getTime()
        const serverTime = currentLayaway.updatedAt ? new Date(currentLayaway.updatedAt).getTime() : 0
        if (serverTime > clientTime) {
          return {
            error: NextResponse.json({
              error: 'This record was modified by another user. Please refresh and try again.',
              code: 'CONFLICT'
            }, { status: 409 })
          }
        }
      }

      if (currentLayaway.status !== 'active') {
        return { error: NextResponse.json({ error: 'Only active layaways can be cancelled' }, { status: 400 }) }
      }

      // Refund paid amount to customer credit balance if any payments were made
      const paidAmount = parseCurrency(currentLayaway.paidAmount)
      let refundProcessed = false

      if (paidAmount > 0 && currentLayaway.customerId) {
        // Lock customer row and update credit balance
        const [customer] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, currentLayaway.customerId))
          .for('update')

        if (customer) {
          const refundAmount = roundCurrency(paidAmount)
          const newBalance = roundCurrency(parseCurrency(customer.balance) + refundAmount)

          // Create credit transaction
          await tx.insert(customerCreditTransactions).values({
            tenantId: session.user.tenantId,
            customerId: currentLayaway.customerId,
            type: 'refund',
            amount: refundAmount.toString(),
            balanceAfter: newBalance.toString(),
            referenceType: 'layaway',
            referenceId: currentLayaway.id,
            notes: `Refund from cancelled layaway ${currentLayaway.layawayNo}${cancellationReason ? ` - ${cancellationReason}` : ''}`,
            createdBy: session.user.id,
          })

          // Update customer balance
          await tx.update(customers)
            .set({
              balance: newBalance.toString(),
              updatedAt: new Date(),
            })
            .where(eq(customers.id, currentLayaway.customerId))

          refundProcessed = true
        }
      }

      // Reverse GL entries for layaway payments (Dr Cash, Cr Advance were posted)
      try {
        await reverseGLEntries(tx, session.user.tenantId, 'layaway_payment', id)
      } catch {
        // No GL entries to reverse is fine — may not have been posted
      }

      const [updated] = await tx.update(layaways)
        .set({
          status: 'cancelled',
          cancellationReason: cancellationReason || null,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(layaways.id, id))
        .returning()

      return { data: updated, tenantId: session.user.tenantId, customerId: currentLayaway.customerId, refundProcessed }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    logAndBroadcast(result.tenantId, 'layaway', 'updated', id)
    if (result.customerId && result.refundProcessed) {
      logAndBroadcast(result.tenantId, 'customer', 'updated', result.customerId)
    }
    return NextResponse.json(result.data)
  }

  // Non-cancellation update (editing notes, dueDate)
  const result = await withAuthTenant(async (session, db) => {
    const permError = requirePermission(session, 'manageSales')
    if (permError) return { error: permError }

    const [currentLayaway] = await db
      .select()
      .from(layaways)
      .where(eq(layaways.id, id))

    if (!currentLayaway) {
      return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
    }

    if (expectedUpdatedAt) {
      const clientTime = new Date(expectedUpdatedAt).getTime()
      const serverTime = currentLayaway.updatedAt ? new Date(currentLayaway.updatedAt).getTime() : 0
      if (serverTime > clientTime) {
        return {
          error: NextResponse.json({
            error: 'This record was modified by another user. Please refresh and try again.',
            code: 'CONFLICT'
          }, { status: 409 })
        }
      }
    }

    if (currentLayaway.status !== 'active') {
      return { error: NextResponse.json({ error: 'Only active layaways can be edited' }, { status: 400 }) }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (dueDate !== undefined) updateData.dueDate = dueDate || null
    if (notes !== undefined) updateData.notes = notes || null

    const [updated] = await db.update(layaways)
      .set(updateData)
      .where(eq(layaways.id, id))
      .returning()

    return { data: updated, tenantId: session.user.tenantId }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  logAndBroadcast(result.tenantId, 'layaway', 'updated', id)
  return NextResponse.json(result.data)
}

// DELETE layaway
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

  const result = await withAuthTenantTransaction(async (session, tx) => {
    const permError = requirePermission(session, 'manageSales')
    if (permError) return { error: permError }

    // Get current layaway with lock (RLS filters by tenant)
    const [currentLayaway] = await tx
      .select()
      .from(layaways)
      .where(eq(layaways.id, id))
      .for('update')

    if (!currentLayaway) {
      return { error: NextResponse.json({ error: 'Layaway not found' }, { status: 404 }) }
    }

    if (currentLayaway.status !== 'active') {
      return { error: NextResponse.json({ error: 'Only active layaways can be deleted' }, { status: 400 }) }
    }

    // Check if there are payments beyond the initial deposit
    const paymentsResult = await tx
      .select({ id: layawayPayments.id, amount: layawayPayments.amount })
      .from(layawayPayments)
      .where(eq(layawayPayments.layawayId, id))

    // Calculate total payments
    const totalPayments = paymentsResult.reduce((sum, p) => sum + parseCurrency(p.amount), 0)
    const depositAmount = parseCurrency(currentLayaway.depositAmount)

    // Allow deletion only if payments equal the deposit (no additional payments)
    if (totalPayments > depositAmount + 0.01) {
      return {
        error: NextResponse.json({
          error: 'Cannot delete layaway with payments beyond the initial deposit. Cancel or forfeit instead.'
        }, { status: 400 })
      }
    }

    // Delete payments
    await tx.delete(layawayPayments)
      .where(eq(layawayPayments.layawayId, id))

    // Delete items
    await tx.delete(layawayItems)
      .where(eq(layawayItems.layawayId, id))

    // Delete layaway
    await tx.delete(layaways)
      .where(eq(layaways.id, id))

    return { data: { success: true }, tenantId: session.user.tenantId }
  })

  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if ('error' in result) {
    return result.error
  }

  logAndBroadcast(result.tenantId, 'layaway', 'deleted', id)
  return NextResponse.json(result.data)
}
