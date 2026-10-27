import { NextRequest, NextResponse } from 'next/server'
import { currentOpenShiftId } from '@/lib/pos/shift-collections'
import { requirePermission } from '@/lib/auth/roles'
import { hasAnyPermission, LAYAWAY_VIEW_PERMISSIONS } from '@/lib/auth/field-access'
import { withAuthTenant, withAuthTenantTransaction } from '@/lib/db'
import { layaways, layawayItems, layawayPayments, customers, users, items as itemsTable } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, or, inArray } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { postLayawayPaymentToGL } from '@/lib/accounting/auto-post'
import { roundCurrency } from '@/lib/utils/currency'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { layawaysListSchema, createLayawaySchema } from '@/lib/validation/schemas/layaways'
import { nextDocNo } from '@/lib/documents/numbering'

// Minimum deposit percentage required (10% of total)
const MIN_DEPOSIT_PERCENTAGE = 0.10

/** Validation failure detected inside the transaction (rolls it back, answered with 400). */
class LayawayInputError extends Error {}

// GET all layaways for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, layawaysListSchema)
    if (!parsed.success) return parsed.response

    const { all, page, pageSize, search, status, customerId } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      // H4: layaways are taken and paid at the POS; other roles need sales / report access
      if (!hasAnyPermission(session, LAYAWAY_VIEW_PERMISSIONS)) return { forbidden: true as const }

      // Build where conditions - RLS handles tenant filtering
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(layaways.layawayNo, `%${escaped}%`),
            ilike(customers.name, `%${escaped}%`)
          )!
        )
      }

      if (status && status !== 'all') {
        conditions.push(eq(layaways.status, status as 'active' | 'completed' | 'cancelled' | 'forfeited'))
      }

      if (customerId) {
        conditions.push(eq(layaways.customerId, customerId))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all layaways (for dropdowns)
      if (all) {
        const data = await db
          .select({
            id: layaways.id,
            layawayNo: layaways.layawayNo,
            customerId: layaways.customerId,
            customerName: customers.name,
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
          .where(whereClause)
          .orderBy(desc(layaways.createdAt))
          .limit(1000)

        return { data, isAll: true }
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(layaways)
        .leftJoin(customers, eq(layaways.customerId, customers.id))
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results
      const data = await db
        .select({
          id: layaways.id,
          layawayNo: layaways.layawayNo,
          customerId: layaways.customerId,
          customerName: customers.name,
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
        .where(whereClause)
        .orderBy(desc(layaways.createdAt))
        .limit(pageSize)
        .offset(offset)

      return { data, pagination: { page, pageSize, total, totalPages } }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('forbidden' in result) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Return array directly for 'all' mode, or paginated response
    if ('isAll' in result && result.isAll) {
      return NextResponse.json(result.data)
    }
    return NextResponse.json({ data: result.data, pagination: result.pagination })
  } catch (error) {
    logError('api/layaways', error)
    console.error('GET /api/layaways error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch layaways' },
      { status: 500 }
    )
  }
}

// POST create new layaway
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, createLayawaySchema)
  if (!parsed.success) return parsed.response

  const { customerId, items, depositAmount, taxAmount, dueDate, notes } = parsed.data

  // Calculate totals from items
  let subtotal = 0
  for (const item of items) {
    if (!item.itemName || item.quantity <= 0 || item.unitPrice < 0) {
      return NextResponse.json({ error: 'Invalid item data' }, { status: 400 })
    }
    const itemTotal = roundCurrency(item.quantity * item.unitPrice)
    subtotal += itemTotal
  }
  subtotal = roundCurrency(subtotal)
  const tax = roundCurrency(taxAmount)
  const total = roundCurrency(subtotal + tax)

  // Validate deposit amount
  const deposit = roundCurrency(depositAmount || 0)
  const minDeposit = roundCurrency(total * MIN_DEPOSIT_PERCENTAGE)

  if (deposit < minDeposit) {
    return NextResponse.json({
      error: `Minimum deposit required is ${minDeposit.toFixed(2)} (${(MIN_DEPOSIT_PERCENTAGE * 100).toFixed(0)}% of total)`
    }, { status: 400 })
  }

  if (deposit > total) {
    return NextResponse.json({ error: 'Deposit cannot exceed total amount' }, { status: 400 })
  }

  const balanceDue = roundCurrency(total - deposit)

  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'createSales')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      // Validate customer exists (RLS filters by tenant)
      const [customer] = await tx
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.id, customerId))

      if (!customer) {
        return { error: NextResponse.json({ error: 'Customer not found' }, { status: 404 }) }
      }

      // Item ids must be this tenant's items (RLS-scoped lookup); completion turns them into
      // stock movements and sale lines.
      const itemIds = [...new Set(items.map(i => i.itemId).filter((x): x is string => !!x))]
      if (itemIds.length > 0) {
        const found = await tx.select({ id: itemsTable.id }).from(itemsTable).where(inArray(itemsTable.id, itemIds))
        if (found.length !== itemIds.length) {
          return { error: NextResponse.json({ error: 'One or more items were not found' }, { status: 400 }) }
        }
      }

      // Generate layaway number with lock
      const layawayNo = await nextDocNo(tx, session.user.tenantId, 'layaway')

      // Create layaway
      const [newLayaway] = await tx.insert(layaways).values({
        tenantId: session.user.tenantId,
        layawayNo,
        customerId,
        subtotal: subtotal.toString(),
        taxAmount: tax.toString(),
        total: total.toString(),
        depositAmount: deposit.toString(),
        paidAmount: deposit.toString(), // Initial payment is the deposit
        balanceDue: balanceDue.toString(),
        status: 'active',
        dueDate: dueDate || null,
        notes: notes || null,
        createdBy: session.user.id,
      }).returning()

      // Add items
      const layawayItemsData = items.map((item) => {
        const itemTotal = roundCurrency(item.quantity * item.unitPrice)
        return {
          tenantId: session.user.tenantId,
          layawayId: newLayaway.id,
          itemId: item.itemId || null,
          itemName: item.itemName,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          total: itemTotal.toString(),
        }
      })

      await tx.insert(layawayItems).values(layawayItemsData)

      // Dual mode: try template-based tax recalculation
      const lineItems = items.map(item => ({
        itemId: item.itemId || null,
        lineTotal: roundCurrency(item.quantity * item.unitPrice),
      }))
      const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'sales' })

      if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
        // Template configured — update with computed values
        const newTotal = roundCurrency(taxResult.subtotal + taxResult.totalTax)
        const newBalanceDue = roundCurrency(newTotal - deposit)
        // The deposit was validated against the client-side total; re-check it against the
        // template total so a layaway can never start over-paid (negative balance due).
        if (deposit > newTotal + 0.001) {
          throw new LayawayInputError(`Deposit cannot exceed total amount (${newTotal.toFixed(2)})`)
        }
        const newMinDeposit = roundCurrency(newTotal * MIN_DEPOSIT_PERCENTAGE)
        if (deposit < newMinDeposit) {
          throw new LayawayInputError(`Minimum deposit required is ${newMinDeposit.toFixed(2)} (${(MIN_DEPOSIT_PERCENTAGE * 100).toFixed(0)}% of total)`)
        }
        await tx.update(layaways)
          .set({
            subtotal: taxResult.subtotal.toString(),
            taxAmount: taxResult.totalTax.toString(),
            taxBreakdown: taxResult.taxBreakdown,
            total: newTotal.toString(),
            balanceDue: newBalanceDue.toString(),
          })
          .where(eq(layaways.id, newLayaway.id))
      }

      // Record the initial deposit payment
      await tx.insert(layawayPayments).values({
        tenantId: session.user.tenantId,
        layawayId: newLayaway.id,
        amount: deposit.toString(),
        paymentMethod: 'cash', // Default to cash for initial deposit
        reference: 'Initial deposit',
        receivedBy: session.user.id,
        // 0187: the deposit goes into this user's drawer / open shift (none → no shift)
        posOpeningEntryId: await currentOpenShiftId(tx, session.user.id),
      })

      // Post deposit to GL: Dr Cash, Cr Advance Received
      try {
        await postLayawayPaymentToGL(tx, session.user.tenantId, {
          layawayId: newLayaway.id,
          layawayNo: newLayaway.layawayNo,
          paymentDate: new Date().toISOString().split('T')[0],
          amount: deposit,
          paymentMethod: 'cash',
          customerId,
          costCenterId: null,
        })
      } catch (glErr) {
        console.warn('[GL] Failed to post layaway deposit GL entry:', glErr)
      }

      return { data: newLayaway, tenantId: session.user.tenantId }
    })

    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ('error' in result) {
      return result.error
    }

    // Broadcast the change to connected clients
    logAndBroadcast(result.tenantId, 'layaway', 'created', result.data.id)

    return NextResponse.json(result.data)
  } catch (error) {
    if (error instanceof LayawayInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logError('api/layaways', error)
    console.error('POST /api/layaways error:', error)
    return NextResponse.json(
      { error: 'Failed to create layaway' },
      { status: 500 }
    )
  }
}
