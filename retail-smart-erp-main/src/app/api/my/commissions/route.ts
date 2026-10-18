import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { commissions, commissionPayouts } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams } from '@/lib/validation/helpers'
import { myCommissionsListSchema } from '@/lib/validation/schemas/hr'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewOwnCommissions')
    if (permError) return permError

    const parsed = validateSearchParams(request, myCommissionsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, view } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      if (view === 'payouts') {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(commissionPayouts)
          .where(eq(commissionPayouts.userId, session.user.id))

        const total = Number(count)
        const totalPages = Math.ceil(total / pageSize)
        const offset = (page - 1) * pageSize

        const result = await db.query.commissionPayouts.findMany({
          where: eq(commissionPayouts.userId, session.user.id),
          orderBy: (p, { desc: d }) => [d(p.createdAt)],
          limit: pageSize,
          offset,
        })

        return NextResponse.json({
          data: result,
          pagination: { page, pageSize, total, totalPages },
        })
      }

      // Default: commissions
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(commissions)
        .where(eq(commissions.userId, session.user.id))

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db.query.commissions.findMany({
        where: eq(commissions.userId, session.user.id),
        orderBy: (c, { desc: d }) => [d(c.createdAt)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/my/commissions', error)
    return NextResponse.json({ error: 'Failed to fetch commissions' }, { status: 500 })
  }
}
