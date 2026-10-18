import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posClosingEntries } from '@/lib/db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation'
import { posClosingListSchema } from '@/lib/validation/schemas/pos'

// GET list of closing entries
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePOS')
    if (permError) return permError

    const parsed = validateSearchParams(request, posClosingListSchema)
    if (!parsed.success) return parsed.response
    const { status, userId, page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let where: any = undefined
      if (status) {
        where = eq(posClosingEntries.status, status as 'draft' | 'submitted' | 'cancelled')
      }
      if (userId) {
        where = where
          ? and(where, eq(posClosingEntries.userId, userId))
          : eq(posClosingEntries.userId, userId)
      }

      const entries = await db.query.posClosingEntries.findMany({
        where,
        with: {
          openingEntry: {
            with: {
              balances: true,
            },
          },
          posProfile: true,
          user: true,
          reconciliation: true,
        },
        orderBy: [desc(posClosingEntries.closingTime)],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })

      // Add variance calculations
      const entriesWithVariance = entries.map(entry => ({
        ...entry,
        reconciliation: entry.reconciliation.map(rec => ({
          ...rec,
          difference: parseFloat(rec.actualAmount) - parseFloat(rec.expectedAmount),
        })),
        totalVariance: entry.reconciliation.reduce((sum, rec) =>
          sum + (parseFloat(rec.actualAmount) - parseFloat(rec.expectedAmount)), 0
        ),
      }))

      // Get total count for pagination
      const [{ count: total }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(posClosingEntries)
        .where(where)


      return NextResponse.json({
        data: entriesWithVariance,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/pos-closing-entries', error)
    return NextResponse.json({ error: 'Failed to fetch closing entries' }, { status: 500 })
  }
}
