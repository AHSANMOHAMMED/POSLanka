import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { posClosingEntries, tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { SAFE_USER } from '@/lib/db/safe-columns'
import { generateShiftSummaryA4Html } from '@/lib/pdf/shift-summary-a4'

// GET printable A4 HTML / PDF stream for a shift closing
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
      const closing = await db.query.posClosingEntries.findFirst({
        where: eq(posClosingEntries.id, id),
        with: {
          openingEntry: {
            with: {
              balances: true,
            },
          },
          posProfile: true,
          user: SAFE_USER,
          reconciliation: true,
        },
      })

      if (!closing) {
        return NextResponse.json({ error: 'Closing entry not found' }, { status: 404 })
      }

      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
      })

      const z = (closing.reportData as {
        cashOutAmount?: number
        retainedFloatAmount?: number
        tax?: { total?: number }
        discounts?: { total?: number }
        cashMovements?: { paidIn?: number; paidOut?: number }
        externalBills?: Array<{ billNo: string; description: string; amount: number; paymentMethod: string }>
      }) || {}
      const cashRec = closing.reconciliation.find(r => r.paymentMethod === 'cash')
      const openingCash = cashRec ? parseFloat(cashRec.openingAmount) : 0
      const actualCash = cashRec ? parseFloat(cashRec.actualAmount) : 0

      // Extract cash handover details from reportData
      const cashOutHandover = Number(z.cashOutAmount || (z.cashMovements?.paidOut || 0))
      const retainedDrawerFloat = Number(
        z.retainedFloatAmount != null
          ? z.retainedFloatAmount
          : Math.max(0, actualCash - cashOutHandover)
      )

      const externalBills = Array.isArray(z.externalBills) ? z.externalBills : []

      const html = generateShiftSummaryA4Html({
        company: {
          name: tenant?.name || 'Retail Business',
          address: tenant?.address || null,
          phone: tenant?.phone || null,
          email: tenant?.email || null,
          taxId: tenant?.taxId || null,
        },
        shift: {
          entryNumber: closing.entryNumber,
          posProfileName: closing.posProfile?.name || 'Main Counter',
          cashierName: closing.user?.fullName || 'Cashier',
          openingTime: closing.openingTime.toISOString(),
          closingTime: closing.closingTime.toISOString(),
        },
        financials: {
          totalSales: parseFloat(closing.totalSales),
          totalReturns: parseFloat(closing.totalReturns),
          netSales: parseFloat(closing.netSales),
          totalTransactions: closing.totalTransactions,
          taxTotal: z.tax?.total ? Number(z.tax.total) : undefined,
          discountTotal: z.discounts?.total ? Number(z.discounts.total) : undefined,
          totalVariance: closing.reconciliation.reduce(
            (sum, r) => sum + (parseFloat(r.actualAmount) - parseFloat(r.expectedAmount)),
            0
          ),
          varianceReason: closing.varianceReason,
        },
        cashControl: {
          openingFloat: openingCash,
          cashSales: cashRec ? Math.max(0, parseFloat(cashRec.expectedAmount) - openingCash) : 0,
          cashMovementsIn: Number(z.cashMovements?.paidIn || 0),
          cashMovementsOut: Number(z.cashMovements?.paidOut || 0),
          totalCountedCash: actualCash,
          cashOutHandover,
          retainedDrawerFloat,
        },
        paymentTenders: closing.reconciliation.map(r => ({
          method: r.paymentMethod,
          expected: parseFloat(r.expectedAmount),
          actual: parseFloat(r.actualAmount),
          variance: parseFloat(r.actualAmount) - parseFloat(r.expectedAmount),
        })),
        externalBills,
        notes: closing.notes,
        currency: tenant?.currency || 'Rs.',
      })

      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    })
  } catch (error) {
    logError('api/pos-closing-entries/[id]/pdf', error)
    return NextResponse.json({ error: 'Failed to generate shift summary PDF' }, { status: 500 })
  }
}
