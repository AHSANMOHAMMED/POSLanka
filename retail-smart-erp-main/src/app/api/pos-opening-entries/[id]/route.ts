import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posOpeningEntries, sales } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import type { PaymentMethod } from '@/lib/db/schema'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePosOpeningEntrySchema } from '@/lib/validation/schemas/pos'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET a single opening entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const entry = await db.query.posOpeningEntries.findFirst({
        where: eq(posOpeningEntries.id, id),
        with: {
          posProfile: {
            with: {
              warehouse: true,
              paymentMethods: true,
            },
          },
          warehouse: true,
          balances: true,
          user: true,
          closingEntry: true,
          sales: {
            orderBy: (sales, { desc }) => [desc(sales.createdAt)],
          },
        },
      })

      if (!entry) {
        return NextResponse.json({ error: 'Opening entry not found' }, { status: 404 })
      }

      // Calculate totals from sales
      const salesTotal = entry.sales.reduce((sum, sale) => {
        if (!sale.isReturn) {
          return sum + parseFloat(sale.total)
        }
        return sum
      }, 0)

      const returnsTotal = entry.sales.reduce((sum, sale) => {
        if (sale.isReturn) {
          return sum + Math.abs(parseFloat(sale.total))
        }
        return sum
      }, 0)

      // Aggregate sales by payment method
      const paymentMethodBreakdown: Record<string, {
        sales: number
        returns: number
        netSales: number
        transactionCount: number
      }> = {}

      // Initialize with all possible payment methods from the schema
      const allPaymentMethods: PaymentMethod[] = ['cash', 'card', 'bank_transfer', 'credit', 'gift_card']
      
      allPaymentMethods.forEach(method => {
        paymentMethodBreakdown[method] = {
          sales: 0,
          returns: 0,
          netSales: 0,
          transactionCount: 0
        }
      })

      // Process each sale
      entry.sales.forEach(sale => {
        const method = sale.paymentMethod as PaymentMethod
        if (!method || !paymentMethodBreakdown[method]) {
          // Skip if payment method is null or not recognized
          return
        }

        const amount = parseFloat(sale.total)
        if (sale.isReturn) {
          paymentMethodBreakdown[method].returns += Math.abs(amount)
          paymentMethodBreakdown[method].netSales -= Math.abs(amount)
        } else {
          paymentMethodBreakdown[method].sales += amount
          paymentMethodBreakdown[method].netSales += amount
        }
        paymentMethodBreakdown[method].transactionCount++
      })

      // Get opening balances by payment method
      const openingBalances: Record<string, number> = {}
      entry.balances.forEach(balance => {
        const method = balance.paymentMethod as PaymentMethod
        if (method) {
          openingBalances[method] = parseFloat(balance.openingAmount.toString())
        }
      })

      // Calculate expected amounts and variances
      const expectedAmounts: Record<string, number> = {}
      const variances: Record<string, number> = {}
      
      Object.entries(paymentMethodBreakdown).forEach(([method, breakdown]) => {
        const opening = openingBalances[method] || 0
        const expected = opening + breakdown.netSales
        expectedAmounts[method] = expected
        
        // For now, variance is 0 since we don't have actual amounts yet
        // Actual amounts will be provided during shift closing
        variances[method] = 0
      })

      return NextResponse.json({
        ...entry,
        calculatedTotals: {
          totalSales: salesTotal,
          totalReturns: returnsTotal,
          netSales: salesTotal - returnsTotal,
          totalTransactions: entry.sales.length,
        },
        paymentMethodBreakdown: {
          openingBalances,
          salesByMethod: paymentMethodBreakdown,
          expectedAmounts,
          varianceByMethod: variances,
          totalVariance: 0 // Will be calculated during closing
        }
      })
    })
  } catch (error) {
    logError('api/pos-opening-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch opening entry' }, { status: 500 })
  }
}

// PUT update an opening entry (e.g., add notes, cancel)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'managePOS')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updatePosOpeningEntrySchema)
    if (!parsed.success) return parsed.response
    const { notes, status, cancellationReason } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.posOpeningEntries.findFirst({
        where: eq(posOpeningEntries.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Opening entry not found' }, { status: 404 })
      }

      // Only the owner of the shift or manager/owner can modify
      if (existing.userId !== session.user.id && !['owner', 'manager'].includes(session.user.role)) {
        return NextResponse.json({ error: 'You can only modify your own shifts' }, { status: 403 })
      }

      // Cannot modify closed or already cancelled shifts
      if (existing.status === 'closed') {
        return NextResponse.json({ error: 'Cannot modify a closed shift. Cancel the closing entry first.' }, { status: 400 })
      }
      if (existing.status === 'cancelled') {
        return NextResponse.json({ error: 'Shift is already cancelled' }, { status: 400 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {}
      if (notes !== undefined) updateData.notes = notes
      if (status === 'cancelled') {
        // Only owners/managers can cancel shifts
        if (!['owner', 'manager'].includes(session.user.role)) {
          return NextResponse.json({ error: 'Only owners and managers can cancel shifts' }, { status: 403 })
        }

        // Require cancellation reason
        if (!cancellationReason) {
          return NextResponse.json({ error: 'Cancellation reason is required' }, { status: 400 })
        }

        // Check if shift has any sales — cannot cancel if sales exist
        const [{ count: saleCount }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(sales)
          .where(and(
            eq(sales.posOpeningEntryId, id),
            sql`${sales.status} != 'void'`
          ))

        if (saleCount > 0) {
          return NextResponse.json({
            error: `Cannot cancel shift with ${saleCount} sale(s). Void all sales first or close the shift normally.`,
          }, { status: 400 })
        }

        updateData.status = 'cancelled'
        updateData.cancellationReason = cancellationReason
        updateData.cancelledAt = new Date()
        updateData.cancelledBy = session.user.id
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(posOpeningEntries)
          .set(updateData)
          .where(eq(posOpeningEntries.id, id))
      }

      const updated = await db.query.posOpeningEntries.findFirst({
        where: eq(posOpeningEntries.id, id),
        with: {
          posProfile: true,
          warehouse: true,
          balances: true,
          user: true,
        },
      })

      logAndBroadcast(session.user.tenantId, 'pos-shift', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/pos-opening-entries/[id]', error)
    return NextResponse.json({ error: 'Failed to update opening entry' }, { status: 500 })
  }
}
